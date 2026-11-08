import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from app.config import MODELS

TERMINAL = ('COMPLETED', 'FAILED', 'CANCELLED', 'UNAVAILABLE')
PENDING = ('WAITING_FOR_INPUT', 'QUEUED', 'RUNNING')


def iso(timestamp=None):
    return datetime.fromtimestamp(timestamp if timestamp is not None else time.time(), timezone.utc).isoformat()


class Database:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def connect(self, write=False):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=15000')
        try:
            if write:
                db.execute('BEGIN IMMEDIATE')
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS batches(
                batch_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, request_key TEXT,
                created_at REAL NOT NULL, cancelled_at REAL, UNIQUE(session_id,request_key));
            CREATE TABLE IF NOT EXISTS images(
                admission_seq INTEGER PRIMARY KEY AUTOINCREMENT, image_id TEXT UNIQUE NOT NULL,
                batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
                request_key TEXT NOT NULL, file_index INTEGER NOT NULL, original_filename TEXT NOT NULL,
                content_sha256 TEXT NOT NULL, image_path TEXT, canonical_input_path TEXT,
                input_status TEXT NOT NULL, input_error TEXT, width INTEGER, height INTEGER,
                storage_bytes INTEGER NOT NULL, received_at REAL NOT NULL, preprocessed_at REAL,
                preprocess_ms REAL, preprocessing_sha256 TEXT, retention_expires_at REAL NOT NULL,
                UNIQUE(batch_id,request_key,file_index));
            CREATE TABLE IF NOT EXISTS model_jobs(
                job_id TEXT PRIMARY KEY, image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
                model_key TEXT NOT NULL, admission_seq INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED','UNAVAILABLE')),
                version INTEGER NOT NULL DEFAULT 1, attempt_count INTEGER NOT NULL DEFAULT 0,
                queued_at REAL NOT NULL, available_at REAL NOT NULL DEFAULT 0,
                lease_owner TEXT, lease_expires_at REAL, started_at REAL, completed_at REAL,
                cancel_requested INTEGER NOT NULL DEFAULT 0, queue_wait_ms REAL, inference_ms REAL,
                error_code TEXT, error_message TEXT, model_checkpoint_sha256 TEXT, result_json TEXT,
                UNIQUE(image_id,model_key));
            CREATE INDEX IF NOT EXISTS jobs_lane ON model_jobs(model_key,admission_seq,status);
            CREATE INDEX IF NOT EXISTS images_batch ON images(batch_id,admission_seq);
            CREATE TABLE IF NOT EXISTS model_registry(
                model_key TEXT PRIMARY KEY, display_name TEXT NOT NULL, checkpoint_path TEXT,
                checkpoint_sha256 TEXT, preprocessing_sha256 TEXT, device TEXT, state TEXT NOT NULL,
                validated_at REAL, last_error TEXT, owner TEXT, lease_expires_at REAL,
                metadata_json TEXT);
            CREATE TABLE IF NOT EXISTS events(
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
                image_id TEXT, model_key TEXT, event_type TEXT NOT NULL, version INTEGER NOT NULL,
                created_at REAL NOT NULL, payload_json TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS events_batch ON events(batch_id,event_id);
            CREATE TABLE IF NOT EXISTS submissions(
                batch_id TEXT NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
                request_key TEXT NOT NULL, file_index INTEGER NOT NULL, accepted INTEGER NOT NULL,
                PRIMARY KEY(batch_id,request_key,file_index));
            CREATE TABLE IF NOT EXISTS service_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS file_deletions(path TEXT PRIMARY KEY);
            ''')
            for key, name in MODELS.items():
                db.execute("INSERT OR IGNORE INTO model_registry(model_key,display_name,state) VALUES(?,?,'OFFLINE')", (key, name))


def emit(db, batch_id, event_type, image_id=None, model_key=None, version=1, **payload):
    return db.execute('INSERT INTO events(batch_id,image_id,model_key,event_type,version,created_at,payload_json) VALUES(?,?,?,?,?,?,?)',
                      (batch_id, image_id, model_key, event_type, version, time.time(), json.dumps(payload))).lastrowid


TRANSITIONS = {
    'WAITING_FOR_INPUT': {'QUEUED', 'FAILED', 'CANCELLED', 'UNAVAILABLE'},
    'QUEUED': {'RUNNING', 'FAILED', 'CANCELLED', 'UNAVAILABLE'},
    'RUNNING': {'QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED'},
}


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
