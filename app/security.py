# Enforce browser sessions, host access, pairing, and response headers.
import hmac
import secrets
from urllib.parse import urlsplit
from flask import g, jsonify, request, session
from flask.sessions import SecureCookieSessionInterface
from app.connection.state import read_tunnel


class LocalAndHttpsSessions(SecureCookieSessionInterface):
    # Require secure session cookies for HTTPS requests.
    def get_cookie_secure(self, app):
        return request.is_secure or super().get_cookie_secure(app)


# Install request access checks and restrictive response headers.
def register_security(app, cfg):
    # Validate host access, command origin, session identity, and remote pairing.
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

    # Apply cache, content, referrer, and content security headers.
    @app.after_request
    def headers(response):
        response.headers.update({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
            'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"})
        return response
