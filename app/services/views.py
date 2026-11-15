# Assemble collection, image, and queue API snapshots.
import json
import math
import statistics
import time
from app.config import MODELS
from app.storage.database import iso
from app.storage.jobs import TERMINAL


# Assemble an image snapshot with independent jobs and agreement state.
def image_view(db, image_id):
    row = db.execute('SELECT * FROM images WHERE image_id=?', (image_id,)).fetchone()
    if not row:
        return None
    image = {key: row[key] for key in ('image_id', 'batch_id', 'admission_seq', 'original_filename', 'content_sha256',
                                      'input_status', 'input_error', 'width', 'height', 'preprocess_ms', 'preprocessing_sha256')}
    image.update(received_at=iso(row['received_at']), retention_expires_at=iso(row['retention_expires_at']),
                 thumbnail_url=f'/api/images/{image_id}/thumbnail')
    jobs = {}
    for job in db.execute('SELECT * FROM model_jobs WHERE image_id=?', (image_id,)):
        value = dict(job)
        value.pop('lease_owner')
        value.pop('lease_expires_at')
        raw = value.pop('result_json')
        value['result'] = json.loads(raw) if raw else None
        for key in ('queued_at', 'started_at', 'completed_at'):
            value[key] = iso(value[key]) if value[key] else None
        jobs[job['model_key']] = value
    image['jobs'] = jobs
    image['terminal'] = len(jobs) == 3 and all(j['status'] in TERMINAL for j in jobs.values())
    results = [j['result'] for j in jobs.values() if j['status'] == 'COMPLETED']
    image['consensus'] = {
        'scope': 'complete' if len(results) == 3 else 'incomplete' if image['terminal'] else 'provisional',
        'successful_models': len(results),
        'fruit_disagreement': len({r['predicted_fruit'] for r in results}) > 1,
        'quality_disagreement': len({r['predicted_quality'] for r in results}) > 1,
    }
    return image


# Assemble collection counts, completion state, and its current event cursor.
def batch_view(db, batch_id):
    batch = dict(db.execute('SELECT * FROM batches WHERE batch_id=?', (batch_id,)).fetchone())
    batch.pop('session_id')
    batch.pop('request_key')
    batch['created_at'] = iso(batch['created_at'])
    batch['cancelled_at'] = iso(batch['cancelled_at']) if batch['cancelled_at'] else None
    summary = dict(db.execute("""SELECT count(*) AS accepted,
        coalesce(sum(input_status='PROCESSING'),0) AS preprocessing,
        coalesce(sum(NOT EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING'))),0) AS fully_complete,
        coalesce(sum(EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status='COMPLETED') AND EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING'))),0) AS partial,
        coalesce(sum(EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status IN ('FAILED','UNAVAILABLE'))),0) AS failed,
        coalesce(sum(EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status='CANCELLED')),0) AS cancelled
        FROM images i WHERE batch_id=?""", (batch_id,)).fetchone())
    counts = {r['status']: r['n'] for r in db.execute('SELECT status,count(*) n FROM model_jobs JOIN images USING(image_id) WHERE batch_id=? GROUP BY status', (batch_id,))}
    summary.update(queued=counts.get('QUEUED', 0) + counts.get('WAITING_FOR_INPUT', 0), running=counts.get('RUNNING', 0),
                   rejected=db.execute('SELECT count(*) FROM submissions WHERE batch_id=? AND accepted=0', (batch_id,)).fetchone()[0])
    summary['total_submitted'] = summary['accepted'] + summary['rejected']
    batch['summary'] = summary
    batch['status'] = 'CANCELLED' if batch['cancelled_at'] else 'COMPLETED' if summary['accepted'] and summary['fully_complete'] == summary['accepted'] else 'ACTIVE'
    batch['event_cursor'] = db.execute('SELECT coalesce(max(event_id),0) FROM events WHERE batch_id=?', (batch_id,)).fetchone()[0]
    return batch


# Assemble lane health, active work, upcoming admissions, and rolling timings.
def queues_view(database):
    lanes = []
    with database.connect() as db:
        for key in MODELS:
            registry = dict(db.execute('SELECT * FROM model_registry WHERE model_key=?', (key,)).fetchone())
            registry.pop('owner')
            expires = registry.pop('lease_expires_at')
            registry.pop('checkpoint_path')
            registry['metadata'] = json.loads(registry.pop('metadata_json') or '{}')
            if not expires or expires < time.time():
                registry['state'] = 'OFFLINE'
            counts = {r['status']: r['n'] for r in db.execute('SELECT status,count(*) n FROM model_jobs WHERE model_key=? GROUP BY status', (key,))}
            active = db.execute("SELECT image_id,admission_seq,started_at FROM model_jobs WHERE model_key=? AND status='RUNNING'", (key,)).fetchone()
            pending = [dict(r) for r in db.execute("SELECT image_id,admission_seq,status FROM model_jobs WHERE model_key=? AND status IN ('WAITING_FOR_INPUT','QUEUED') ORDER BY admission_seq LIMIT 8", (key,))]
            sample = [dict(r) for r in db.execute("SELECT inference_ms,completed_at,started_at FROM model_jobs WHERE model_key=? AND status='COMPLETED' ORDER BY completed_at DESC LIMIT 100", (key,))]
            times = sorted(r['inference_ms'] for r in sample)
            window = max((sample[0]['completed_at'] - sample[-1]['started_at']) if sample else 0, 0.001)
            lanes.append({**registry, 'counts': counts, 'queue_depth': sum(counts.get(s, 0) for s in ('QUEUED', 'WAITING_FOR_INPUT')),
                          'active': dict(active) if active else None, 'active_duration_ms': (time.time() - active['started_at']) * 1000 if active else None,
                          'up_next': pending, 'statistics_window': 'last 100 completed jobs in retained data',
                          'mean_inference_ms': statistics.mean(times) if times else None,
                          'p95_inference_ms': times[max(0, math.ceil(len(times) * .95) - 1)] if times else None,
                          'throughput_model_jobs_s': len(sample) / window if sample else None})
    return lanes
