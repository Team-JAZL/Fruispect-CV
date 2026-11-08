import io
import uuid
from dataclasses import replace
import pytest
from PIL import Image
from app import create_app
from app.config import Settings, MODELS
from app.storage.database import Database


@pytest.fixture
def cfg(tmp_path):
    return replace(Settings(), instance=tmp_path, lease_seconds=1)


@pytest.fixture
def app(cfg):
    app = create_app(cfg)
    app.testing = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def database(app):
    return app.extensions['db']


def png(size=(53, 71), color=(200, 110, 30)):
    stream = io.BytesIO()
    Image.new('RGB', size, color).save(stream, 'PNG')
    return stream.getvalue()


def batch(client):
    return client.post('/api/batches', headers={'X-Fruispect':'1'}).get_json()['batch']['batch_id']


def upload(client, batch_id, count=1, key=None, offset=0, contents=None, filename='fruit.png'):
    return client.post(f'/api/batches/{batch_id}/images',
                       headers={'X-Fruispect':'1','Idempotency-Key':key or uuid.uuid4().hex},
                       data={'offset':str(offset),'images':[(io.BytesIO(contents if contents is not None else png()),filename) for _ in range(count)]})


def ready(queue, key, owner):
    assert queue.acquire_lane(key, owner)
    queue.register(key, owner, 'READY', {'checkpoint_sha256':'test-harness-only','device':'cpu'})


def result():
    return {'inference_ms':1,'predicted_fruit':'Apple','predicted_quality':'Good'}
