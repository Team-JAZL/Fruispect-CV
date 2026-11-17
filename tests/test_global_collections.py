# Verify host collection access, durable upload attribution, and scoped controls.
import csv
import io
from dataclasses import replace
from pathlib import Path
import pytest
from app import create_app
from app.queue.coordinator import Coordinator
from app.services.cleanup import maintain
from conftest import batch, upload, png, ready, result
from test_tunnel import install_state

HEADERS = {'X-Fruispect': '1'}
ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'


# Create a LAN client with an independent browser identity and phone report.
def phone(app, address='192.0.2.10', agent=ANDROID):
    client = app.test_client()
    client.environ_base.update(REMOTE_ADDR=address, HTTP_USER_AGENT=agent)
    return client


# Verify all retained devices remain visible after disconnection and host restart.
def test_global_history_survives_disconnection_and_restart(cfg):
    cfg = replace(cfg, allow_lan=True)
    app = create_app(cfg)
    host, first, second = app.test_client(), phone(app), phone(app, '192.0.2.11', 'iPhone Version/18.0 Safari/605.1')
    own, remote, other = batch(host), batch(first), batch(second)
    own_photo = upload(host, own).get_json()['accepted'][0]['image_id']
    remote_photo = upload(first, remote).get_json()['accepted'][0]['image_id']
    upload(second, other)
    assert {row['batch_id'] for row in host.get('/api/batches').get_json()['batches']} == {own}
    assert {row['batch_id'] for row in first.get('/api/batches').get_json()['batches']} == {remote}
    assert host.get(f'/api/images/{remote_photo}').status_code == 404
    assert first.get(f'/api/images/{own_photo}').status_code == 404
    assert first.get(f'/api/batches/{other}').status_code == 404
    source = host.get(f'/api/global/images/{remote_photo}').get_json()['image']['upload_source']
    first.delete_cookie('session')
    assert first.get('/api/batches').get_json()['batches'] == []
    restarted = create_app(cfg).test_client()
    history = restarted.get('/api/global/batches').get_json()['batches']
    assert {row['batch_id'] for row in history} == {own, remote, other}
    assert all('session_id' not in row and 'request_key' not in row for row in history)
    image = restarted.get(f'/api/global/images/{remote_photo}').get_json()['image']
    assert image['upload_source'] == source
    assert restarted.get(image['thumbnail_url']).status_code == 200
    assert image['thumbnail_url'] == f'/api/global/images/{remote_photo}/thumbnail'
    assert len(image['jobs']) == 3


# Verify every global endpoint rejects remote access even with spoofed proxy headers.
@pytest.mark.parametrize('method,path', [
    ('get', '/batches'), ('get', '/batches/missing'), ('get', '/batches/missing/images'),
    ('get', '/images/missing'), ('get', '/images/missing/thumbnail'),
    ('get', '/batches/missing/events'), ('get', '/events?batch_id=missing'), ('get', '/export/missing'),
    ('post', '/batches/missing/cancel'), ('post', '/batches/missing/delete'), ('post', '/images/missing/cancel'),
])
def test_global_routes_are_host_only(cfg, method, path):
    remote = phone(create_app(replace(cfg, allow_lan=True)))
    response = getattr(remote, method)('/api/global' + path, headers={**HEADERS,
        'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'http'})
    assert response.status_code == 403
    assert response.get_json()['error']['code'] == 'LOCAL_ONLY'


# Verify paired tunnel devices cannot read global data or claim a proxy IP as theirs.
def test_tunnel_attribution_and_global_denial(app, client, database):
    install_state(database)
    remote = app.test_client()
    base = 'https://fruit.example.test'
    assert remote.get('/api/global/batches', base_url=base).status_code == 403
    assert remote.post('/api/connect', base_url=base, headers=HEADERS, json={'code': 'A123B456'}).status_code == 200
    ident = remote.post('/api/batches', base_url=base, headers=HEADERS).get_json()['batch']['batch_id']
    response = remote.post(f'/api/batches/{ident}/images', base_url=base,
        headers={**HEADERS, 'Idempotency-Key': 'phone', 'Sec-CH-UA-Model': '"Pixel 9"',
                 'Sec-CH-UA-Platform': '"Android"', 'Sec-CH-UA-Platform-Version': '"15.0.0"',
                 'X-Forwarded-For': '198.51.100.21'}, data={'images': (io.BytesIO(png()), 'phone.png')})
    image_id = response.get_json()['accepted'][0]['image_id']
    source = client.get(f'/api/global/images/{image_id}').get_json()['image']['upload_source']
    assert source['brand'] == 'Google' and source['model'] == 'Pixel 9'
    assert source['platform'] == 'Android 15.0.0'
    assert source['connection_type'] == 'tunnel' and source['remote_address'] is None
    assert remote.get('/api/global/batches', base_url=base).status_code == 403


# Verify source identity is stable, private, bounded, and immutable across upload retries.
def test_source_snapshots_are_private_and_idempotent(cfg):
    app = create_app(replace(cfg, allow_lan=True))
    host, remote = app.test_client(), phone(app)
    ident = batch(remote)
    image_id = upload(remote, ident, key='same').get_json()['accepted'][0]['image_id']
    source = host.get(f'/api/global/images/{image_id}').get_json()['image']['upload_source']
    assert source['brand'] == 'Samsung' and source['model'] == 'SM-S918B'
    assert source['browser'] == 'Chrome 130.0.0.0'
    assert source['remote_address'] == '192.0.2.10'
    assert len(source['device_id']) == 24
    with remote.session_transaction() as session:
        assert session['sid'] not in str(source)
    local = remote.get(f'/api/images/{image_id}').get_json()['image']
    assert 'upload_source' not in local
    assert 'upload_source' not in remote.get(f'/api/batches/{ident}/images').get_json()['images'][0]
    assert 'upload_device_id' not in remote.get(f'/api/export/{ident}?format=json').get_json()[0]
    remote.environ_base['HTTP_USER_AGENT'] = 'changed report'
    replay = upload(remote, ident, key='same').get_json()['accepted'][0]
    assert replay['duplicate'] and replay['image_id'] == image_id
    assert host.get(f'/api/global/images/{image_id}').get_json()['image']['upload_source'] == source
    remote.environ_base['HTTP_SEC_CH_UA_MODEL'] = 'x' * 400
    next_id = upload(remote, batch(remote)).get_json()['accepted'][0]['image_id']
    next_source = host.get(f'/api/global/images/{next_id}').get_json()['image']['upload_source']
    assert next_source['device_id'] == source['device_id']
    assert len(next_source['model']) == 200 and next_source['brand'] is None
    stranger = phone(app)
    stranger_id = upload(stranger, batch(stranger)).get_json()['accepted'][0]['image_id']
    assert host.get(f'/api/global/images/{stranger_id}').get_json()['image']['upload_source']['device_id'] != source['device_id']


# Verify global filtering, result exports, and replay use the shared collection semantics.
def test_global_results_filters_and_exports(app, client, database, cfg):
    remote = app.test_client()
    ident = batch(remote)
    ids = upload(remote, ident, 3, filename='=fruit.png').get_json()['accepted']
    queue = Coordinator(database, cfg)
    ready(queue, 'resnet18', 'worker')
    job = queue.claim('resnet18', 'worker')
    queue.finish(job['job_id'], 'worker', result=result())
    path = f'/api/global/batches/{ident}/images'
    page = client.get(path + '?limit=1&page=2&sort=oldest').get_json()
    assert page['total'] == 3 and page['images'][0]['image_id'] == ids[1]['image_id']
    filtered = client.get(path + '?fruit=Apple&quality=Good&status=COMPLETED&search=fruit').get_json()
    assert filtered['total'] == 1
    assert client.get(path + '?fruit=Banana').get_json()['total'] == 0
    observations = client.get(f'/api/global/export/{ident}?format=json').get_json()
    assert len(observations) == 9
    assert next(row for row in observations if row['model_key'] == 'resnet18')['predicted_fruit'] == 'Apple'
    assert observations[0]['upload_device_id'] == filtered['images'][0]['upload_source']['device_id']
    rows = list(csv.DictReader(io.StringIO(client.get(f'/api/global/export/{ident}').get_data(as_text=True))))
    assert rows[0]['filename'].startswith("'=") and rows[0]['upload_connection_type'] == 'host'
    events = client.get(f'/api/global/batches/{ident}/events').get_json()
    assert events['events'] and not client.get(f'/api/global/batches/{ident}/events?after={events["cursor"]}').get_json()['events']
    stream = client.get(f'/api/global/events?batch_id={ident}', buffered=False)
    assert b'retry:' in next(iter(stream.response))
    stream.close()


# Verify deleting a remote collection preserves other files, sequence numbers, and jobs.
def test_global_delete_is_scoped_and_cascades_sources(app, client, database, cfg):
    remote = app.test_client()
    removed, retained = batch(remote), batch(client)
    removed_id = upload(remote, removed).get_json()['accepted'][0]['image_id']
    retained_image = upload(client, retained).get_json()['accepted'][0]
    with database.connect() as db:
        retained_path = Path(db.execute('SELECT image_path FROM images WHERE image_id=?', (retained_image['image_id'],)).fetchone()[0])
    assert client.post(f'/api/global/images/{removed_id}/cancel', headers=HEADERS).status_code == 200
    response = client.post(f'/api/global/batches/{removed}/delete', headers=HEADERS)
    assert response.get_json()['deleted']['photos'] == 1
    assert retained_path.is_file()
    assert remote.get(f'/api/batches/{removed}').status_code == 404
    assert client.get(f'/api/global/images/{removed_id}').status_code == 404
    assert client.get(f'/api/images/{retained_image["image_id"]}/thumbnail').status_code == 200
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM upload_sources').fetchone()[0] == 1
    newer = upload(client, retained).get_json()['accepted'][0]
    assert newer['admission_seq'] > retained_image['admission_seq']
    assert client.post(f'/api/global/batches/{retained}/cancel', headers=HEADERS).status_code == 200
    assert client.post('/api/settings/reset', headers=HEADERS, json={'confirmation': 'RESET'}).status_code == 200
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM upload_sources').fetchone()[0] == 0


# Verify retention removes upload attribution together with its scan.
def test_expiration_removes_upload_sources(client, database, cfg):
    ident = batch(client)
    upload(client, ident)
    client.post(f'/api/batches/{ident}/cancel', headers=HEADERS)
    with database.connect(write=True) as db:
        db.execute('UPDATE images SET retention_expires_at=0')
        db.execute('UPDATE batches SET created_at=0')
    assert maintain(database, cfg) == 1
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM upload_sources').fetchone()[0] == 0


# Verify adding attribution storage does not rewrite retained scans or invent device reports.
def test_initialize_preserves_existing_scans(client, database, cfg):
    ident = batch(client)
    image_id = upload(client, ident).get_json()['accepted'][0]['image_id']
    with database.connect(write=True) as db:
        db.execute('DROP TABLE upload_sources')
    restarted = create_app(cfg).test_client()
    image = restarted.get(f'/api/global/images/{image_id}').get_json()['image']
    assert image['upload_source'] is None and len(image['jobs']) == 3
    assert restarted.get(image['thumbnail_url']).status_code == 200
