"""One host supervisor, one web process, three separately restarted worker processes."""
import logging
import multiprocessing as mp
import os
import signal
import time
from app import create_app
from app.config import Settings, MODELS
from app.core.cleanup import maintain, drain_deletions
from app.core.queue_worker import run_worker
from app.core.tunnel import TunnelManager
from app.storage.database import Database


def ignore_console_interrupts():
    # The supervisor owns Ctrl+C/Ctrl+Break and lets current worker passes finish.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, signal.SIG_IGN)


def worker_entry(key, cfg, stop):
    ignore_console_interrupts()
    run_worker(key, cfg, stop)


def serve(cfg, ready):
    ignore_console_interrupts()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(processName)s %(levelname)s %(message)s')
    from waitress import create_server
    server = create_server(create_app(cfg), host=os.environ.get('FRUISPECT_HOST', '127.0.0.1'),
                  port=int(os.environ.get('FRUISPECT_PORT', 5000)), threads=20,
                  max_request_body_size=cfg.max_file_bytes * 4 + 1024 * 1024,
                  channel_timeout=360, clear_untrusted_proxy_headers=True,
                  trusted_proxy='::1' if os.environ.get('FRUISPECT_HOST') == '::1' else '127.0.0.1',
                  trusted_proxy_headers={'x-forwarded-proto'})
    ready.set()  # Set only after our server owns the listening socket.
    server.print_listen('Serving on http://{}:{}')
    server.run()


def instance_lock(cfg):
    # OS-held lock releases on crash; prevents duplicate supervisors and unsafe recovery.
    lock = (cfg.instance / 'supervisor.lock').open('a+b')
    try:
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            if lock.read(1) == b'':
                lock.write(b'0'); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise SystemExit('A Fruispect supervisor already owns this instance.')
    return lock


def supervise(cfg):
    database = Database(cfg.database)
    database.initialize()
    tunnel = TunnelManager(cfg, database, int(os.environ.get('FRUISPECT_PORT', 5000)))
    ctx = mp.get_context('spawn')
    stop, web_ready = ctx.Event(), ctx.Event()
    workers = {}
    web = ctx.Process(target=serve, args=(cfg, web_ready), name='web')
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


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(processName)s %(levelname)s %(message)s')
    cfg = Settings.from_env()
    cfg.instance.mkdir(parents=True, exist_ok=True)
    with instance_lock(cfg):
        supervise(cfg)


if __name__ == '__main__':
    mp.freeze_support()
    main()
