# Share API service access, ownership checks, and upload exclusion.
from flask import abort, current_app, g, request, session
from contextlib import contextmanager


# Return the current application database and configuration.
def services():
    return current_app.extensions['db'], current_app.extensions['settings']


# Require the requested collection to belong to this browser session.
def own_batch(db, batch_id):
    if not db.execute('SELECT 1 FROM batches WHERE batch_id=? AND session_id=?', (batch_id, session['sid'])).fetchone():
        abort(404, 'Batch is unavailable, expired, or belongs to another browser session.')


# Authorize collection reads and commands within the request's protected scope.
def access_batch(db, batch_id):
    if not g.global_collections:
        own_batch(db, batch_id)
    elif not db.execute('SELECT 1 FROM batches WHERE batch_id=?', (batch_id,)).fetchone():
        abort(404, 'Collection is unavailable or expired.')


# Authorize image access within the request's protected collection scope.
def access_image(db, image_id):
    row = db.execute('SELECT batch_id FROM images WHERE image_id=?', (image_id,)).fetchone()
    if not row:
        abort(404)
    access_batch(db, row['batch_id'])


# Parse and bound an integer query parameter.
def integer(name, default, lower=0, upper=1000000000):
    try:
        value = int(request.args.get(name, default))
    except ValueError:
        abort(400, f'{name} must be an integer.')
    return max(lower, min(upper, value))


# Reserve all upload slots while a collection deletion runs.
@contextmanager
def exclusive_uploads():

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
