# Serve the application page and maintained frontend assets.
from pathlib import Path
from flask import current_app, render_template, send_from_directory
from app.api import api
from app.api.common import services


# Render the workspace with server-configured limits.
@api.get('/')
def index():
    _, cfg = services()
    return render_template('fruispect.html', frontend_settings=cfg)


# Serve an asset safely from the maintained frontend directory.
@api.get('/static/fruispect/<path:filename>')
def frontend_asset(filename):

    return send_from_directory(Path(current_app.root_path).parent / 'frontend' / 'assets', filename)
