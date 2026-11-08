import io
import threading
from dataclasses import replace
from app.core.ingestion import ingest
from app.core.queue_coordinator import Coordinator
from app.core.preprocessing import decode
from werkzeug.datastructures import FileStorage
from conftest import batch, upload, ready, png, result


def test_two_sessions_concurrent_admission_atomic_fanout(app,database,cfg):
    one=app.test_client();two=app.test_client();batches=[batch(one),batch(two)]
    errors=[]
    def submit(client,b):
        try:
            for offset in range(0,10,2):
                response=upload(client,b,2,offset=offset)
                assert response.status_code==202
        except Exception as exc:errors.append(exc)
    threads=[threading.Thread(target=submit,args=(c,b)) for c,b in zip([one,two],batches)]
    for t in threads:t.start()
    for t in threads:t.join()
    assert not errors
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM images').fetchone()[0]==20
        assert db.execute('SELECT count(*) FROM model_jobs').fetchone()[0]==60
        assert db.execute('SELECT count(DISTINCT admission_seq) FROM images').fetchone()[0]==20


def test_concurrent_duplicate_submission_has_single_image(client,database,cfg):
    b=batch(client);out=[];errors=[]
    def submit():
        try:out.append(ingest(database,cfg,b,'same-request',0,FileStorage(stream=io.BytesIO(png()),filename='fruit.png')))
        except Exception as exc:errors.append(exc)
    threads=[threading.Thread(target=submit) for _ in range(2)]
    for t in threads:t.start()
    for t in threads:t.join()
    assert not errors and len(out)==2 and out[0]['image_id']==out[1]['image_id']
    with database.connect() as db:
        assert db.execute('SELECT count(*) FROM images').fetchone()[0]==1
        assert db.execute('SELECT count(*) FROM model_jobs').fetchone()[0]==3


def test_upload_slot_backpressure(app,client):
    b=batch(client);gate=app.extensions['uploads']
    for _ in range(app.extensions['settings'].upload_slots):assert gate.acquire(False)
    try:assert upload(client,b).status_code==429
    finally:
        for _ in range(app.extensions['settings'].upload_slots):gate.release()


def test_lane_lease_heartbeat_and_crash_exhaustion(client,database,cfg):
    b=batch(client);upload(client,b,2)
    q=Coordinator(database,replace(cfg,max_attempts=1));ready(q,'resnet18','a')
    job=q.claim('resnet18','a')
    assert q.heartbeat('resnet18','a')
    with database.connect(write=True) as db:db.execute("UPDATE model_registry SET lease_expires_at=0 WHERE model_key='resnet18'")
    ready(q,'resnet18','b')
    assert not q.heartbeat('resnet18','a')
    assert q.claim('resnet18','b')['admission_seq']>job['admission_seq']
    with database.connect() as db:assert db.execute('SELECT status FROM model_jobs WHERE job_id=?',(job['job_id'],)).fetchone()[0]=='FAILED'


def test_shutdown_and_missing_preprocessing_are_explicit(client,database,cfg):
    b=batch(client)
    with database.connect(write=True) as db:db.execute("INSERT OR REPLACE INTO service_state VALUES('accepting','0')")
    assert upload(client,b).get_json()['rejected'][0]['code']=='SHUTTING_DOWN'
    from app import create_app
    missing=create_app(replace(cfg,artifacts=cfg.instance/'missing')).test_client();other=batch(missing)
    assert upload(missing,other).get_json()['rejected'][0]['code']=='PREPROCESSING_UNAVAILABLE'
