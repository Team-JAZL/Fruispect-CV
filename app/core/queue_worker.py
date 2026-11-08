import json
import logging
import os
import threading
import time
import uuid
from app.storage.database import Database
from app.core.queue_coordinator import Coordinator

log = logging.getLogger(__name__)


def run_worker(key, cfg, stop):
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(processName)s %(levelname)s %(message)s')
    database = Database(cfg.database)
    database.initialize()
    queue = Coordinator(database, cfg)
    owner = uuid.uuid4().hex
    while not stop.is_set() and not queue.acquire_lane(key, owner):
        stop.wait(1)
    if stop.is_set():
        return
    heart_stop = threading.Event()
    lost_lane = threading.Event()

    def heartbeat():
        while not heart_stop.wait(max(1, cfg.lease_seconds / 4)):
            try:
                if not queue.heartbeat(key, owner):
                    lost_lane.set()
            except Exception:
                log.exception('Heartbeat failed for %s', key)

    heart = threading.Thread(target=heartbeat, daemon=True)
    heart.start()
    try:
        adapter = None
        try:
            from app.core.model_adapter import ModelAdapter
            adapter = ModelAdapter(key, cfg)
            queue.register(key, owner, 'READY', {**adapter.info, 'process_pid': os.getpid()})
            log.info('Model ready: %s', json.dumps(adapter.info))
        except Exception as exc:
            queue.register(key, owner, 'UNAVAILABLE', error=str(exc))
            log.exception('Model unavailable: %s', key)
        while not stop.is_set() and not lost_lane.is_set():
            job = queue.claim(key, owner)
            if job is None:
                stop.wait(0.15)
                continue
            try:
                result = adapter.predict(job['canonical_input_path'], preprocessing_hash=job['preprocessing_sha256'])
                queue.finish(job['job_id'], owner, result=result)
            except Exception as exc:
                log.exception('Job failed: %s', job['job_id'])
                queue.finish(job['job_id'], owner, error=exc)
    finally:
        heart_stop.set()
        heart.join(timeout=3)
        with database.connect(write=True) as db:
            db.execute("UPDATE model_registry SET state='OFFLINE',owner=NULL,lease_expires_at=0 WHERE model_key=? AND owner=?", (key, owner))
