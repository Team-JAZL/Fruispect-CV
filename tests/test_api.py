# Verify api behavior.
import csv
import io
from dataclasses import replace
import pytest
from app import create_app
from app.services.cleanup import maintain
from app.queue.coordinator import Coordinator
from conftest import batch, upload, png, ready, result


# Verify batch integrity and replay.
@pytest.mark.parametrize('count',[1,10,50,100])
def test_batch_integrity_and_replay(client,database,cfg,count):
    b=batch(client)
    accepted=[]
    for offset in range(0,count,4):
        response=upload(client,b,min(4,count-offset),key=f'chunk-{offset}',offset=offset)
        assert response.status_code==202
        accepted.extend(response.get_json()['accepted'])
    assert len(accepted)==count
    assert len({i['image_id'] for i in accepted})==count
    assert [i['admission_seq'] for i in accepted]==sorted(i['admission_seq'] for i in accepted)
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM model_jobs').fetchone()[0]==3*count
        assert db.execute("SELECT count(*) FROM images WHERE input_status='READY'").fetchone()[0]==count
    duplicate=upload(client,b,min(4,count),key='chunk-0',offset=0)
    assert all(i['duplicate'] for i in duplicate.get_json()['accepted'])
    assert client.get(f'/api/batches/{b}').get_json()['batch']['summary']['accepted']==count
    assert len(client.get(f'/api/batches/{b}/images?limit=20').get_json()['images'])==min(count,20)
    events=client.get(f'/api/batches/{b}/events').get_json()
    next_events=client.get(f"/api/batches/{b}/events?after={events['cursor']}").get_json()['events']
    assert all(e['event_id']>events['cursor'] for e in next_events)


# Verify invalid partial idempotency and path.
def test_invalid_partial_idempotency_and_path(client,database):
    b=batch(client)
    response=client.post(f'/api/batches/{b}/images',headers={'X-Fruispect':'1','Idempotency-Key':'mixed'},data={'images':[(io.BytesIO(png()),'../../fruit.png'),(io.BytesIO(b'garbage'),'fake.jpg')]})
    assert response.status_code==202
    data=response.get_json();assert len(data['accepted'])==len(data['rejected'])==1
    image=client.get('/api/images/'+data['accepted'][0]['image_id']).get_json()['image']
    assert image['original_filename']=='fruit.png'
    assert len(image['jobs'])==3
    conflict=upload(client,b,key='mixed',contents=png(color=(1,2,3)))
    assert conflict.status_code==409
    empty=upload(client,b,contents=b'')
    assert empty.status_code==422


# Verify backpressure and storage.
def test_backpressure_and_storage(client,database,cfg):
    small=create_app(replace(cfg,max_queue=1))
    c=small.test_client();b=batch(c)
    response=upload(c,b,2)
    assert response.status_code==202
    assert len(response.get_json()['accepted'])==1
    assert response.get_json()['rejected'][0]['code']=='QUEUE_FULL'
    replay=upload(c,b,key='stable')
    assert replay.status_code==429
    full=create_app(replace(cfg,max_spool_bytes=1));c2=full.test_client();b2=batch(c2)
    assert upload(c2,b2).status_code==503


# Verify idempotent replay when spool capacity exhausted.
def test_idempotent_replay_when_spool_capacity_exhausted(client,database,cfg):
    b=batch(client)
    first=upload(client,b,key='capacity-replay').get_json()['accepted'][0]
    limited=create_app(replace(cfg,max_spool_bytes=1)).test_client()

    limited.set_cookie('session',client.get_cookie('session').value)
    replay=upload(limited,b,key='capacity-replay')
    assert replay.status_code==202 and replay.get_json()['accepted'][0]['image_id']==first['image_id']
    assert upload(limited,b).status_code==503


# Verify byte pixel animation and decode limits.
def test_byte_pixel_animation_and_decode_limits(cfg):
    a=create_app(replace(cfg,max_file_bytes=50));c=a.test_client();b=batch(c)
    assert upload(c,b).status_code==413
    a=create_app(replace(cfg,max_pixels=50));c=a.test_client();b=batch(c)
    assert upload(c,b).get_json()['rejected'][0]['code']=='INVALID_IMAGE'
    from PIL import Image
    animated=io.BytesIO();Image.new('RGB',(2,2),'red').save(animated,format='PNG',save_all=True,append_images=[Image.new('RGB',(2,2),'green')])
    assert upload(c,b,contents=animated.getvalue()).status_code==422


# Verify session csrf and origin.
def test_session_csrf_and_origin(client,app):
    assert client.post('/api/batches').status_code==403
    assert client.post('/api/batches',headers={'X-Fruispect':'1','Origin':'https://evil.invalid'}).status_code==403
    assert client.get('/api/health',headers={'Host':'evil.invalid'}).status_code==403
    b=batch(client)
    assert app.test_client().get(f'/api/batches/{b}').status_code==404


# Verify batch idempotency and export.
def test_batch_idempotency_and_export(client,database,cfg):
    first=client.post('/api/batches',headers={'X-Fruispect':'1','Idempotency-Key':'create'}).get_json()['batch']['batch_id']
    second=client.post('/api/batches',headers={'X-Fruispect':'1','Idempotency-Key':'create'}).get_json()['batch']['batch_id']
    assert first==second
    ids=upload(client,first,filename='=formula.png').get_json()['accepted']
    q=Coordinator(database,cfg);ready(q,'resnet18','r');job=q.claim('resnet18','r');q.finish(job['job_id'],'r',result=result())
    csv_data=client.get('/api/export/'+first).data.decode()
    rows=list(csv.DictReader(io.StringIO(csv_data)))
    assert len(rows)==3 and rows[0]['filename'].startswith("'=")
    assert len(client.get('/api/export/'+first+'?format=json').get_json())==3
    image=client.get('/api/images/'+ids[0]['image_id']).get_json()['image']
    assert not image['terminal'] and image['jobs']['resnet18']['status']=='COMPLETED'
    response=client.get(f'/api/events?batch_id={first}',buffered=False)
    stream=iter(response.response)
    assert b'retry:' in next(stream)
    assert b'event: update' in next(stream)
    response.close()


# Verify cleanup preserves active and recovers interrupted.
def test_cleanup_preserves_active_and_recovers_interrupted(client,database,cfg):
    b=batch(client);upload(client,b)
    with database.connect(write=True) as db:db.execute('UPDATE images SET retention_expires_at=0');db.execute('UPDATE batches SET created_at=0')
    assert maintain(database,cfg)==0
    with database.connect(write=True) as db:
        db.execute("UPDATE images SET input_status='PROCESSING'")
        db.execute("UPDATE model_jobs SET status='WAITING_FOR_INPUT'")
    maintain(database,cfg,recover_inputs=True)
    with database.connect() as db:assert db.execute('SELECT count(*) FROM images').fetchone()[0]==0


# Verify missing research and model readiness.
def test_missing_research_and_model_readiness(client,cfg):
    assert client.get('/api/readiness').status_code==503
    assert len(client.get('/api/queues').get_json()['lanes'])==3
    assert len(client.get('/api/evaluation/summary').get_json()['models'])==3
    assert len(client.get('/api/evaluation/figures').get_json()['figures'])==31
    assert client.get('/api/evaluation/artifact/../models/resnet18.pth').status_code==404
    missing=create_app(replace(cfg,artifacts=cfg.instance/'absent')).test_client()
    data=missing.get('/api/evaluation/summary').get_json()
    assert data['models']==[] and data['unavailable']
