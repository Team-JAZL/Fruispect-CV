import csv
import io
import json
import time
import uuid
from pathlib import Path
from flask import Blueprint, Response, abort, current_app, g, jsonify, render_template, request, send_file, send_from_directory, session, stream_with_context
from contextlib import contextmanager
from app.core.cleanup import delete_collections
from app.core.ingestion import ingest, AdmissionError
from app.core.queue_coordinator import Coordinator
from app.core.views import batch_view, image_view, queues_view
from app.core import evaluation
from app.storage.database import iso

api = Blueprint('api', __name__)


def services():
    return current_app.extensions['db'], current_app.extensions['settings']


def own_batch(db, batch_id):
    if not db.execute('SELECT 1 FROM batches WHERE batch_id=? AND session_id=?', (batch_id, session['sid'])).fetchone():
        abort(404, 'Batch is unavailable, expired, or belongs to another browser session.')


def own_image(db, image_id):
    row = db.execute('SELECT batch_id FROM images WHERE image_id=?', (image_id,)).fetchone()
    if not row:
        abort(404)
    own_batch(db, row['batch_id'])


def integer(name, default, lower=0, upper=1000000000):
    try:
        value = int(request.args.get(name, default))
    except ValueError:
        abort(400, f'{name} must be an integer.')
    return max(lower, min(upper, value))


@api.get('/')
def index():
    _, cfg = services()
    return render_template('fruispect.html', frontend_settings=cfg)


@api.get('/static/fruispect/<path:filename>')
def frontend_asset(filename):
    # Keep the editable frontend as the source of truth; resolve files safely.
    return send_from_directory(Path(current_app.root_path).parent / 'frontend' / 'assets', filename)


@api.get('/api/health')
def health():
    return jsonify(status='alive', time=iso())


@api.get('/api/readiness')
def readiness():
    database, cfg = services()
    lanes = queues_view(database)
    with database.connect() as db:
        storage = db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    ready = storage and all(r['state'] == 'READY' for r in lanes)
    return jsonify(ready=ready, storage_ready=storage, device=cfg.device, models=lanes), 200 if ready else 503


@api.get('/api/models')
@api.get('/api/queues')
def queues():
    return jsonify(lanes=queues_view(services()[0]), provenance='Current Application Inference')


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


@api.get('/api/batches')
def batches():
    database, _ = services()
    with database.connect() as db:
        rows = [batch_view(db, r[0]) for r in db.execute('SELECT batch_id FROM batches WHERE session_id=? ORDER BY created_at DESC LIMIT 30', (session['sid'],)).fetchall()]
    return jsonify(batches=rows)


@api.get('/api/batches/<batch_id>')
def batch(batch_id):
    database, _ = services()
    with database.connect() as db:
        own_batch(db, batch_id)
        result = batch_view(db, batch_id)
    return jsonify(batch=result)


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
            own_batch(db, batch_id)  # Recheck after acquiring the slot, against concurrent deletion.
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


@api.get('/api/batches/<batch_id>/images')
def images(batch_id):
    database, _ = services()
    page, limit = integer('page', 1, 1), integer('limit', 20, 1, 50)
    search = request.args.get('search', '')[:200]
    status, fruit, quality, agreement = (request.args.get(k, '') for k in ('status', 'fruit', 'quality', 'agreement'))
    conditions, params = ['i.batch_id=?', 'i.original_filename LIKE ?'], [batch_id, '%' + search + '%']
    if status:
        if status == 'TERMINAL':
            conditions.append("NOT EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status IN ('WAITING_FOR_INPUT','QUEUED','RUNNING'))")
        else:
            conditions.append('EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND j.status=?)')
            params.append(status)
    for field, value in (('predicted_fruit', fruit), ('predicted_quality', quality)):
        if value:
            conditions.append(f"EXISTS(SELECT 1 FROM model_jobs j WHERE j.image_id=i.image_id AND json_extract(j.result_json,'$.{field}')=?)")
            params.append(value)
    if agreement in ('disagreement', 'agreement'):
        operator = '>1' if agreement == 'disagreement' else '=1'
        clause = f"(SELECT count(DISTINCT json_extract(result_json,'$.predicted_fruit')) FROM model_jobs j WHERE j.image_id=i.image_id){operator}"
        quality_clause = f"(SELECT count(DISTINCT json_extract(result_json,'$.predicted_quality')) FROM model_jobs j WHERE j.image_id=i.image_id){operator}"
        conditions.append(f'({clause} OR {quality_clause})' if agreement == 'disagreement' else f"({clause} AND {quality_clause} AND (SELECT count(*) FROM model_jobs j WHERE j.image_id=i.image_id AND status='COMPLETED')=3)")
    where = ' AND '.join(conditions)
    order = 'ASC' if request.args.get('sort', 'newest') == 'oldest' else 'DESC'
    with database.connect() as db:
        own_batch(db, batch_id)
        total = db.execute(f'SELECT count(*) FROM images i WHERE {where}', params).fetchone()[0]
        ids = db.execute(f'SELECT image_id FROM images i WHERE {where} ORDER BY admission_seq {order} LIMIT ? OFFSET ?', (*params, limit, (page - 1) * limit)).fetchall()
        result = [image_view(db, r['image_id']) for r in ids]
    return jsonify(images=result, page=page, limit=limit, total=total)


@api.get('/api/images/<image_id>')
def image(image_id):
    database, _ = services()
    with database.connect() as db:
        own_image(db, image_id)
        result = image_view(db, image_id)
    return jsonify(image=result)


@api.get('/api/images/<image_id>/thumbnail')
def thumbnail(image_id):
    database, cfg = services()
    with database.connect() as db:
        own_image(db, image_id)
        row = db.execute('SELECT image_path,input_status FROM images WHERE image_id=?', (image_id,)).fetchone()
        path = Path(row['image_path']).resolve()
    if not path.is_relative_to(cfg.spool.resolve()) or not path.is_file():
        abort(404, 'Thumbnail not ready.')
    return send_file(path, mimetype='image/jpeg')


@api.post('/api/batches/<batch_id>/cancel')
def cancel_batch(batch_id):
    database, cfg = services()
    with database.connect() as db:
        own_batch(db, batch_id)
    return jsonify(cancelled_or_requested=Coordinator(database, cfg).cancel(batch_id=batch_id))


@api.post('/api/images/<image_id>/cancel')
def cancel_image(image_id):
    database, cfg = services()
    with database.connect() as db:
        own_image(db, image_id)
    return jsonify(cancelled_or_requested=Coordinator(database, cfg).cancel(image_id=image_id))


@contextmanager
def exclusive_uploads():
    """Deletion never races preprocessing or files being written by an upload."""
    gate = current_app.extensions['uploads']
    acquired = 0
    try:
        for _ in range(services()[1].upload_slots):
            if not gate.acquire(blocking=False):
                abort(409, 'Photos are being uploaded. Wait for the upload to finish, then try again.')
            acquired += 1
        yield
    finally:
        for _ in range(acquired):
            gate.release()


@api.get('/api/settings')
def settings():
    database, _ = services()
    with database.connect() as db:
        collections = db.execute('SELECT count(*) FROM batches WHERE session_id=?', (session['sid'],)).fetchone()[0]
        photos = db.execute('SELECT count(*) FROM images JOIN batches USING(batch_id) WHERE session_id=?', (session['sid'],)).fetchone()[0]
        all_collections = db.execute('SELECT count(*) FROM batches').fetchone()[0] if g.local_operator else None
        all_photos = db.execute('SELECT count(*) FROM images').fetchone()[0] if g.local_operator else None
    return jsonify(collections=collections, photos=photos, local_operator=g.local_operator,
                   all_collections=all_collections, all_photos=all_photos)


@api.post('/api/batches/<batch_id>/delete')
def delete_batch(batch_id):
    database, cfg = services()
    with exclusive_uploads():
        with database.connect() as db:
            own_batch(db, batch_id)
        deleted = delete_collections(database, cfg, session_id=session['sid'], batch_id=batch_id)
    return jsonify(deleted=deleted)


@api.post('/api/settings/collections/delete')
def delete_browser_collections():
    database, cfg = services()
    with exclusive_uploads():
        deleted = delete_collections(database, cfg, session_id=session['sid'])
    return jsonify(deleted=deleted)


@api.post('/api/settings/reset')
def reset_data():
    if not g.local_operator:
        abort(403, 'Reset all data from this computer using localhost.')
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or data.get('confirmation') != 'RESET':
        abort(400, 'Type RESET to confirm removal of all saved scans and activity.')
    database, cfg = services()
    with exclusive_uploads():
        deleted = delete_collections(database, cfg)
    return jsonify(deleted=deleted)


def read_events(database, batch_id, cursor):
    with database.connect() as db:
        rows = db.execute('SELECT * FROM events WHERE batch_id=? AND event_id>? ORDER BY event_id LIMIT 200', (batch_id, cursor)).fetchall()
        return [{**dict(r), 'created_at': iso(r['created_at']), 'payload': json.loads(r['payload_json'])} for r in rows]


@api.get('/api/batches/<batch_id>/events')
def poll_events(batch_id):
    database, _ = services()
    with database.connect() as db:
        own_batch(db, batch_id)
    events = read_events(database, batch_id, integer('after', 0))
    for event in events:
        event.pop('payload_json')
    return jsonify(events=events, cursor=events[-1]['event_id'] if events else integer('after', 0))


@api.get('/api/events')
def event_stream():
    database, _ = services()
    batch_id = request.args.get('batch_id', '')
    with database.connect() as db:
        own_batch(db, batch_id)
    try:
        cursor = max(int(request.headers.get('Last-Event-ID', 0)), integer('after', 0))
    except ValueError:
        abort(400, 'Invalid event cursor.')
    gate = current_app.extensions['listeners']
    if not gate.acquire(blocking=False):
        abort(429, 'SSE listener limit reached; use polling.')

    @stream_with_context
    def generate():
        nonlocal cursor
        started = last_heartbeat = time.monotonic()
        try:
            yield 'retry: 1500\n\n'
            # Bounded stream lifetime makes expired sessions recheck ownership on reconnect.
            while time.monotonic() - started < 300:
                with database.connect() as db:
                    if not db.execute('SELECT 1 FROM batches WHERE batch_id=?', (batch_id,)).fetchone():
                        yield 'event: removed\ndata: {}\n\n'
                        return
                rows = read_events(database, batch_id, cursor)
                for event in rows:
                    cursor = event['event_id']
                    event.pop('payload_json')
                    yield f'id: {cursor}\nevent: update\ndata: {json.dumps(event)}\n\n'
                if time.monotonic() - last_heartbeat > 10:
                    yield ': heartbeat\n\n'
                    last_heartbeat = time.monotonic()
                time.sleep(.25)
        finally:
            gate.release()
    return Response(generate(), mimetype='text/event-stream', headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache'})


@api.get('/api/evaluation/summary')
def evaluation_summary():
    return jsonify(evaluation.summary(services()[1].artifacts))


@api.get('/api/evaluation/figures')
def evaluation_figures():
    return jsonify(evaluation.figures(services()[1].artifacts))


@api.get('/api/evaluation/artifact/<path:relative>')
def evaluation_artifact(relative):
    cfg = services()[1]
    path = (cfg.artifacts / relative).resolve()
    if not path.is_relative_to((cfg.artifacts / 'figures').resolve()) or path.suffix not in ('.png', '.pdf') or not path.is_file():
        abort(404)
    return send_file(path)


@api.get('/api/export/<batch_id>')
def export(batch_id):
    database, _ = services()
    with database.connect() as db:
        own_batch(db, batch_id)
        ids = [r[0] for r in db.execute('SELECT image_id FROM images WHERE batch_id=? ORDER BY admission_seq', (batch_id,))]
    fmt = request.args.get('format', 'csv')
    if fmt not in ('csv', 'json'):
        abort(400, 'format must be csv or json.')
    fields = ['image_id', 'admission_seq', 'filename', 'model_key', 'status', 'predicted_fruit', 'fruit_confidence', 'predicted_quality',
              'quality_confidence', 'inference_ms', 'queue_wait_ms', 'preprocess_ms', 'end_to_end_ms', 'checkpoint_sha256',
              'preprocessing_sha256', 'device', 'started_at', 'completed_at', 'error_code', 'error_message']

    @stream_with_context
    def generate():
        first = True
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fields)
        if fmt == 'csv':
            writer.writeheader()
            yield buffer.getvalue()
            buffer.seek(0); buffer.truncate(0)
        else:
            yield '['
        for image_id in ids:
            with database.connect() as db:
                image = image_view(db, image_id)
            if not image:
                continue
            for key, job in image['jobs'].items():
                result = job['result'] or {}
                row = {field: result.get(field) for field in fields}
                row.update(image_id=image_id, admission_seq=image['admission_seq'], filename=image['original_filename'],
                           model_key=key, status=job['status'], checkpoint_sha256=job['model_checkpoint_sha256'],
                           preprocessing_sha256=image['preprocessing_sha256'], started_at=job['started_at'], completed_at=job['completed_at'],
                           error_code=job['error_code'], error_message=job['error_message'])
                if fmt == 'json':
                    yield ('' if first else ',') + json.dumps(row)
                    first = False
                else:
                    # Avoid spreadsheet formula execution from user-controlled filenames/errors.
                    row = {k: ("'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v) for k, v in row.items()}
                    writer.writerow(row)
                    yield buffer.getvalue()
                    buffer.seek(0); buffer.truncate(0)
        if fmt == 'json':
            yield ']'
    return Response(generate(), mimetype='application/json' if fmt == 'json' else 'text/csv',
                    headers={'Content-Disposition': f'attachment; filename="fruispect-{batch_id}.{fmt}"'})
