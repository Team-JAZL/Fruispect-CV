"""Fruispect local application factory. Workers are launched separately."""
import hmac
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit
from flask import Flask, g, jsonify, request, session
from flask.sessions import SecureCookieSessionInterface
from werkzeug.exceptions import HTTPException
from app.config import Settings
from app.storage.database import Database
from app.core.tunnel import read_tunnel


class LocalAndHttpsSessions(SecureCookieSessionInterface):
    def get_cookie_secure(self, app):
        return request.is_secure or super().get_cookie_secure(app)


def create_app(settings=None):
    cfg = settings or Settings.from_env()
    cfg.instance.mkdir(parents=True, exist_ok=True)
    secret_path = cfg.instance / 'session.key'
    try:
        with secret_path.open('x', encoding='ascii') as stream:
            stream.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    app = Flask(__name__)
    app.session_interface = LocalAndHttpsSessions()
    app.config.update(SECRET_KEY=secret_path.read_text(), MAX_CONTENT_LENGTH=cfg.max_file_bytes * 4 + 1024 * 1024,
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      MAX_FORM_PARTS=10, MAX_FORM_MEMORY_SIZE=128 * 1024)
    app.extensions['settings'] = cfg
    app.extensions['db'] = Database(cfg.database)
    app.extensions['uploads'] = threading.BoundedSemaphore(cfg.upload_slots)
    app.extensions['listeners'] = threading.BoundedSemaphore(8)
    app.extensions['pairing_limiter'] = {'lock': threading.Lock(), 'window': time.monotonic(), 'attempts': 0}
    app.extensions['db'].initialize()

    @app.before_request
    def secure_local_app():
        g.tunnel_state = read_tunnel(app.extensions['db'])
        host = urlsplit('//' + request.host).hostname
        g.local_operator = (host in ('localhost', '127.0.0.1', '::1') and request.remote_addr in ('127.0.0.1', '::1')
                            and not request.is_secure)
        g.via_tunnel = (g.tunnel_state.get('status') == 'ready' and request.is_secure
                        and request.remote_addr in ('127.0.0.1', '::1')
                        and request.host.lower() == urlsplit(g.tunnel_state.get('public_url', '')).netloc.lower())
        if not cfg.allow_lan and not g.local_operator and not g.via_tunnel:
            return jsonify(error={'code': 'HOST_DENIED', 'message': 'Open localhost or the current phone link from your computer.'}), 403
        if cfg.access_token:
            auth = request.authorization
            if not auth or not hmac.compare_digest(auth.password or '', cfg.access_token):
                return ('Fruispect access token required.', 401, {'WWW-Authenticate': 'Basic realm="Fruispect"'})
        if request.method == 'POST':
            if request.headers.get('X-Fruispect') != '1':
                return jsonify(error={'code': 'CSRF', 'message': 'X-Fruispect: 1 required.'}), 403
            if request.headers.get('Origin') and request.headers['Origin'].rstrip('/') != request.host_url.rstrip('/'):
                return jsonify(error={'code': 'ORIGIN_DENIED', 'message': 'Same-origin requests required.'}), 403
        if 'sid' not in session:
            session['sid'] = secrets.token_urlsafe(24)
        if (g.via_tunnel and session.get('tunnel_generation') != g.tunnel_state.get('generation')
                and request.path not in ('/', '/api/connection', '/api/connect') and not request.path.startswith('/static/')):
            return jsonify(error={'code': 'PAIRING_REQUIRED', 'message': 'Connect using the code shown on the computer.'}), 401

    @app.after_request
    def headers(response):
        response.headers.update({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
            'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"})
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={'code': error.name.upper().replace(' ', '_'), 'message': error.description}), error.code

    @app.errorhandler(Exception)
    def internal_error(error):
        app.logger.exception('Request failed')
        return jsonify(error={'code': 'INTERNAL_ERROR', 'message': 'Request failed. Accepted work remains durable; see the local server log.'}), 500

    from app.api.routes import api
    from app.api.routes_connection import connection
    app.register_blueprint(api)
    app.register_blueprint(connection)
    return app
