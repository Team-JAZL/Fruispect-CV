# Validate image admissions and persist shared canonical inputs.
import hashlib
import os
import shutil
import time
import uuid
from pathlib import Path
from PIL import Image
from app.config import MODELS
from app.inference.preprocessing import decode, metadata, canonical_pixels
from app.storage.jobs import emit, transition


class AdmissionError(Exception):
    # Initialize the component and its required dependencies.
    def __init__(self, code, message, status=422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


# Validate and reserve an idempotent image admission before preparing shared pixels.
def ingest(database, cfg, batch_id, request_key, index, upload, *, source=None):
    started = time.perf_counter()
    cfg.spool.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    raw = cfg.spool / f'{token}.upload'
    canonical = cfg.spool / f'{token}.png'
    thumb = cfg.spool / f'{token}.jpg'
    reserved = False
    image_id = uuid.uuid4().hex
    try:
        with database.connect() as db:
            previous = db.execute('SELECT * FROM images WHERE batch_id=? AND request_key=? AND file_index=?', (batch_id, request_key, index)).fetchone()
            storage = db.execute('SELECT coalesce(sum(storage_bytes),0) FROM images').fetchone()[0]
        if previous:

            replay_hash = hashlib.sha256()
            replay_size = 0
            while chunk := upload.stream.read(64 * 1024):
                replay_size += len(chunk)
                if replay_size > cfg.max_file_bytes:
                    raise AdmissionError('FILE_TOO_LARGE', 'Replay exceeds the file size limit.', 413)
                replay_hash.update(chunk)
            if replay_hash.hexdigest() != previous['content_sha256']:
                raise AdmissionError('IDEMPOTENCY_CONFLICT', 'Key already belongs to different image content.', 409)
            return {'file_index': index, 'image_id': previous['image_id'], 'admission_seq': previous['admission_seq'], 'duplicate': True}

        raw_budget = cfg.upload_slots * cfg.max_file_bytes
        if storage + raw_budget > cfg.max_spool_bytes:
            raise AdmissionError('SPOOL_FULL', 'Temporary storage budget cannot reserve upload space.', 503)
        size = 0
        hasher = hashlib.sha256()
        with raw.open('xb') as stream:
            while chunk := upload.stream.read(64 * 1024):
                size += len(chunk)
                if size > cfg.max_file_bytes:
                    raise AdmissionError('FILE_TOO_LARGE', f'File exceeds {cfg.max_file_bytes} bytes.', 413)
                hasher.update(chunk)
                stream.write(chunk)
        if not size:
            raise AdmissionError('EMPTY_IMAGE', 'File is empty.')
        content_hash = hasher.hexdigest()
        with database.connect() as db:
            previous = db.execute('SELECT * FROM images WHERE batch_id=? AND request_key=? AND file_index=?', (batch_id, request_key, index)).fetchone()
            if previous:
                if previous['content_sha256'] != content_hash:
                    raise AdmissionError('IDEMPOTENCY_CONFLICT', 'Key already belongs to different image content.', 409)
                return {'file_index': index, 'image_id': previous['image_id'], 'admission_seq': previous['admission_seq'], 'duplicate': True}
        try:
            image = decode(raw, cfg.max_pixels)
        except Exception as exc:
            raise AdmissionError('INVALID_IMAGE', str(exc)) from exc
        try:
            data, prep_hash = metadata(cfg.artifacts)
        except Exception as exc:
            raise AdmissionError('PREPROCESSING_UNAVAILABLE', f'Cannot use research preprocessing: {exc}', 503) from exc

        reservation = data['size'] ** 2 * 4 + 128 * 1024
        with database.connect(write=True) as db:
            previous = db.execute('SELECT * FROM images WHERE batch_id=? AND request_key=? AND file_index=?', (batch_id, request_key, index)).fetchone()
            if previous:
                if previous['content_sha256'] != content_hash:
                    raise AdmissionError('IDEMPOTENCY_CONFLICT', 'Key already belongs to different content.', 409)
                return {'file_index': index, 'image_id': previous['image_id'], 'admission_seq': previous['admission_seq'], 'duplicate': True}
            batch = db.execute('SELECT * FROM batches WHERE batch_id=?', (batch_id,)).fetchone()
            service = db.execute("SELECT value FROM service_state WHERE key='accepting'").fetchone()
            if service and service['value'] == '0':
                raise AdmissionError('SHUTTING_DOWN', 'Service is stopping. Retry unaccepted files later.', 503)
            if batch['cancelled_at']:
                raise AdmissionError('BATCH_CANCELLED', 'Create a new batch after cancellation.', 409)
            count = db.execute('SELECT count(*) FROM images WHERE batch_id=?', (batch_id,)).fetchone()[0]
            depths = db.execute("SELECT count(*) AS n FROM model_jobs WHERE status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING') GROUP BY model_key").fetchall()
            storage = db.execute('SELECT coalesce(sum(storage_bytes),0) FROM images').fetchone()[0]
            if count >= cfg.max_batch or any(r['n'] >= cfg.max_queue for r in depths):
                raise AdmissionError('QUEUE_FULL', 'Batch or lane capacity reached. Retry unaccepted files later.', 429)
            if storage + reservation + raw_budget > cfg.max_spool_bytes or shutil.disk_usage(cfg.spool).free < reservation + raw_budget + 64 * 1024 ** 2:
                raise AdmissionError('SPOOL_FULL', 'Temporary storage limit reached.', 503)
            now = time.time()
            seq = db.execute('''INSERT INTO images(image_id,batch_id,request_key,file_index,original_filename,
                content_sha256,image_path,canonical_input_path,input_status,width,height,storage_bytes,
                received_at,retention_expires_at,preprocessing_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (image_id, batch_id, request_key, index, Path((upload.filename or 'camera.jpg').replace('\\', '/')).name[:200],
                 content_hash, str(thumb), str(canonical), 'PROCESSING', image.width, image.height, reservation,
                 now, now + cfg.retention_hours * 3600, prep_hash)).lastrowid
            if source:
                db.execute('''INSERT INTO upload_sources(image_id,device_id,brand,model,platform,browser,
                    user_agent,remote_address,connection_type) VALUES(?,?,?,?,?,?,?,?,?)''',
                    (image_id, *(source[key] for key in ('device_id', 'brand', 'model', 'platform', 'browser',
                        'user_agent', 'remote_address', 'connection_type'))))
            for key in MODELS:
                db.execute("INSERT INTO model_jobs(job_id,image_id,model_key,admission_seq,status,queued_at) VALUES(?,?,?,?,'WAITING_FOR_INPUT',?)",
                           (uuid.uuid4().hex, image_id, key, seq, now))
            db.execute('INSERT OR REPLACE INTO submissions VALUES(?,?,?,1)', (batch_id, request_key, index))
            emit(db, batch_id, 'image.accepted', image_id, admission_seq=seq, status='PROCESSING')
        reserved = True

        temp = canonical.with_suffix('.tmp')
        canonical_pixels(image, data).save(temp, format='PNG')
        os.replace(temp, canonical)
        image.thumbnail((384, 384), resample=Image.Resampling.BILINEAR)
        image.save(thumb, format='JPEG', quality=85)
        with database.connect(write=True) as db:
            db.execute("UPDATE images SET input_status='READY',preprocessed_at=?,preprocess_ms=?,storage_bytes=? WHERE image_id=?",
                       (time.time(), (time.perf_counter() - started) * 1000, canonical.stat().st_size + thumb.stat().st_size, image_id))
            for job in db.execute("SELECT * FROM model_jobs WHERE image_id=? AND status='WAITING_FOR_INPUT'", (image_id,)).fetchall():
                transition(db, job, 'QUEUED')
            emit(db, batch_id, 'image.preprocessed', image_id, status='READY')
        return {'file_index': index, 'image_id': image_id, 'admission_seq': seq, 'duplicate': False}
    except Exception as exc:
        if reserved:

            with database.connect(write=True) as db:
                db.execute("UPDATE images SET input_status='FAILED',input_error=? WHERE image_id=?", (str(exc)[:1000], image_id))
                for job in db.execute("SELECT * FROM model_jobs WHERE image_id=? AND status='WAITING_FOR_INPUT'", (image_id,)).fetchall():
                    transition(db, job, 'FAILED', error_code='PREPROCESS_FAILED', error_message=str(exc)[:1000])
            return {'file_index': index, 'image_id': image_id, 'admission_seq': seq, 'input_error': str(exc)}
        if isinstance(exc, OSError):
            raise AdmissionError('STORAGE_ERROR', 'Temporary storage could not be written. Retry unaccepted files after checking local disk.', 503) from exc
        raise
    finally:
        raw.unlink(missing_ok=True)
