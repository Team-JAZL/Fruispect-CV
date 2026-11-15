# Return consistent JSON responses for HTTP and application errors.
from flask import jsonify
from werkzeug.exceptions import HTTPException


# Install consistent JSON handlers for request and server failures.
def register_errors(app):
    # Translate HTTP exceptions into structured API errors.
    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={'code': error.name.upper().replace(' ', '_'), 'message': error.description}), error.code

    # Log unexpected failures and return a stable API error.
    @app.errorhandler(Exception)
    def internal_error(error):
        app.logger.exception('Request failed')
        return jsonify(error={'code': 'INTERNAL_ERROR', 'message': 'Request failed. Accepted work remains durable; see the local server log.'}), 500
