# Report storage totals and delete browser or host scan data.
from flask import abort, g, jsonify, request, session
from app.services.cleanup import delete_collections
from app.api import api
from app.api.common import services, exclusive_uploads


# Return browser storage counts and authorized host totals.
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


# Delete all collections owned by this browser.
@api.post('/api/settings/collections/delete')
def delete_browser_collections():
    database, cfg = services()
    with exclusive_uploads():
        deleted = delete_collections(database, cfg, session_id=session['sid'])
    return jsonify(deleted=deleted)


# Clear all scan data after explicit localhost reset confirmation.
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
