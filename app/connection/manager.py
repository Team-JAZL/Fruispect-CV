# Manage the owned ngrok process and persist phone connection state.
import json
from collections import deque
import logging
import os
import re
import secrets
import subprocess
import threading
import time
import uuid
from app.runtime.guard import ChildProcessGuard
from app.connection.discovery import find_ngrok
from app.connection.state import https_origin

log = logging.getLogger(__name__)


class TunnelManager:
    # Initialize the component and its required dependencies.
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

    # Replace the public connection state and persist its latest values.
    def publish(self, status, message, **values):
        self.state = {'status': status, 'message': message, **values}
        self.persist()

    # Save connection state and refresh its ready heartbeat expiry.
    def persist(self):
        if self.state.get('status') == 'ready':
            self.state['expires_at'] = time.time() + 15
        with self.db.connect(write=True) as db:
            db.execute("INSERT OR REPLACE INTO service_state VALUES('tunnel',?)", (json.dumps(self.state),))
        self.last_write = time.monotonic()

    # Publish the initial local-only phone connection state.
    def reset(self):
        self.publish('local', 'Use this device to scan.')

    # Launch the owned ngrok process and begin reading structured diagnostics.
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
        # Collect endpoint and error fields from the owned process output.
        def consume():
            for line in process.stdout:
                try:
                    record = json.loads(line)
                except ValueError:

                    code = re.search(r'ERR_NGROK_\d+', line)
                    if code:
                        with self.mutex:
                            self.messages.append({'err': code.group(0)})
                    continue
                if not isinstance(record, dict):
                    continue

                with self.mutex:
                    self.messages.append({k: record.get(k) for k in ('msg', 'url', 'addr', 'err')})
        self.reader = threading.Thread(target=consume, name='ngrok-output', daemon=True)
        self.reader.start()

    # Process tunnel diagnostics and enforce readiness and timeout rules.
    def tick(self):
        if not self.process:
            return
        exited = self.process.poll() is not None
        if exited and self.reader:
            self.reader.join(timeout=2)
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

    # Publish actionable connection failure details without exposing account logs.
    def publish_failure(self, prefix):
        advice = {
            'ERR_NGROK_108': 'Another ngrok agent is using this account. Close that agent, then retry the phone connection in Settings.',
            'ERR_NGROK_334': 'This ngrok endpoint is already online. Close its other agent, then retry in Settings.',
            'ERR_NGROK_4018': 'Configure your ngrok account and authtoken, then retry in Settings.',
            'ERR_NGROK_105': 'The ngrok authtoken is invalid. Update it, then retry in Settings.',
        }.get(self.last_error, (self.failure_reason or 'Check ngrok sign-in and Internet access.') + ' Retry the phone connection in Settings.')
        self.publish('failed', f'{prefix} {advice} Scanning on this computer is available.', error_code=self.last_error)
        log.warning('%s (%s)', self.state['message'], self.last_error or 'connection unavailable')

    # Stop the owned tunnel process and release its reader and process guard.
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

    # Release owned process resources and publish shutdown state.
    def close(self):
        self.stop_process()
        self.publish('stopped', 'Phone link is offline.')
