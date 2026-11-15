# Check ngrok using a disposable health server and temporary storage.
import argparse
import io
import json
import tempfile
import threading
import time
from contextlib import redirect_stdout
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

from app.config import Settings
from app.connection.manager import TunnelManager
from app.storage.database import Database


class HealthOnlyHandler(BaseHTTPRequestHandler):
    # Do get.
    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        payload = b'{"status":"fruispect-connection-test"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    # Suppress diagnostic server access logs.
    def log_message(self, *_):
        pass


# Probe a temporary ngrok health endpoint and close its owned resources.
def check(timeout=20):
    report = {}
    with tempfile.TemporaryDirectory(prefix='fruispect-phone-check-') as folder:
        cfg = replace(Settings.from_env(), instance=Path(folder), ngrok_timeout=timeout)
        database = Database(cfg.database)
        database.initialize()
        with ThreadingHTTPServer(('127.0.0.1', 0), HealthOnlyHandler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            tunnel = TunnelManager(cfg, database, server.server_port)
            try:
                tunnel.reset(); tunnel.start()
                while tunnel.state.get('status') == 'starting':

                    with redirect_stdout(io.StringIO()):
                        tunnel.tick()
                    time.sleep(.1)
                report.update({k: tunnel.state.get(k) for k in ('status', 'message', 'error_code')})
                if report['status'] == 'ready':
                    request = Request(tunnel.state['public_url'] + '/health', headers={'ngrok-skip-browser-warning': '1'})
                    with urlopen(request, timeout=10) as response:
                        report['public_health_verified'] = json.load(response) == {'status': 'fruispect-connection-test'}
            except Exception as error:
                report.update(status='failed', message=type(error).__name__ + ': public health check failed.')
            finally:
                try:
                    tunnel.close()
                    report['owned_ngrok_stopped'] = tunnel.process is None
                finally:
                    server.shutdown(); thread.join(timeout=3)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, default=20)
    args = parser.parse_args()
    result = check(max(1, min(120, args.timeout)))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result.get('public_health_verified') and result.get('owned_ngrok_stopped') else 1)
