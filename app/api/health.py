# Report service liveness, storage readiness, and model queues.
from flask import jsonify
from app.services.views import queues_view
from app.storage.database import iso
from app.api import api
from app.api.common import services


# Return API liveness and the current UTC time.
@api.get('/api/health')
def health():
    return jsonify(status='alive', time=iso())


# Report storage integrity and readiness of every model lane.
@api.get('/api/readiness')
def readiness():
    database, cfg = services()
    lanes = queues_view(database)
    with database.connect() as db:
        storage = db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    ready = storage and all(r['state'] == 'READY' for r in lanes)
    return jsonify(ready=ready, storage_ready=storage, device=cfg.device, models=lanes), 200 if ready else 503


# Return current model lane health and queue telemetry.
@api.get('/api/models')
@api.get('/api/queues')
def queues():
    return jsonify(lanes=queues_view(services()[0]), provenance='Current Application Inference')
