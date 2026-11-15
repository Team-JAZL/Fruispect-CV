# Supervise the web server, model workers, maintenance, and shutdown.
import logging
import multiprocessing as mp
import os
import signal
import time
from app.config import Settings, MODELS
from app.services.cleanup import maintain, drain_deletions
from app.connection.manager import TunnelManager
from app.storage.database import Database
from app.runtime.processes import serve, worker_entry
from app.runtime.locking import instance_lock


# Run and monitor child services until graceful shutdown is requested.
def supervise(cfg):
    database = Database(cfg.database)
    database.initialize()
    tunnel = TunnelManager(cfg, database, int(os.environ.get('FRUISPECT_PORT', 5000)))
    ctx = mp.get_context('spawn')
    stop, web_ready = ctx.Event(), ctx.Event()
    workers = {}
    web = ctx.Process(target=serve, args=(cfg, web_ready), name='web')
    # Signal all supervised processes to begin graceful shutdown.
    def stopping(*_):
        stop.set()
    signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, 'SIGBREAK'):
        signals.append(signal.SIGBREAK)
    previous_handlers = {sig: signal.signal(sig, stopping) for sig in signals}
    last_cleanup = 0
    tunnel_attempted = False
    try:
        tunnel.reset()
        maintain(database, cfg, recover_inputs=True)
        with database.connect(write=True) as db:
            db.execute("INSERT OR REPLACE INTO service_state VALUES('accepting','1')")
            db.execute("INSERT OR REPLACE INTO service_state VALUES('shutdown_requested','0')")
            db.execute("INSERT OR REPLACE INTO service_state VALUES('tunnel_retry','0')")
        web.start()
        print(f"Fruispect: http://{os.environ.get('FRUISPECT_HOST', '127.0.0.1')}:{os.environ.get('FRUISPECT_PORT', '5000')}", flush=True)
        while not stop.is_set():
            with database.connect(write=True) as db:
                shutdown = db.execute("SELECT value FROM service_state WHERE key='shutdown_requested'").fetchone()
                retry = db.execute("SELECT value FROM service_state WHERE key='tunnel_retry'").fetchone()
                if retry and retry['value'] == '1':
                    db.execute("UPDATE service_state SET value='0' WHERE key='tunnel_retry'")
                pending_files = db.execute('SELECT 1 FROM file_deletions LIMIT 1').fetchone()
            if shutdown and shutdown['value'] == '1':
                stop.set()
                break
            if not web.is_alive():
                raise RuntimeError('Web server stopped; shutting down workers.')
            if web_ready.is_set() and (not tunnel_attempted or (retry and retry['value'] == '1')):
                tunnel.start()
                tunnel_attempted = True
            tunnel.tick()
            for key in MODELS:
                if key not in workers or not workers[key].is_alive():
                    if key in workers:
                        workers[key].join()
                    process = ctx.Process(target=worker_entry, args=(key, cfg, stop), name=key)
                    process.start()
                    workers[key] = process
            if pending_files:
                drain_deletions(database, cfg)
            if time.monotonic() - last_cleanup > 60:
                try:
                    maintain(database, cfg)
                except Exception:
                    logging.exception('Retention maintenance failed; will retry without interrupting workers.')
                last_cleanup = time.monotonic()
            stop.wait(.5)
    finally:
        stop.set()
        try:
            with database.connect(write=True) as db:
                db.execute("INSERT OR REPLACE INTO service_state VALUES('accepting','0')")
        finally:
            try:
                tunnel.close()
            finally:
                try:
                    for process in workers.values():
                        process.join(timeout=45)
                        if process.is_alive():
                            process.terminate(); process.join()
                    if web.pid is not None:
                        web.terminate(); web.join()
                finally:
                    for sig, handler in previous_handlers.items():
                        signal.signal(sig, handler)


# Load environment settings, acquire the instance lock, and supervise services.
def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(processName)s %(levelname)s %(message)s')
    cfg = Settings.from_env()
    cfg.instance.mkdir(parents=True, exist_ok=True)
    with instance_lock(cfg):
        supervise(cfg)
