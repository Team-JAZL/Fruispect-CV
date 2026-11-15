# Verify tunnel behavior.
import io
import json
import time
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock
import pytest
from app.connection import discovery, manager as module
from app.connection.discovery import find_ngrok
from app.connection.manager import TunnelManager
from app.connection.state import https_origin, read_tunnel


# Install state.
def install_state(database, **values):
    state = {'status':'ready', 'public_url':'https://fruit.example.test', 'pair_code':'A123B456',
             'generation':'test-generation', 'expires_at':time.time()+30, **values}
    with database.connect(write=True) as db:
        db.execute("INSERT OR REPLACE INTO service_state VALUES('tunnel',?)", (json.dumps(state),))


# Verify discovery configured portable and missing.
def test_discovery_configured_portable_and_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(discovery.shutil, 'which', lambda _: None)
    root = tmp_path/'project';root.mkdir()
    assert find_ngrok(root=root,home=tmp_path/'home') is None
    portable = root/'tools'/'ngrok.exe';portable.parent.mkdir();portable.write_bytes(b'fixture')
    assert find_ngrok(root=root,home=tmp_path/'home') == portable.resolve()
    assert find_ngrok(str(tmp_path/'missing'),root=root) is None
    custom = tmp_path/'custom.exe';custom.write_bytes(b'fixture')
    assert find_ngrok(str(custom),root=root) == custom.resolve()


# Verify tunnel optional and failed start do not stop local.
def test_tunnel_optional_and_failed_start_do_not_stop_local(cfg,database,monkeypatch):
    manager = TunnelManager(replace(cfg,ngrok_enabled=False),database,5000)
    manager.start();assert read_tunnel(database)['status']=='disabled'
    monkeypatch.setattr(module,'find_ngrok',lambda _:None)
    manager=TunnelManager(cfg,database,5000);manager.start()
    assert read_tunnel(database)['status']=='not_found'
    monkeypatch.setattr(module,'find_ngrok',lambda _:Path('ngrok.exe'))
    monkeypatch.setattr(module.subprocess,'Popen',Mock(side_effect=OSError('test')))
    manager.start();assert read_tunnel(database)['status']=='failed'


# Verify owned process https discovery timeout and cleanup.
def test_owned_process_https_discovery_timeout_and_cleanup(cfg,database,monkeypatch):
    monkeypatch.setattr(module,'find_ngrok',lambda _:Path('ngrok.exe'))
    process=Mock();process.poll.return_value=None
    process.stdout=io.StringIO(json.dumps({'msg':'started tunnel','url':'https://fruit.example.test','addr':'http://127.0.0.1:5000'})+'\n')
    launch=Mock(return_value=process);monkeypatch.setattr(module.subprocess,'Popen',launch)
    manager=TunnelManager(cfg,database,5000);manager.start();manager.reader.join(timeout=2);manager.tick()
    state=read_tunnel(database)
    assert state['status']=='ready' and len(state['pair_code'])==8
    assert launch.call_args.args[0][-1]=='--inspect=false'
    assert 'http://127.0.0.1:5000' in launch.call_args.args[0]
    manager.close();process.terminate.assert_called_once();assert read_tunnel(database)['status']=='stopped'
    process=Mock();process.poll.return_value=None;process.stdout=io.StringIO('')
    launch.return_value=process
    manager=TunnelManager(replace(cfg,ngrok_timeout=.01),database,5000);manager.start();manager.started-=1;manager.tick()
    assert read_tunnel(database)['status']=='failed';process.terminate.assert_called_once()


# Verify only https origins are admitted.
@pytest.mark.parametrize('bad',['http://fruit.example.test','https://user:pass@fruit.example.test','https://fruit.example.test/private','javascript:alert(1)','https://fruit.example.test:1234'])
def test_only_https_origins_are_admitted(bad):
    assert https_origin(bad) is None


# Verify pairing and origin protection.
def test_pairing_and_origin_protection(client,database,app):
    install_state(database)
    local=client.get('/api/connection').get_json()['connection']
    assert local['local_operator'] and local['connect_url'].endswith('#connect=A123B456')
    phone=app.test_client();base='https://fruit.example.test'
    assert phone.get('/',base_url=base).status_code==200
    public=phone.get('/api/connection',base_url=base).get_json()['connection']
    assert public['requires_pairing'] and 'pair_code' not in public and 'connect_url' not in public
    assert phone.get('/api/models',base_url=base).status_code==401
    headers={'X-Fruispect':'1','Origin':base}
    wrong=phone.post('/api/connect',base_url=base,headers=headers,json={'code':'wrong'})
    assert wrong.status_code==401
    assert phone.post('/api/connect',base_url=base,headers={**headers,'Origin':'https://evil.test'},json={'code':'A123B456'}).status_code==403
    paired=phone.post('/api/connect',base_url=base,headers=headers,json={'code':'a123-b456'})
    assert paired.status_code==200 and 'Secure;' in paired.headers['Set-Cookie']
    assert phone.get('/api/models',base_url=base).status_code==200
    assert 'pair_code' not in phone.get('/api/connection',base_url=base).get_json()['connection']

    assert phone.get('/api/models',base_url='http://fruit.example.test').status_code==403
    assert phone.get('/api/connection',base_url='https://localhost').status_code==403
    assert phone.get('/api/connection',base_url=base,environ_overrides={'REMOTE_ADDR':'192.0.2.1'}).status_code==403
    install_state(database,generation='replacement')
    assert phone.get('/api/models',base_url=base).status_code==401
    install_state(database,expires_at=0)
    assert phone.get('/api/models',base_url=base).status_code==403


# Verify pairing attempts bounded and no local pair.
def test_pairing_attempts_bounded_and_no_local_pair(client,database,app):
    install_state(database)
    assert client.post('/api/connect',headers={'X-Fruispect':'1'},json={'code':'A123B456'}).status_code==409
    phone=app.test_client()
    for _ in range(10):
        assert phone.post('/api/connect',base_url='https://fruit.example.test',headers={'X-Fruispect':'1'},json={'code':'bad'}).status_code==401
    assert phone.post('/api/connect',base_url='https://fruit.example.test',headers={'X-Fruispect':'1'},json={'code':'A123B456'}).status_code==429


# Verify web readiness requires own bound socket.
def test_web_readiness_requires_own_bound_socket(cfg,monkeypatch):
    from app.runtime import processes as main
    import waitress
    ready=Mock()
    monkeypatch.setattr(main,'create_app',lambda _:Mock())
    create=Mock(side_effect=OSError('Port already occupied'))
    monkeypatch.setattr(waitress,'create_server',create)
    with pytest.raises(OSError,match='occupied'):
        main.serve(cfg,ready)
    ready.set.assert_not_called()
    server=Mock();create.side_effect=None;create.return_value=server
    main.serve(cfg,ready)
    ready.set.assert_called_once();server.run.assert_called_once()


# Verify plain text error drain and repeated start.
def test_plain_text_error_drain_and_repeated_start(cfg, database, monkeypatch):
    monkeypatch.setattr(module, 'find_ngrok', lambda _: Path('ngrok.exe'))
    monkeypatch.setattr(module, 'ChildProcessGuard', Mock())
    failed = Mock()
    failed.poll.return_value = 1
    failed.stdout = io.StringIO('ERROR: authentication failed ERR_NGROK_108\n')
    second = Mock()
    second.poll.return_value = None
    second.stdout = io.StringIO('')
    launch = Mock(side_effect=[failed, second])
    monkeypatch.setattr(module.subprocess, 'Popen', launch)
    manager = TunnelManager(cfg, database, 5000)
    manager.start(); manager.tick()
    assert read_tunnel(database)['error_code'] == 'ERR_NGROK_108'
    assert 'Another ngrok agent' in read_tunnel(database)['message']
    assert '--log-level=info' in launch.call_args.args[0]
    manager.start()
    assert manager.last_error is None
    manager.close(); manager.close()
    second.terminate.assert_called_once()
    assert not any(k in read_tunnel(database) for k in ('public_url', 'pair_code', 'generation'))


# Verify retry request is local and explicit.
def test_retry_request_is_local_and_explicit(client, database):
    assert client.post('/api/connection/retry', headers={'X-Fruispect': '1'}).status_code == 202
    with database.connect() as db:
        assert db.execute("SELECT value FROM service_state WHERE key='tunnel_retry'").fetchone()[0] == '1'


# Verify startup failure still closes tunnel and releases instance lock.
def test_startup_failure_still_closes_tunnel_and_releases_instance_lock(cfg, monkeypatch):
    from app.runtime import supervisor as main
    from app.storage.database import Database
    manager = Mock()
    monkeypatch.setattr(main, 'TunnelManager', Mock(return_value=manager))
    monkeypatch.setattr(main, 'maintain', Mock(side_effect=RuntimeError('startup failed')))
    with main.instance_lock(cfg):
        with pytest.raises(RuntimeError, match='startup failed'):
            main.supervise(cfg)
    manager.close.assert_called_once()

    with main.instance_lock(cfg):
        pass
    with Database(cfg.database).connect() as db:
        assert db.execute("SELECT value FROM service_state WHERE key='accepting'").fetchone()[0] == '0'


# Verify windows guard stops only its assigned process.
@pytest.mark.skipif(module.os.name != 'nt', reason='Windows process ownership')
def test_windows_guard_stops_only_its_assigned_process():
    import subprocess
    import sys
    from app.runtime.guard import ChildProcessGuard
    process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        guard = ChildProcessGuard(process)
        guard.close()
        process.wait(timeout=5)
        assert process.poll() is not None
        guard.close()
    finally:
        if process.poll() is None:
            process.kill(); process.wait(timeout=5)


# Verify windows guard cleans child after supervisor is force closed.
@pytest.mark.skipif(module.os.name != 'nt', reason='Windows process ownership')
def test_windows_guard_cleans_child_after_supervisor_is_force_closed():
    import subprocess
    import sys
    import psutil
    from app.config import ROOT
    code = '''import subprocess,sys,time
from app.runtime.guard import ChildProcessGuard
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW)
guard=ChildProcessGuard(child)
print(child.pid,flush=True)
time.sleep(60)
'''
    owner = subprocess.Popen([sys.executable, '-c', code], cwd=ROOT, text=True, stdout=subprocess.PIPE,
                             creationflags=subprocess.CREATE_NO_WINDOW)
    child = None
    try:
        child = psutil.Process(int(owner.stdout.readline()))
        owner.terminate(); owner.wait(timeout=5)
        child.wait(timeout=5)
        assert not child.is_running()
    finally:
        if owner.poll() is None:
            owner.kill(); owner.wait(timeout=5)
        owner.stdout.close()
        if child and child.is_running():
            child.kill(); child.wait(timeout=5)
