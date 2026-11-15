# Coordinate durable FIFO jobs with leases and versioned transitions.
import json
import time
from app.storage.jobs import transition


class Coordinator:
    # Initialize the component and its required dependencies.
    def __init__(self, database, settings):
        self.db, self.cfg = database, settings

    # Claim an expired model lane and recover its abandoned running jobs.
    def acquire_lane(self, key, owner):
        with self.db.connect(write=True) as db:
            row = db.execute('SELECT * FROM model_registry WHERE model_key=?', (key,)).fetchone()
            now = time.time()
            if row['owner'] and row['owner'] != owner and (row['lease_expires_at'] or 0) > now:
                return False
            db.execute("UPDATE model_registry SET owner=?,lease_expires_at=?,state='LOADING',last_error=NULL WHERE model_key=?",
                       (owner, now + self.cfg.lease_seconds, key))

            for job in db.execute("SELECT * FROM model_jobs WHERE model_key=? AND status='RUNNING' ORDER BY admission_seq", (key,)).fetchall():
                status = 'CANCELLED' if job['cancel_requested'] else ('FAILED' if job['attempt_count'] >= self.cfg.max_attempts else 'QUEUED')
                transition(db, job, status, lease_owner=None, lease_expires_at=None, error_code='WORKER_RESTART',
                           error_message='Previous worker stopped before committing a result.', available_at=now)
            return True

    # Renew lane ownership and stop claiming work if its lease is lost.
    def heartbeat(self, key, owner):
        with self.db.connect(write=True) as db:
            expires = time.time() + self.cfg.lease_seconds
            updated = db.execute('UPDATE model_registry SET lease_expires_at=? WHERE model_key=? AND owner=?', (expires, key, owner)).rowcount
            db.execute("UPDATE model_jobs SET lease_expires_at=? WHERE model_key=? AND lease_owner=? AND status='RUNNING'", (expires, key, owner))
            return bool(updated)

    # Publish a model lane readiness state and validated checkpoint metadata.
    def register(self, key, owner, state, info=None, error=None):
        info = info or {}
        with self.db.connect(write=True) as db:
            db.execute('''UPDATE model_registry SET state=?, checkpoint_path=?,checkpoint_sha256=?,preprocessing_sha256=?,
                device=?,validated_at=?,last_error=?,metadata_json=? WHERE model_key=? AND owner=?''',
                (state, str(self.cfg.artifacts / 'models' / f'{key}.pth'), info.get('checkpoint_sha256'),
                 info.get('preprocessing_sha256'), info.get('device', self.cfg.device), time.time(), error,
                 json.dumps(info), key, owner))

    # Claim the available FIFO head while fencing obsolete lane owners.
    def claim(self, key, owner):
        with self.db.connect(write=True) as db:
            registry = db.execute('SELECT * FROM model_registry WHERE model_key=?', (key,)).fetchone()
            if registry['owner'] != owner or (registry['lease_expires_at'] or 0) < time.time():
                return None
            job = db.execute("SELECT j.*,i.canonical_input_path,i.input_status,i.batch_id FROM model_jobs j JOIN images i USING(image_id) WHERE j.model_key=? AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING') ORDER BY j.admission_seq LIMIT 1", (key,)).fetchone()
            if not job:
                return None
            if registry['state'] == 'UNAVAILABLE':
                if job['status'] != 'RUNNING':
                    transition(db, job, 'UNAVAILABLE', error_code='MODEL_UNAVAILABLE', error_message=registry['last_error'])
                return None
            if registry['state'] != 'READY' or job['status'] != 'QUEUED' or job['available_at'] > time.time():
                return None
            now = time.time()
            transition(db, job, 'RUNNING', attempt_count=job['attempt_count'] + 1, lease_owner=owner,
                       lease_expires_at=now + self.cfg.lease_seconds, started_at=now,
                       queue_wait_ms=(now - job['queued_at']) * 1000,
                       model_checkpoint_sha256=registry['checkpoint_sha256'])
            return dict(db.execute('SELECT j.*,i.canonical_input_path,i.preprocess_ms,i.preprocessing_sha256,i.received_at,i.batch_id FROM model_jobs j JOIN images i USING(image_id) WHERE job_id=?', (job['job_id'],)).fetchone())

    # Commit one owned job result or discard a cancelled or obsolete completion.
    def finish(self, job_id, owner, result=None, error=None):
        with self.db.connect(write=True) as db:
            job = db.execute('SELECT * FROM model_jobs WHERE job_id=?', (job_id,)).fetchone()
            if not job:
                return False
            lane = db.execute('SELECT owner FROM model_registry WHERE model_key=?', (job['model_key'],)).fetchone()
            if job['status'] != 'RUNNING' or job['lease_owner'] != owner or lane['owner'] != owner:
                return False
            if job['cancel_requested']:
                transition(db, job, 'CANCELLED', lease_owner=None, lease_expires_at=None)
            elif error:
                retry = job['attempt_count'] < self.cfg.max_attempts
                transition(db, job, 'QUEUED' if retry else 'FAILED', lease_owner=None, lease_expires_at=None,
                           available_at=time.time() + min(2 ** job['attempt_count'], 10),
                           error_code='INFERENCE_ERROR', error_message=str(error)[:1000])
                db.execute('UPDATE model_registry SET last_error=? WHERE model_key=?', (str(error)[:1000], job['model_key']))
            else:
                image = db.execute('SELECT * FROM images WHERE image_id=?', (job['image_id'],)).fetchone()
                result = {**result, 'queue_wait_ms': job['queue_wait_ms'], 'preprocess_ms': image['preprocess_ms'],
                          'end_to_end_ms': (time.time() - image['received_at']) * 1000}
                transition(db, job, 'COMPLETED', result_json=json.dumps(result), inference_ms=result['inference_ms'],
                           lease_owner=None, lease_expires_at=None, error_code=None, error_message=None)
            return True

    # Cancel queued jobs and request cancellation of active model passes.
    def cancel(self, batch_id=None, image_id=None):
        from app.storage.jobs import emit
        with self.db.connect(write=True) as db:
            if batch_id and not db.execute('SELECT 1 FROM batches WHERE batch_id=?', (batch_id,)).fetchone():
                return 0
            where, value = ('i.image_id', image_id) if image_id else ('i.batch_id', batch_id)
            jobs = db.execute(f"SELECT j.* FROM model_jobs j JOIN images i USING(image_id) WHERE {where}=? AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING')", (value,)).fetchall()
            for job in jobs:
                if job['status'] == 'RUNNING':
                    if not job['cancel_requested']:
                        db.execute('UPDATE model_jobs SET cancel_requested=1,version=version+1 WHERE job_id=?', (job['job_id'],))
                        parent = db.execute('SELECT batch_id FROM images WHERE image_id=?', (job['image_id'],)).fetchone()[0]
                        emit(db, parent, 'model.cancellation_requested', job['image_id'], job['model_key'], job['version'] + 1,
                             status='RUNNING', cancel_requested=True)
                else:
                    transition(db, job, 'CANCELLED')
            if batch_id:
                db.execute('UPDATE batches SET cancelled_at=? WHERE batch_id=?', (time.time(), batch_id))
                emit(db, batch_id, 'batch.cancelled')
            return len(jobs)
