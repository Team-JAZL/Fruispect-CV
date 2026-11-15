# Persist job events and enforce versioned state transitions.
import json
import time

TERMINAL = ('COMPLETED', 'FAILED', 'CANCELLED', 'UNAVAILABLE')


# Append a durable collection event and return its sequence number.
def emit(db, batch_id, event_type, image_id=None, model_key=None, version=1, **payload):
    return db.execute('INSERT INTO events(batch_id,image_id,model_key,event_type,version,created_at,payload_json) VALUES(?,?,?,?,?,?,?)',
                      (batch_id, image_id, model_key, event_type, version, time.time(), json.dumps(payload))).lastrowid


TRANSITIONS = {
    'WAITING_FOR_INPUT': {'QUEUED', 'FAILED', 'CANCELLED', 'UNAVAILABLE'},
    'QUEUED': {'RUNNING', 'FAILED', 'CANCELLED', 'UNAVAILABLE'},
    'RUNNING': {'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED'},
}


# Apply an allowed job transition and emit its versioned events.
def transition(db, job, status, **fields):
    if status not in TRANSITIONS.get(job['status'], set()):
        raise ValueError(f"Invalid job transition {job['status']} -> {status}")
    values = {'status': status, 'version': job['version'] + 1, **fields}
    if status in TERMINAL:
        values['completed_at'] = time.time()
    assignments = ','.join(f'{key}=?' for key in values)
    changed = db.execute(f'UPDATE model_jobs SET {assignments} WHERE job_id=? AND version=?',
                         (*values.values(), job['job_id'], job['version'])).rowcount
    if not changed:
        raise RuntimeError('Stale job transition')
    image = db.execute('SELECT batch_id FROM images WHERE image_id=?', (job['image_id'],)).fetchone()
    event = {'RUNNING': 'model.started', 'COMPLETED': 'model.completed', 'FAILED': 'model.failed',
             'CANCELLED': 'model.cancelled', 'UNAVAILABLE': 'model.unavailable'}.get(status, 'model.queued')
    emit(db, image['batch_id'], event, job['image_id'], job['model_key'], values['version'], status=status)
    if status in TERMINAL:
        pending = db.execute("SELECT count(*) FROM model_jobs WHERE image_id=? AND status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING')", (job['image_id'],)).fetchone()[0]
        if pending == 0:
            emit(db, image['batch_id'], 'image.complete', job['image_id'])
        emit(db, image['batch_id'], 'batch.progress', job['image_id'])
