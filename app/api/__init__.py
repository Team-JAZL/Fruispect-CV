# Register the application API and connection blueprints.
from flask import Blueprint

api = Blueprint('api', __name__)


# Load route modules and register both application blueprints.
def register_api(app):
    from app.api import pages, health, batches, images, settings, events, research, exports
    from app.api.connection import connection
    app.register_blueprint(api)
    app.register_blueprint(connection)
