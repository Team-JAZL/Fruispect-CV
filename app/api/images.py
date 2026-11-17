# Filter collections and serve images within personal or protected host scopes.
from pathlib import Path
from flask import abort, g, jsonify, request, send_file
from app.queue.coordinator import Coordinator
from app.services.views import image_view
from app.api import api
from app.api.common import services, access_batch, access_image, integer


# Return filtered and paginated image snapshots within the authorized scope.
@api.get('/api/batches/<batch_id>/images')
@api.get('/api/global/batches/<batch_id>/images')
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
        access_batch(db, batch_id)
        total = db.execute(f'SELECT count(*) FROM images i WHERE {where}', params).fetchone()[0]
        ids = db.execute(f'SELECT image_id FROM images i WHERE {where} ORDER BY admission_seq {order} LIMIT ? OFFSET ?', (*params, limit, (page - 1) * limit)).fetchall()
        result = [image_view(db, r['image_id'], global_scope=g.global_collections) for r in ids]
    return jsonify(images=result, page=page, limit=limit, total=total)


# Return an authorized image with independent model job results.
@api.get('/api/images/<image_id>')
@api.get('/api/global/images/<image_id>')
def image(image_id):
    database, _ = services()
    with database.connect() as db:
        access_image(db, image_id)
        result = image_view(db, image_id, global_scope=g.global_collections)
    return jsonify(image=result)


# Serve an authorized image thumbnail restricted to private spool storage.
@api.get('/api/images/<image_id>/thumbnail')
@api.get('/api/global/images/<image_id>/thumbnail')
def thumbnail(image_id):
    database, cfg = services()
    with database.connect() as db:
        access_image(db, image_id)
        row = db.execute('SELECT image_path,input_status FROM images WHERE image_id=?', (image_id,)).fetchone()
        path = Path(row['image_path']).resolve()
    if not path.is_relative_to(cfg.spool.resolve()) or not path.is_file():
        abort(404, 'Thumbnail not ready.')
    return send_file(path, mimetype='image/jpeg')


# Cancel unfinished jobs for an authorized image.
@api.post('/api/images/<image_id>/cancel')
@api.post('/api/global/images/<image_id>/cancel')
def cancel_image(image_id):
    database, cfg = services()
    with database.connect() as db:
        access_image(db, image_id)
    return jsonify(cancelled_or_requested=Coordinator(database, cfg).cancel(image_id=image_id))
