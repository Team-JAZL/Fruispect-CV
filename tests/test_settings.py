# Verify settings behavior.
from pathlib import Path

from app.services.cleanup import drain_deletions
from app.queue.coordinator import Coordinator
from conftest import batch, upload, ready, result
from test_tunnel import install_state

HEADERS = {'X-Fruispect': '1'}


# Verify newest default and explicit oldest.
def test_newest_default_and_explicit_oldest(client):
    ident = batch(client)
    accepted = upload(client, ident, 3).get_json()['accepted']
    path = f'/api/batches/{ident}/images'
    assert [r['image_id'] for r in client.get(path).get_json()['images']] == [r['image_id'] for r in reversed(accepted)]
    assert [r['image_id'] for r in client.get(path + '?sort=oldest').get_json()['images']] == [r['image_id'] for r in accepted]


# Verify delete current removes files and activity without resurrecting running job.
def test_delete_current_removes_files_and_activity_without_resurrecting_running_job(client, database, cfg):
    ident, retained = batch(client), batch(client)
    photo = upload(client, ident).get_json()['accepted'][0]['image_id']
    queue = Coordinator(database, cfg)
    ready(queue, 'resnet18', 'owner')
    job = queue.claim('resnet18', 'owner')
    assert job
    assert len(list(cfg.spool.iterdir())) == 2
    response = client.post(f'/api/batches/{ident}/delete', headers=HEADERS)
    assert response.status_code == 200
    assert response.get_json()['deleted'] == {'collections': 1, 'photos': 1, 'cleanup_pending': 0}
    assert client.get(f'/api/images/{photo}').status_code == 404
    assert not queue.finish(job['job_id'], 'owner', result=result())
    assert not queue.finish(job['job_id'], 'owner', error=RuntimeError('input removed'))
    assert not list(cfg.spool.iterdir())
    with database.connect() as db:
        for table in ('images', 'model_jobs', 'events', 'submissions'):
            assert db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
    assert client.get(f'/api/batches/{retained}').status_code == 200
    assert upload(client, retained).status_code == 202


# Verify delete browser collections obeys ownership.
def test_delete_browser_collections_obeys_ownership(client, app, database):
    mine = batch(client)
    other = app.test_client()
    theirs = batch(other)
    upload(other, theirs)
    assert client.post(f'/api/batches/{theirs}/delete', headers=HEADERS).status_code == 404
    assert client.post('/api/settings/collections/delete', headers=HEADERS).get_json()['deleted']['collections'] == 1
    assert client.get(f'/api/batches/{mine}').status_code == 404
    assert other.get(f'/api/batches/{theirs}').status_code == 200


# Verify full reset all browsers and orphans preserves models and connection.
def test_full_reset_all_browsers_and_orphans_preserves_models_and_connection(client, app, database, cfg):
    upload(client, batch(client))
    other = app.test_client()
    upload(other, batch(other))
    (cfg.spool / 'orphan.upload').write_bytes(b'abandoned')
    install_state(database)
    assert client.get('/api/settings').get_json()['all_photos'] == 2
    for body in ({}, {'confirmation': 'reset'}, ['RESET']):
        assert client.post('/api/settings/reset', headers=HEADERS, json=body).status_code == 400
    assert client.post('/api/settings/reset', json={'confirmation': 'RESET'}).status_code == 403
    response = client.post('/api/settings/reset', headers=HEADERS, json={'confirmation': 'RESET'})
    assert response.status_code == 200 and response.get_json()['deleted']['photos'] == 2
    assert client.get('/api/batches').get_json()['batches'] == []
    assert other.get('/api/batches').get_json()['batches'] == []
    assert not list(cfg.spool.iterdir())
    assert client.get('/api/connection').get_json()['connection']['status'] == 'ready'
    assert len(client.get('/api/models').get_json()['lanes']) == 3
    fresh = upload(client, batch(client))
    assert fresh.status_code == 202
    assert fresh.get_json()['accepted'][0]['admission_seq'] == 1


# Verify phone cannot reset server data or retry tunnel.
def test_phone_cannot_reset_server_data_or_retry_tunnel(client, app, database):
    install_state(database)
    phone = app.test_client()
    base = 'https://fruit.example.test'
    assert phone.post('/api/connect', base_url=base, headers=HEADERS, json={'code': 'A123B456'}).status_code == 200
    assert phone.get('/api/settings', base_url=base).get_json()['all_photos'] is None
    for path in ('/api/settings/reset', '/api/connection/retry'):
        assert phone.post(path, base_url=base, headers=HEADERS, json={'confirmation': 'RESET'}).status_code == 403


# Verify delete during upload returns conflict and releases slots.
def test_delete_during_upload_returns_conflict_and_releases_slots(client, app):
    ident = batch(client)
    gate = app.extensions['uploads']
    assert gate.acquire(blocking=False)
    try:
        response = client.post(f'/api/batches/{ident}/delete', headers=HEADERS)
        assert response.status_code == 409
        assert client.get(f'/api/batches/{ident}').status_code == 200
    finally:
        gate.release()
    assert client.post(f'/api/batches/{ident}/delete', headers=HEADERS).status_code == 200


# Verify locked file cleanup retries and refuses outside spool.
def test_locked_file_cleanup_retries_and_refuses_outside_spool(database, cfg, monkeypatch):
    cfg.spool.mkdir()
    locked = cfg.spool / 'locked.png'
    locked.write_bytes(b'test')
    outside = cfg.instance / 'session.key'
    original = outside.read_bytes()
    with database.connect(write=True) as db:
        db.executemany('INSERT INTO file_deletions VALUES(?)', [(str(locked),), (str(outside),)])
    unlink = Path.unlink
    # Guarded.
    def guarded(path, **kwargs):
        if path == locked:
            raise PermissionError('worker has input open')
        return unlink(path, **kwargs)
    monkeypatch.setattr(Path, 'unlink', guarded)
    assert drain_deletions(database, cfg) == 1
    assert outside.read_bytes() == original
    monkeypatch.setattr(Path, 'unlink', unlink)
    assert drain_deletions(database, cfg) == 0
    assert not locked.exists()


# Verify deleted collection closes existing event stream.
def test_deleted_collection_closes_existing_event_stream(client):
    ident = batch(client)
    response = client.get(f'/api/events?batch_id={ident}', buffered=False)
    stream = iter(response.response)
    assert b'retry:' in next(stream)
    assert client.post(f'/api/batches/{ident}/delete', headers=HEADERS).status_code == 200
    assert b'event: removed' in next(stream)
    response.close()
