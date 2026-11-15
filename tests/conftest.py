# Provide shared test fixtures and image helpers.
import io
import uuid
from dataclasses import replace
import pytest
from PIL import Image
from app import create_app
from app.config import Settings


# Cfg.
@pytest.fixture
def cfg(tmp_path):
    return replace(Settings(), instance=tmp_path, lease_seconds=1)


# App.
@pytest.fixture
def app(cfg):
    app = create_app(cfg)
    app.testing = True
    return app


# Client.
@pytest.fixture
def client(app):
    return app.test_client()


# Return the configured private SQLite database path.
@pytest.fixture
def database(app):
    return app.extensions['db']


# Png.
def png(size=(53, 71), color=(200, 110, 30)):
    stream = io.BytesIO()
    Image.new('RGB', size, color).save(stream, 'PNG')
    return stream.getvalue()


# Return the requested browser-owned collection summary.
def batch(client):
    return client.post('/api/batches', headers={'X-Fruispect':'1'}).get_json()['batch']['batch_id']


# Upload.
def upload(client, batch_id, count=1, key=None, offset=0, contents=None, filename='fruit.png'):
    return client.post(f'/api/batches/{batch_id}/images',
                       headers={'X-Fruispect':'1','Idempotency-Key':key or uuid.uuid4().hex},
                       data={'offset':str(offset),'images':[(io.BytesIO(contents if contents is not None else png()),filename) for _ in range(count)]})


# Ready.
def ready(queue, key, owner):
    assert queue.acquire_lane(key, owner)
    queue.register(key, owner, 'READY', {'checkpoint_sha256':'test-harness-only','device':'cpu'})


# Result.
def result():
    return {'inference_ms':1,'predicted_fruit':'Apple','predicted_quality':'Good'}
