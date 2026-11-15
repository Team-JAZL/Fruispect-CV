# Measure real service queue integrity using synthetic image uploads.
import argparse
import http.cookiejar
import io
import json
import math
import statistics
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from PIL import Image
from app.config import MODELS
from app.storage.database import iso


class Client:
    # Initialize the component and its required dependencies.
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    # Send an authenticated service request and decode its JSON response.
    def request(self, path, data=None, headers=None, method=None):
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {}, method=method)
        try:
            with self.opener.open(req, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f'{path}: HTTP {exc.code}: {exc.read().decode()}') from exc

    # Send a bounded multipart image chunk with its stable admission key.
    def upload(self, batch, count, offset, key):
        boundary = uuid.uuid4().hex
        body = bytearray()
        # Append one multipart form field to the outgoing upload body.
        def line(value):
            body.extend(value.encode() + b'\r\n')
        line(f'--{boundary}'); line('Content-Disposition: form-data; name="offset"'); line(''); line(str(offset))
        for index in range(count):
            stream = io.BytesIO()
            Image.new('RGB', (320, 240), ((offset + index) % 256, 145, 62)).save(stream, 'PNG')
            line(f'--{boundary}');line(f'Content-Disposition: form-data; name="images"; filename="integrity-{offset+index:04}.png"')
            line('Content-Type: image/png');line('');body.extend(stream.getvalue());line('')
        line(f'--{boundary}--')
        return self.request(f'/api/batches/{batch}/images', bytes(body),
                            {'Content-Type': f'multipart/form-data; boundary={boundary}', 'X-Fruispect':'1', 'Idempotency-Key':key})


# Calculate a percentile from sorted observed timing values.
def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)]


# Upload synthetic images and verify real model completion, ordering, and overlap.
def exercise(client, count, timeout, restart_owned_pid=None):
    batch = client.request('/api/batches', b'', {'X-Fruispect':'1'})['batch']['batch_id']
    started = time.perf_counter()
    accepted = []
    polls = []
    memory_samples = []
    max_queue_depth = 0
    for offset in range(0, count, 4):
        key = uuid.uuid4().hex
        response = client.upload(batch, min(4, count - offset), offset, key)
        assert not response['rejected'], response
        accepted.extend(response['accepted'])
        if offset == 0:
            replay = client.upload(batch, min(4, count), offset, key)
            assert all(row['duplicate'] for row in replay['accepted'])
    assert len(accepted) == count
    restart = None
    if restart_owned_pid:
        import psutil
        lanes = client.request('/api/queues')['lanes']
        lane = next(l for l in lanes if l['model_key']=='efficientnet_b0')
        target_pid = lane['metadata']['process_pid']
        target = psutil.Process(target_pid)
        assert target.ppid() == restart_owned_pid, 'Refusing to restart a process outside the explicitly owned supervisor.'
        target.terminate()
        restart = {'model_key': 'efficientnet_b0', 'terminated_pid': target_pid,
                   'active_image_at_termination': lane['active']['image_id'] if lane['active'] else None}
    while time.perf_counter() - started < timeout:
        before = time.perf_counter()
        summary = client.request(f'/api/batches/{batch}')['batch']['summary']
        polls.append((time.perf_counter() - before) * 1000)
        lanes = client.request('/api/queues')['lanes']
        max_queue_depth = max(max_queue_depth, *(l['queue_depth'] for l in lanes))
        try:
            import psutil
            pids = [l['metadata'].get('process_pid') for l in lanes]
            memory_samples.append(sum(psutil.Process(pid).memory_info().rss for pid in pids if pid and psutil.pid_exists(pid)))
        except (ImportError, OSError):
            pass
        if summary['fully_complete'] == count:
            break
        time.sleep(.15)
    else:
        raise TimeoutError(f'Batch incomplete: {summary}')
    duration = time.perf_counter() - started
    records = []
    for page in range(1, math.ceil(count / 50) + 1):
        records.extend(client.request(f'/api/batches/{batch}/images?page={page}&limit=50&sort=oldest')['images'])
    assert len(records) == count and all(row['terminal'] for row in records)
    assert all(len(row['jobs']) == 3 and all(j['status']=='COMPLETED' for j in row['jobs'].values()) for row in records), records
    cursor = 0; events = []
    while True:
        response = client.request(f'/api/batches/{batch}/events?after={cursor}')
        if not response['events']:
            break
        events.extend(response['events']);cursor=response['cursor']
    assert len({event['event_id'] for event in events}) == len(events)
    completed = [e for e in events if e['event_type']=='model.completed']
    assert len(completed)==3*count
    image_order = [i['image_id'] for i in records]
    for key in MODELS:
        terminal_order = [e['image_id'] for e in completed if e['model_key']==key]
        assert terminal_order == image_order, f'{key}: non-FIFO completion'
        start_order = [e['image_id'] for e in events if e['model_key']==key and e['event_type']=='model.started']

        seqs = [image_order.index(image_id) for image_id in start_order]
        assert seqs==sorted(seqs), f'{key}: non-FIFO start'
    independent = None
    for event in events:
        if event['event_type']!='model.started' or event['image_id'] not in image_order[1:]:
            continue
        index=image_order.index(event['image_id'])
        for other in MODELS:
            if other==event['model_key']:
                continue
            previous_completed=next(e for e in completed if e['model_key']==other and e['image_id']==image_order[index-1])
            if previous_completed['event_id']>event['event_id']:
                independent={'advancing_model':event['model_key'],'next_image_id':event['image_id'],
                             'next_start_event_id':event['event_id'],'slower_model':other,
                             'previous_image_completion_event_id':previous_completed['event_id']}
                break
        if independent:
            break
    if count>1:
        assert independent, 'No independent overlap was observed.'
    jobs = [j for row in records for j in row['jobs'].values()]
    outputs = [j['result'] for j in jobs]
    if restart:
        current=next(l for l in client.request('/api/queues')['lanes'] if l['model_key']==restart['model_key'])
        restart['replacement_pid']=current['metadata']['process_pid']
        assert restart['replacement_pid']!=restart['terminated_pid']
        interrupted = next((row for row in records if row['image_id']==restart['active_image_at_termination']), None)
        restart['interrupted_attempt_count'] = interrupted['jobs']['efficientnet_b0']['attempt_count'] if interrupted else None
    return {'batch_id':batch,'images':count,'completed_model_jobs':len(jobs),'duration_s':duration,
            'fully_processed_images_s':count/duration,'model_jobs_s':len(jobs)/duration,
            'end_to_end_p50_ms':statistics.median(r['end_to_end_ms'] for r in outputs),
            'end_to_end_p95_ms':percentile([r['end_to_end_ms'] for r in outputs],.95),
            'summary_request_p95_ms':percentile(polls,.95),'peak_worker_rss_bytes':max(memory_samples,default=None),
            'max_observed_lane_queue_depth':max_queue_depth,'restart':restart,'independence_evidence':independent,
            'inference_ms':{key:{'mean':statistics.mean(row['jobs'][key]['inference_ms'] for row in records),
                                 'p95':percentile([row['jobs'][key]['inference_ms'] for row in records],.95)} for key in MODELS}}


# Run the stress test queues command with configured arguments.
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:5000')
    parser.add_argument('--sizes',type=int,nargs='+',default=[1,10,50,100])
    parser.add_argument('--timeout',type=float,default=600)
    parser.add_argument('--restart-owned-supervisor',type=int)
    parser.add_argument('--output',type=Path,default=Path('test-results/load-test.json'))
    args=parser.parse_args()
    client=Client(args.url)
    readiness=client.request('/api/readiness')
    assert readiness['ready'],readiness
    report={'recorded_at':iso(),'device':readiness['device'],
            'fixture_scope':'Synthetic image inputs through HTTP and actual saved checkpoints; queue/load evidence only, not accuracy.',
            'runs':[]}
    for size in args.sizes:
        run=exercise(client,size,args.timeout,args.restart_owned_supervisor if size==max(args.sizes) else None)
        report['runs'].append(run);print(json.dumps(run),flush=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
