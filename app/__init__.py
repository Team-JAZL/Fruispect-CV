# Build the Flask application and register its services and routes.
import secrets
import threading
import time
from flask import Flask
from app.config import Settings
from app.storage.database import Database
from app.security import LocalAndHttpsSessions, register_security
from app.errors import register_errors
from app.api import register_api


# Build the configured Flask application with storage, security, and routes.
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

    register_security(app, cfg)
    register_errors(app)
    register_api(app)
    return app
