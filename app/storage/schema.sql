-- Define durable collections, image admissions, model jobs, events, and service state.
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
CREATE TABLE IF NOT EXISTS upload_sources(
    image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL, brand TEXT, model TEXT, platform TEXT, browser TEXT,
    user_agent TEXT NOT NULL, remote_address TEXT, connection_type TEXT NOT NULL);
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
