# Verify queues behavior.
import threading
import time
from dataclasses import replace
from app.config import MODELS
from app.queue.coordinator import Coordinator
from app.storage.jobs import transition
from conftest import batch, upload, ready, result


# Verify fifo independent progress.
def test_fifo_independent_progress(client, database, cfg):
    b = batch(client)
    ids = upload(client,b,3).get_json()['accepted']
    q = Coordinator(database, replace(cfg, lease_seconds=30))
    starts = {k:[] for k in MODELS}
    ends = {k:[] for k in MODELS}
    trace = []
    lock = threading.Lock()
    # Lane.
    def lane(key, delay):
        ready(q,key,key)
        for _ in ids:
            job = q.claim(key,key)
            assert job
            with lock:
                starts[key].append(job['admission_seq']);trace.append((key,'start',job['admission_seq']))
            time.sleep(delay)
            assert q.finish(job['job_id'],key,result=result())
            with lock:
                ends[key].append(job['admission_seq']);trace.append((key,'end',job['admission_seq']))
    threads=[threading.Thread(target=lane,args=(key, .02 if key=='resnet18' else .15)) for key in MODELS]
    for t in threads:t.start()
    for t in threads:t.join()
    seq=[i['admission_seq'] for i in ids]
    assert all(s==seq for s in starts.values()) and all(s==seq for s in ends.values())
    assert trace.index(('resnet18','start',seq[1])) < trace.index(('mobilenet_v3_small','end',seq[0]))
    with database.connect() as db:
        assert db.execute("SELECT count(*) FROM model_jobs WHERE status='COMPLETED'").fetchone()[0]==9
        assert db.execute("SELECT count(*) FROM events WHERE event_type='model.completed'").fetchone()[0]==9


# Verify waiting input and retry head cannot be overtaken.
def test_waiting_input_and_retry_head_cannot_be_overtaken(client,database,cfg):
    b=batch(client);upload(client,b,3)
    q=Coordinator(database,cfg);ready(q,'resnet18','one')
    with database.connect(write=True) as db:
        head=db.execute("SELECT * FROM model_jobs WHERE model_key='resnet18' ORDER BY admission_seq LIMIT 1").fetchone()
        db.execute("UPDATE model_jobs SET status='WAITING_FOR_INPUT' WHERE job_id=?",(head['job_id'],))
    assert q.claim('resnet18','one') is None
    with database.connect(write=True) as db:db.execute("UPDATE model_jobs SET status='QUEUED' WHERE job_id=?",(head['job_id'],))
    first=q.claim('resnet18','one');q.finish(first['job_id'],'one',error=RuntimeError('test failure'))
    assert q.claim('resnet18','one') is None
    with database.connect(write=True) as db:db.execute('UPDATE model_jobs SET available_at=0 WHERE job_id=?',(first['job_id'],))
    assert q.claim('resnet18','one')['job_id']==first['job_id']


# Verify recovery fences old worker and retries oldest.
def test_recovery_fences_old_worker_and_retries_oldest(client,database,cfg):
    b=batch(client);upload(client,b,2)
    q=Coordinator(database,cfg);ready(q,'resnet18','old')
    first=q.claim('resnet18','old')
    assert not q.acquire_lane('resnet18','new')
    with database.connect(write=True) as db:db.execute("UPDATE model_registry SET lease_expires_at=0 WHERE model_key='resnet18'")
    ready(q,'resnet18','new')
    assert not q.finish(first['job_id'],'old',result=result())
    again=q.claim('resnet18','new')
    assert again['job_id']==first['job_id'] and again['attempt_count']==2
    assert q.finish(first['job_id'],'new',result=result())
    assert not q.finish(first['job_id'],'new',result=result())
    assert q.claim('resnet18','new')['admission_seq']>first['admission_seq']


# Verify retry budget and unavailable lane.
def test_retry_budget_and_unavailable_lane(client,database,cfg):
    b=batch(client);upload(client,b,2)
    q=Coordinator(database,replace(cfg,max_attempts=1));ready(q,'resnet18','r');ready(q,'efficientnet_b0','e')
    q.register('efficientnet_b0','e','UNAVAILABLE',error='Missing checkpoint')
    assert q.claim('efficientnet_b0','e') is None
    job=q.claim('resnet18','r');assert q.finish(job['job_id'],'r',error=ValueError('test'))
    assert q.claim('resnet18','r')['admission_seq']>job['admission_seq']
    with database.connect() as db:
        assert db.execute("SELECT status FROM model_jobs WHERE job_id=?",(job['job_id'],)).fetchone()[0]=='FAILED'
        assert db.execute("SELECT status FROM model_jobs WHERE model_key='efficientnet_b0' ORDER BY admission_seq LIMIT 1").fetchone()[0]=='UNAVAILABLE'


# Verify running cancellation discards result and completed survives.
def test_running_cancellation_discards_result_and_completed_survives(client,database,cfg):
    b=batch(client);ids=upload(client,b,2).get_json()['accepted']
    q=Coordinator(database,cfg);ready(q,'resnet18','r');job=q.claim('resnet18','r')
    q.cancel(image_id=ids[0]['image_id']);assert q.finish(job['job_id'],'r',result=result())
    next_job=q.claim('resnet18','r');q.finish(next_job['job_id'],'r',result=result())
    q.cancel(batch_id=b)
    with database.connect() as db:
        assert db.execute('SELECT status,result_json FROM model_jobs WHERE job_id=?',(job['job_id'],)).fetchone()[:]==('CANCELLED',None)
        assert db.execute('SELECT status FROM model_jobs WHERE job_id=?',(next_job['job_id'],)).fetchone()[0]=='COMPLETED'


# Verify transition rejects terminal mutation.
def test_transition_rejects_terminal_mutation(client,database,cfg):
    b=batch(client);upload(client,b)
    q=Coordinator(database,cfg);q.cancel(batch_id=b)
    with database.connect(write=True) as db:
        job=db.execute('SELECT * FROM model_jobs LIMIT 1').fetchone()
        try:transition(db,job,'RUNNING')
        except ValueError:pass
        else:raise AssertionError('Terminal transition was allowed')
