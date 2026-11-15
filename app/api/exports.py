# Stream collection observations as CSV or JSON downloads.
import csv
import io
import json
from flask import Response, abort, request, stream_with_context
from app.services.views import image_view
from app.api import api
from app.api.common import services, own_batch


# Stream owned collection observations in the requested download format.
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

    # Yield the requested stream incrementally while releasing held resources.
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

                    row = {k: ("'" + v if isinstance(v, str) and v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v) for k, v in row.items()}
                    writer.writerow(row)
                    yield buffer.getvalue()
                    buffer.seek(0); buffer.truncate(0)
        if fmt == 'json':
            yield ']'
    return Response(generate(), mimetype='application/json' if fmt == 'json' else 'text/csv',
                    headers={'Content-Disposition': f'attachment; filename="fruispect-{batch_id}.{fmt}"'})
