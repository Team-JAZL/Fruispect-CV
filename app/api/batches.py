# Create, inspect, upload to, cancel, and delete browser collections.
import time
import uuid
from flask import abort, current_app, jsonify, request, session
from app.services.cleanup import delete_collections
from app.services.ingestion import ingest, AdmissionError
from app.queue.coordinator import Coordinator
from app.services.views import batch_view
from app.api import api
from app.api.common import services, own_batch, exclusive_uploads


# Create or reuse an idempotent collection for this browser.
@api.post('/api/batches')
def create_batch():
    database, _ = services()
    key = request.headers.get('Idempotency-Key')
    if key and len(key) > 180:
        abort(400, 'Idempotency key too long.')
    with database.connect(write=True) as db:
        row = db.execute('SELECT batch_id FROM batches WHERE session_id=? AND request_key=?', (session['sid'], key)).fetchone() if key else None
        batch_id = row['batch_id'] if row else uuid.uuid4().hex
        if not row:
            db.execute('INSERT INTO batches(batch_id,session_id,request_key,created_at) VALUES(?,?,?,?)', (batch_id, session['sid'], key, time.time()))
        result = batch_view(db, batch_id)
    return jsonify(batch=result), 202


# Return the latest retained collections owned by this browser.
@api.get('/api/batches')
def batches():
    database, _ = services()
    with database.connect() as db:
        rows = [batch_view(db, r[0]) for r in db.execute('SELECT batch_id FROM batches WHERE session_id=? ORDER BY created_at DESC LIMIT 30', (session['sid'],)).fetchall()]
    return jsonify(batches=rows)


# Return the requested browser-owned collection summary.
@api.get('/api/batches/<batch_id>')
def batch(batch_id):
    database, _ = services()
    with database.connect() as db:
        own_batch(db, batch_id)
        result = batch_view(db, batch_id)
    return jsonify(batch=result)


# Admit a bounded image chunk and report individual rejections.
@api.post('/api/batches/<batch_id>/images')
def submit(batch_id):
    database, cfg = services()
    with database.connect() as db:
        own_batch(db, batch_id)
    key = request.headers.get('Idempotency-Key')
    if not key or len(key) > 180:
        abort(400, 'A unique Idempotency-Key of at most 180 characters is required.')
    gate = current_app.extensions['uploads']
    if not gate.acquire(blocking=False):
        return jsonify(error={'code': 'UPLOAD_BUSY', 'message': 'Upload capacity busy. Retry unaccepted files.'}), 429, {'Retry-After': '2'}
    try:
        with database.connect() as db:
            own_batch(db, batch_id)
        files = request.files.getlist('images')
        if not 1 <= len(files) <= 4:
            abort(400, 'Submit 1–4 images per chunk, preserving order.')
        try:
            offset = int(request.form.get('offset', '0'))
            if offset < 0:
                raise ValueError()
        except ValueError:
            abort(400, 'offset must be a nonnegative integer.')
        accepted, rejected = [], []
        for index, file in enumerate(files, offset):
            try:
                accepted.append(ingest(database, cfg, batch_id, key, index, file))
            except AdmissionError as exc:
                rejected.append({'file_index': index, 'filename': file.filename, 'code': exc.code, 'message': exc.message, 'http_status': exc.status})
                with database.connect(write=True) as db:
                    db.execute('INSERT OR IGNORE INTO submissions VALUES(?,?,?,0)', (batch_id, key, index))
        code = 202 if accepted else max((r['http_status'] for r in rejected), default=422)
        return jsonify(accepted=accepted, rejected=rejected), code, {'Retry-After': '2'} if code in (429, 503) else {}
    finally:
        gate.release()


# Cancel unfinished jobs in an owned collection.
@api.post('/api/batches/<batch_id>/cancel')
def cancel_batch(batch_id):
    database, cfg = services()
    with database.connect() as db:
        own_batch(db, batch_id)
    return jsonify(cancelled_or_requested=Coordinator(database, cfg).cancel(batch_id=batch_id))


# Delete one owned collection while excluding concurrent uploads.
@api.post('/api/batches/<batch_id>/delete')
def delete_batch(batch_id):
    database, cfg = services()
    with exclusive_uploads():
        with database.connect() as db:
            own_batch(db, batch_id)
        deleted = delete_collections(database, cfg, session_id=session['sid'], batch_id=batch_id)
    return jsonify(deleted=deleted)
