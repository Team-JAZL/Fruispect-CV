# Replay durable collection events over polling and server-sent streams.
import json
import time
from flask import Response, abort, current_app, jsonify, request, stream_with_context
from app.storage.database import iso
from app.api import api
from app.api.common import services, own_batch, integer


# Read the next ordered page of durable collection events.
def read_events(database, batch_id, cursor):
    with database.connect() as db:
        rows = db.execute('SELECT * FROM events WHERE batch_id=? AND event_id>? ORDER BY event_id LIMIT 200', (batch_id, cursor)).fetchall()
        return [{**dict(r), 'created_at': iso(r['created_at']), 'payload': json.loads(r['payload_json'])} for r in rows]


# Return a page of owned collection events and its replay cursor.
@api.get('/api/batches/<batch_id>/events')
def poll_events(batch_id):
    database, _ = services()
    with database.connect() as db:
        own_batch(db, batch_id)
    events = read_events(database, batch_id, integer('after', 0))
    for event in events:
        event.pop('payload_json')
    return jsonify(events=events, cursor=events[-1]['event_id'] if events else integer('after', 0))


# Stream owned collection updates with heartbeats and a bounded lifetime.
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

    # Yield the requested stream incrementally while releasing held resources.
    @stream_with_context
    def generate():
        nonlocal cursor
        started = last_heartbeat = time.monotonic()
        try:
            yield 'retry: 1500\n\n'

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
