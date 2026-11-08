import os
import socket
import subprocess
import sys
import time
from pathlib import Path
import pytest
from app.storage.database import Database
from app.config import ROOT
from scripts.stress_test_queues import Client, exercise


@pytest.mark.models
def test_actual_supervisor_pipeline_and_graceful_stop(tmp_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    runtime = tmp_path / 'runtime'
    env = {**os.environ, 'FRUISPECT_INSTANCE': str(runtime), 'FRUISPECT_PORT': str(port),
           'FRUISPECT_HOST': '127.0.0.1', 'FRUISPECT_DEVICE': 'cpu', 'FRUISPECT_THREADS': '1', 'FRUISPECT_NGROK': '0'}
    with (tmp_path / 'supervisor.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, str(ROOT / 'main.py')], cwd=ROOT, env=env,
                                   stdout=log, stderr=subprocess.STDOUT)
        database = Database(runtime / 'fruispect.sqlite3')
        client = Client(f'http://127.0.0.1:{port}')
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                assert process.poll() is None, 'Supervisor stopped before readiness.'
                try:
                    if client.request('/api/readiness')['ready']:
                        break
                except (RuntimeError, OSError):
                    pass
                time.sleep(.5)
            else:
                raise AssertionError('Real model workers did not become ready.')
            report = exercise(client, 3, 120)
            assert report['completed_model_jobs'] == 9 and report['independence_evidence']
            with database.connect(write=True) as db:
                db.execute("INSERT OR REPLACE INTO service_state VALUES('shutdown_requested','1')")
            assert process.wait(timeout=60) == 0
            with database.connect() as db:
                assert db.execute("SELECT count(*) FROM model_registry WHERE state!='OFFLINE'").fetchone()[0] == 0
                assert db.execute("SELECT count(*) FROM model_jobs WHERE status='RUNNING'").fetchone()[0] == 0
        finally:
            if process.poll() is None:
                import psutil
                parent = psutil.Process(process.pid)
                descendants = parent.children(recursive=True)
                for child in descendants:
                    child.terminate()
                process.terminate()
                process.wait(timeout=10)
