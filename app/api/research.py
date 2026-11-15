# Serve saved research metrics and validated figure artifacts.
from flask import abort, jsonify, send_file
from app.services import evaluation
from app.api import api
from app.api.common import services


# Return saved research metrics with their provenance.
@api.get('/api/evaluation/summary')
def evaluation_summary():
    return jsonify(evaluation.summary(services()[1].artifacts))


# Return the validated research figure catalog.
@api.get('/api/evaluation/figures')
def evaluation_figures():
    return jsonify(evaluation.figures(services()[1].artifacts))


# Serve an existing PNG or PDF from the research figures directory.
@api.get('/api/evaluation/artifact/<path:relative>')
def evaluation_artifact(relative):
    cfg = services()[1]
    path = (cfg.artifacts / relative).resolve()
    if not path.is_relative_to((cfg.artifacts / 'figures').resolve()) or path.suffix not in ('.png', '.pdf') or not path.is_file():
        abort(404)
    return send_file(path)
