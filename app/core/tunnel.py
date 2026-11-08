"""Optional ngrok child process. Never downloads ngrok or changes its account config."""
import json
from collections import deque
import logging
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from app.config import ROOT
from app.core.process_guard import ChildProcessGuard

log = logging.getLogger(__name__)
KNOWN_NGROK = Path('D:/App Projects/z_ngrok-v3-stable-windows-amd64/ngrok.exe')


def find_ngrok(configured='', root=ROOT, home=None):
    """Bounded discovery in portable locations; no recursive whole-drive search."""
    home = home or Path.home()
    if configured:
        candidate = Path(configured).expanduser()
        return candidate.resolve() if candidate.is_file() else None
    names = ('ngrok.exe', 'ngrok')
    candidates = [root / name for name in names] + [root / 'tools' / name for name in names]
    found = shutil.which('ngrok')
    if found:
        candidates.append(Path(found))
    candidates.append(KNOWN_NGROK)
    for folder in (root.parent, root.parent.parent, home / 'Desktop', home / 'Downloads', home / 'OneDrive' / 'Desktop'):
        candidates.extend(folder / name for name in names)
        if folder.is_dir():
            candidates.extend(sorted(folder.glob('*ngrok*/*.exe')))
            candidates.extend(sorted(folder.glob('*ngrok*/ngrok')))
    for candidate in candidates:
        if candidate.is_file() and candidate.name.lower() in names:
            return candidate.resolve()
    return None


def read_tunnel(database):
    with database.connect() as db:
        row = db.execute("SELECT value FROM service_state WHERE key='tunnel'").fetchone()
    state = json.loads(row['value']) if row else {'status': 'local', 'message': 'Use this device to scan.'}
    if state.get('status') == 'ready' and state.get('expires_at', 0) < time.time():
        return {'status': 'offline', 'message': 'Phone link is offline. Scanning on this computer is available.'}
    return state


def https_origin(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
                and parsed.path in ('', '/') and not parsed.query and not parsed.fragment and parsed.port in (None, 443)):
            return f'https://{parsed.netloc.lower()}'
    except (TypeError, ValueError):
        pass
    return None


class TunnelManager:
    def __init__(self, settings, database, port):
        self.cfg, self.db, self.port = settings, database, port
        self.process = None
        self.reader = None
        self.guard = None
        self.last_error = None
        self.failure_reason = None
        self.started = None
        self.state = {}
        self.last_write = 0
        self.messages = deque(maxlen=100)
        self.mutex = threading.Lock()

    def publish(self, status, message, **values):
        self.state = {'status': status, 'message': message, **values}
        self.persist()

    def persist(self):
        if self.state.get('status') == 'ready':
            self.state['expires_at'] = time.time() + 15
        with self.db.connect(write=True) as db:
            db.execute("INSERT OR REPLACE INTO service_state VALUES('tunnel',?)", (json.dumps(self.state),))
        self.last_write = time.monotonic()

    def reset(self):
        self.publish('local', 'Use this device to scan.')

    def start(self):
        self.stop_process()
        self.last_error = self.failure_reason = None
        with self.mutex:
            self.messages.clear()
        if not self.cfg.ngrok_enabled:
            self.publish('disabled', 'Phone link is turned off. Scanning on this computer is available.')
            return
        executable = find_ngrok(self.cfg.ngrok_path)
        if not executable:
            self.publish('not_found', 'ngrok was not found. Use this device, or add ngrok and restart.')
            log.info('ngrok not found; continuing on localhost.')
            return
        upstream_host = '[::1]' if os.environ.get('FRUISPECT_HOST') == '::1' else '127.0.0.1'
        self.upstream = f'http://{upstream_host}:{self.port}'
        # Explicit info level prevents a saved warn/error log level hiding tunnel readiness.
        command = [str(executable), 'http', self.upstream, '--log=stdout', '--log-format=json', '--log-level=info', '--inspect=false']
        try:
            self.process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding='utf-8', errors='replace', bufsize=1,
                                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except OSError:
            self.publish('failed', 'ngrok could not start. Scanning on this computer is available.')
            log.warning('ngrok could not start; continuing on localhost.')
            return
        self.started = time.monotonic()
        try:
            self.guard = ChildProcessGuard(self.process)
        except (OSError, TypeError, ValueError):
            log.warning('Could not attach ngrok shutdown guard; graceful shutdown remains available.')
        self.publish('starting', 'Preparing a secure phone link…')

        process = self.process
        def consume():
            for line in process.stdout:
                try:
                    record = json.loads(line)
                except ValueError:
                    # Some CLI/authentication failures are plain text despite --log-format.
                    code = re.search(r'ERR_NGROK_\d+', line)
                    if code:
                        with self.mutex:
                            self.messages.append({'err': code.group(0)})
                    continue
                if not isinstance(record, dict):
                    continue
                # Read only structured endpoint and error fields, never print account/config logs.
                with self.mutex:
                    self.messages.append({k: record.get(k) for k in ('msg', 'url', 'addr', 'err')})
        self.reader = threading.Thread(target=consume, name='ngrok-output', daemon=True)
        self.reader.start()

    def tick(self):
        if not self.process:
            return
        exited = self.process.poll() is not None
        if exited and self.reader:
            self.reader.join(timeout=2)  # Drain final diagnostics before publishing failure.
        with self.mutex:
            messages, self.messages = self.messages, deque(maxlen=100)
        for record in messages:
            url = https_origin(record.get('url'))
            if url and record.get('msg') == 'started tunnel' and str(record.get('addr') or '').rstrip('/') == self.upstream:
                if self.state.get('public_url') != url:
                    self.publish('ready', 'Open this link on your phone.', public_url=url,
                                 pair_code=secrets.token_hex(4).upper(), generation=uuid.uuid4().hex)
                    print(f"Phone camera: {url}\nPairing code: {self.state['pair_code']}", flush=True)
            text = str(record.get('err') or '')
            error = re.search(r'ERR_NGROK_\d+', text)
            if error:
                self.last_error = error.group(0)
            lower = text.lower()
            for pattern, reason in (('no such host', 'DNS lookup failed.'), ('lookup ', 'DNS lookup failed.'),
                                    ('dial tcp', 'Cannot reach ngrok over the network.'),
                                    ('x509', 'The secure connection certificate could not be verified.')):
                if pattern in lower:
                    self.failure_reason = reason
                    break
        if exited:
            self.stop_process()
            self.publish_failure('Phone link could not connect.')
        elif self.state.get('status') != 'ready' and time.monotonic() - self.started > self.cfg.ngrok_timeout:
            self.stop_process()
            self.publish_failure('Phone link timed out.')
        elif self.state.get('status') == 'ready' and time.monotonic() - self.last_write > 5:
            self.persist()

    def publish_failure(self, prefix):
        advice = {
            'ERR_NGROK_108': 'Another ngrok agent is using this account. Close that agent, then retry the phone connection in Settings.',
            'ERR_NGROK_334': 'This ngrok endpoint is already online. Close its other agent, then retry in Settings.',
            'ERR_NGROK_4018': 'Configure your ngrok account and authtoken, then retry in Settings.',
            'ERR_NGROK_105': 'The ngrok authtoken is invalid. Update it, then retry in Settings.',
        }.get(self.last_error, (self.failure_reason or 'Check ngrok sign-in and Internet access.') + ' Retry the phone connection in Settings.')
        self.publish('failed', f'{prefix} {advice} Scanning on this computer is available.', error_code=self.last_error)
        log.warning('%s (%s)', self.state['message'], self.last_error or 'connection unavailable')

    def stop_process(self):
        process = self.process
        if not process:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if self.reader:
            self.reader.join(timeout=2)
        if process.stdout:
            process.stdout.close()
        self.process = None
        self.reader = None
        if self.guard:
            self.guard.close()
            self.guard = None

    def close(self):
        self.stop_process()
        self.publish('stopped', 'Phone link is offline.')
