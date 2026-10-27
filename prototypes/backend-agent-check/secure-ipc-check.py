#!/usr/bin/env python3
"""Credenciales únicas + IPC entre UID distintos en VM, sin captura ni entrada."""
import argparse
import base64
import hashlib
import hmac
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import struct
import subprocess
import tarfile
import threading
import time
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SERVICE = 'absorconnect-secure-lab.service'
WORKER = 'absorconnect-ipc-worker-lab.service'
SOCKET_UNIT = 'absorconnect-secure-lab.socket'
STATE = '/var/lib/absorconnect-secure-lab'
CONFIG = '/etc/absorconnect-secure-lab'
RUNTIME = '/run/absorconnect-ipc-worker-lab'
OFFER = 'sha-256 '+':'.join(['11']*32)
ANSWER = 'sha-256 '+':'.join(['22']*32)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lab', type=Path)
    parser.add_argument('vm', type=Path)
    parser.add_argument('--api-base', required=True)
    args = parser.parse_args()
    uri = urlsplit(args.api_base)
    assert uri.scheme == 'http' and uri.hostname == '127.0.0.1' and uri.port and 1024 <= uri.port <= 65535 and uri.path in ('', '/') and not (uri.username or uri.password or uri.query or uri.fragment)
    vm_directory = args.vm.resolve()
    meta = vm_directory.stat()
    assert meta.st_uid == os.getuid() and meta.st_mode & 0o077 == 0
    controller = vm_directory/'vm-control.py'
    assert controller.is_file() and not controller.is_symlink() and controller.stat().st_uid == os.getuid() and controller.stat().st_mode & 0o022 == 0
    vm = load('secure_vm', controller)
    assert vm.SSH[-1] == 'absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1] == '22223'
    native = load('secure_api', Path(__file__).with_name('native-renewal.py'))
    native.BASE = args.api_base
    request = native.request
    output = args.lab/('secure-ipc-'+uuid.uuid4().hex)
    output.mkdir(mode=0o700)
    results = []
    installed = False
    marker_created = False
    account_removed = service_removed = matrix_passed = False
    tunnel = server = thread = None
    owner = None
    broker_uid = None
    cut = threading.Event()
    collision = threading.Event()
    credentials = {}
    installer = (ROOT/'agent/linux-secure-lab/install-vm.py').read_text()

    def root(code, data=None):
        try:
            return vm.remote('sudo -n /usr/bin/python3 -I -c '+shlex.quote(code), data)
        except subprocess.CalledProcessError as error:
            path=output/'remote-stderr.txt';path.write_bytes(error.stderr);path.chmod(0o600)
            raise RuntimeError('remote_root_failed_inspect_private_stderr') from None

    def check(name, **fields):
        results.append(dict(case=name, passed=True, **fields))
        print(json.dumps({'passed':name}), flush=True)

    def units(action, *names):
        vm.remote('sudo -n systemctl '+shlex.quote(action)+' '+' '.join(shlex.quote(n) for n in names))

    def worker(command=None, action='request', timeout=8):
        control = {'action':action}
        if command is not None:
            control['command'] = command
        code = '''import json,os,time
from pathlib import Path
p=Path('/run/absorconnect-ipc-worker-lab'); deadline=time.monotonic()+TIMEOUT
while not p.exists() and time.monotonic()<deadline:time.sleep(.05)
r=p/'reply.json'; r.unlink(missing_ok=True)
fd=os.open(p/'command.next',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:json.dump(CONTROL,f)
os.rename(p/'command.next',p/'command.json')
while time.monotonic()<deadline:
 if r.exists():
  print(r.read_text());break
 time.sleep(.03)
else:raise RuntimeError('worker_reply_timeout')
'''.replace('TIMEOUT', repr(timeout)).replace('CONTROL', repr(control))
        value = json.loads(vm.remote('/usr/bin/python3 -I -c '+shlex.quote(code)))
        return value.get('result', value)

    def ready(timeout=12):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            try:
                value = worker({'op':'status'}, timeout=3)
                if value.get('state') == 'ready':
                    return value
            except (subprocess.SubprocessError, ValueError):
                pass
            time.sleep(.2)
        raise AssertionError('authority_not_ready')

    def challenge():
        reply = worker({'op':'challenge','offer_fingerprint':OFFER,'answer_fingerprint':ANSWER})
        if reply['kind'] != 'hello':
            return reply, None
        hello = json.loads(reply['payload'])
        assert hello['salt'] == salt64 and hello['iterations'] == 600000
        message = 'absor-remote-auth-v1\n'+hello['nonce']+'\n'+OFFER+'\n'+ANSWER
        proof = base64.b64encode(hmac.digest(key, message.encode(), 'sha256')).decode()
        return reply, json.dumps({'v':1,'type':'auth','proof':proof})

    def authenticate():
        _, proof = challenge()
        assert proof
        assert worker({'op':'authenticate','message':proof})['state'] == 'authenticated'
        return proof

    try:
        password = secrets.token_urlsafe(32)
        status, account = request('POST', '/api/auth/register', {
            'email':'secure-ipc-'+uuid.uuid4().hex+'@example.invalid', 'password':password,
            'deviceName':'Diagnóstico IPC efímero'})
        assert status == 201
        owner = account['token']
        device = str(uuid.uuid4())
        path = '/api/devices/'+device
        device_key = secrets.token_urlsafe(32)
        info = {'name':'Host IPC aislado', 'platform':'linux','appVersion':'0.1.0',
                'remote':{'state':'available','features':{'clipboard':False,'files':False,'audio':False}}}
        assert request('PUT', path, info, owner, device_key)[0] == 200
        status, enrollment = request('POST', path+'/agent-enrollments', {}, owner, device_key)
        assert status == 201
        grant = enrollment['enrollmentToken']
        salt = secrets.token_bytes(16)
        salt64 = base64.b64encode(salt).decode()
        key = hashlib.pbkdf2_hmac('sha256', secrets.token_bytes(32), salt, 600000, 32)

        class Proxy(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, data):
                raw = json.dumps(data).encode()
                self.send_response(status)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                assert self.path == '/api/host-agent/enroll'
                length = int(self.headers.get('Content-Length','0'))
                assert 0 < length <= 4096
                body = json.loads(self.rfile.read(length))
                assert body['enrollmentToken'] == grant and not self.headers.get('Authorization')
                status, data = request('POST', self.path, body)
                if status == 201:
                    credentials['agent'] = data['token']
                if status == 201 and collision.is_set():
                    root("from pathlib import Path;p=Path('/etc/.absorconnect-secure-lab-provision/wrapping.key');p.write_bytes(b'collision');p.chmod(0o600)")
                self.reply(status, data)

            def do_GET(self):
                assert self.path == '/api/host-agent/remote-requests'
                assert self.headers.get('Authorization') == 'Bearer '+credentials['agent']
                if cut.is_set():
                    self.close_connection = True
                    return
                status, data = request('GET', self.path, token=credentials['agent'])
                if status == 200:
                    credentials['lastPoll'] = time.monotonic()
                self.reply(status, data)

            def do_DELETE(self):
                assert self.path == path+'/agent'
                assert self.headers.get('Authorization') == 'Bearer '+credentials['agent']
                status, data = request('DELETE', self.path, {}, credentials['agent'])
                if status == 204: credentials['retired'] = credentials.get('retired',0)+1
                self.reply(status, data)

        server = http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy)
        thread = threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        guest_port = 28021
        tunnel = subprocess.Popen(vm.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes',
            '-R','127.0.0.1:'+str(guest_port)+':127.0.0.1:'+str(server.server_address[1]), vm.SSH[-1]],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        time.sleep(.5)
        assert tunnel.poll() is None
        origin = 'http://127.0.0.1:'+str(guest_port)
        # Solo artefactos públicos; los secretos viajan por stdin SSH hacia root.
        manifest = {}
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer,mode='w') as archive:
            for name in ['absor-secure-broker-lab','absor-secret-provision-lab','absor-ipc-worker-lab']:
                raw = vm.remote('cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/'+name)
                manifest[name] = hashlib.sha256(raw).hexdigest()
                item = tarfile.TarInfo(name); item.size=len(raw); item.mode=0o600
                archive.addfile(item,io.BytesIO(raw))
            for artifact in (ROOT/'agent/linux-secure-lab').glob('*.service'):
                if artifact.name=='absorconnect-protected-worker-lab.service': continue
                raw=artifact.read_bytes(); manifest[artifact.name]=hashlib.sha256(raw).hexdigest()
                item=tarfile.TarInfo(artifact.name);item.size=len(raw);item.mode=0o600
                archive.addfile(item,io.BytesIO(raw))
            artifact=ROOT/'agent/linux-secure-lab/absorconnect-secure-lab.socket'
            raw=artifact.read_bytes();manifest[artifact.name]=hashlib.sha256(raw).hexdigest()
            item=tarfile.TarInfo(artifact.name);item.size=len(raw);item.mode=0o600
            archive.addfile(item,io.BytesIO(raw))
        vm.remote('mkdir -m 700 /home/absorlab/AbsorConnectLab/secure-ipc-staging && tar -xf - -C /home/absorlab/AbsorConnectLab/secure-ipc-staging',buffer.getvalue())
        marker_created = json.loads(root("from pathlib import Path;import os,json;p=Path('/run/absorconnect-owned-vm-lab');expected=b'absorconnect-native-window-fixture-v1\\n';created=False\nif p.exists():\n m=p.lstat();assert not p.is_symlink() and m.st_uid==0 and m.st_mode&0o7777==0o444 and p.read_bytes()==expected\nelse:\n fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o444);os.write(fd,expected);os.close(fd);created=True\nprint(json.dumps({'created':created}))"))['created']
        input_ = {'hashes':manifest,'enrollment':{'origin':origin,'enrollmentToken':grant,
                  'key':base64.b64encode(key).decode(),'salt':salt64,'iterations':600000}}
        collision.set()
        rollback_code = """import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
config=json.load(sys.stdin)
p=Path('/opt/absorconnect-enrollment-rollback-lab');p.mkdir(mode=0o700)
try:
 raw=Path('/home/absorlab/AbsorConnectLab/secure-ipc-staging/absor-secret-provision-lab').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==config['hashes']['absor-secret-provision-lab']
 binary=p/'provision';binary.write_bytes(raw);binary.chmod(0o755)
 r=subprocess.run([str(binary)],input=json.dumps(config['enrollment']).encode(),capture_output=True,timeout=15)
 assert r.returncode==78
 assert not Path('/etc/.absorconnect-secure-lab-provision').exists()
 assert not Path('/etc/absorconnect-secure-lab').exists()
 print(json.dumps({'rollback':True}))
finally:shutil.rmtree(p)
"""
        assert json.loads(root(rollback_code,json.dumps(input_).encode()))['rollback']
        assert credentials.get('retired') == 1
        assert request('GET','/api/host-agent/remote-requests',token=credentials['agent'])[0] == 401
        collision.clear()
        status, enrollment = request('POST',path+'/agent-enrollments',{},owner,device_key)
        assert status == 201
        grant = enrollment['enrollmentToken']
        input_['enrollment']['enrollmentToken'] = grant
        check('failed-local-seal-retires-native-enrollment-and-removes-partial-storage')
        install_code = 'import sys;sys.argv=["install-vm.py","install"];\n'+installer
        data = json.loads(root(install_code,json.dumps(input_).encode()))
        installed = True
        broker_uid = data['brokerUid']
        assert broker_uid not in (0,1000) and data['plaintextBundleWritten'] is False
        ready()
        assert request('POST','/api/host-agent/enroll',{'enrollmentToken':grant,'agentVersion':'0.1.0','capabilities':{}})[0] == 400
        check('native-one-use-enrollment-encrypted-storage', brokerUidDifferentFromWorker=True, accountTokenSentToService=False)

        # Desde UID gráfico con NNP (sin poder aprovechar sudo de la VM).
        broker_pid = int(vm.remote('systemctl show '+SERVICE+' -p MainPID --value'))
        worker_pid = int(vm.remote('systemctl show '+WORKER+' -p MainPID --value'))
        code = '''import json,os
paths=PATHS; denied=[]
for path in paths:
 try:
  fd=os.open(path,os.O_RDONLY);os.close(fd);denied.append(False)
 except PermissionError:denied.append(True)
try:os.unlink('/run/absorconnect-secure-lab/control.sock');replace_denied=False
except PermissionError:replace_denied=True
writes=[]
for path in ['/opt/absorconnect-secure-lab/absor-secure-broker-lab','/opt/absorconnect-secure-lab/absor-ipc-worker-lab','/etc/systemd/system/absorconnect-ipc-worker-lab.service']:
 try:fd=os.open(path,os.O_WRONLY);os.close(fd);writes.append(False)
 except PermissionError:writes.append(True)
try:os.kill(BROKER_PID,0);signal_denied=False
except PermissionError:signal_denied=True
print(json.dumps({'denied':denied,'socketReplaceDenied':replace_denied,'writesDenied':writes,'signalDenied':signal_denied}))
'''.replace('BROKER_PID',str(broker_pid)).replace('PATHS',repr([CONFIG+'/wrapping.key',CONFIG+'/host.sealed.json',STATE+'/attempts.json',
            '/run/credentials/'+SERVICE+'/wrapping.key','/proc/'+str(broker_pid)+'/environ',
            '/proc/'+str(worker_pid)+'/environ']))
        isolated = 'sudo -n setpriv --no-new-privs --reuid=1000 --regid=1000 --clear-groups '
        denied = json.loads(vm.remote(isolated+'/usr/bin/python3 -I -c '+shlex.quote(code)))
        assert all(denied['denied']) and denied['socketReplaceDenied'] and all(denied['writesDenied']) and denied['signalDenied']
        check('worker-cannot-read-secret-files-proc-or-replace-root-socket')

        units('stop',WORKER)
        time.sleep(.2)
        probe = '''import socket,struct,json
s=socket.socket(socket.AF_UNIX);s.settimeout(2)
try:
 s.connect('/run/absorconnect-secure-lab/control.sock')
 raw=b'{"v":1,"sequence":1,"command":{"op":"status"}}'
 s.sendall(struct.pack('!I',len(raw))+raw)
 try:denied=not s.recv(4096)
 except (ConnectionResetError,BrokenPipeError):denied=True
except PermissionError:denied=True
print(json.dumps({'denied':denied}))
'''
        for uid in (1000,65534):
            result = json.loads(vm.remote('sudo -n setpriv --no-new-privs --reuid='+str(uid)+' --regid='+str(uid)+' --clear-groups /usr/bin/python3 -I -c '+shlex.quote(probe)))
            assert result['denied']
        units('start',WORKER)
        ready()
        check('foreign-uid-and-unregistered-same-uid-pid-denied')

        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        _, good_proof = challenge()
        wrong = json.dumps({'v':1,'type':'auth','proof':base64.b64encode(bytes(32)).decode()})
        assert worker({'op':'authenticate','message':wrong})['state'] == 'wrong_proof'
        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        proof = authenticate()
        value = worker({'op':'diagnostic_operation'})
        assert value['operation_count'] == 1 and value['os_operations_enabled'] is False
        assert worker({'op':'authenticate','message':proof})['state'] == 'invalid'
        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        check('unique-key-proof-required-and-proof-replay-closes-diagnostic-session')

        authenticate()
        assert worker(action='replay_previous')['replayDenied'] is True
        units('restart',WORKER)
        ready()
        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        check('frame-sequence-replay-and-worker-restart-do-not-revive-session')

        authenticate()
        units('reset-failed',SERVICE,WORKER)
        previous = int(vm.remote('systemctl show '+SERVICE+' -p MainPID --value'))
        vm.remote('sudo -n systemctl kill --signal=KILL --kill-whom=main '+SERVICE)
        ready()
        assert int(vm.remote('systemctl show '+SERVICE+' -p MainPID --value')) != previous
        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        check('broker-crash-drops-authority-and-recovery-requires-new-proof')
        authenticate()
        deadline = time.monotonic()+5
        while time.monotonic()-credentials.get('lastPoll',0)>.5:
            assert time.monotonic()<deadline
            time.sleep(.05)
        last_poll = credentials['lastPoll']
        cut.set()
        deadline = time.monotonic()+33
        while True:
            value = worker({'op':'diagnostic_operation'})
            if value['kind'] == 'denied':
                break
            assert time.monotonic()<deadline, 'api_cut_not_enforced'
            time.sleep(.1)
        elapsed = time.monotonic()-last_poll
        assert elapsed<=30.5
        cut.clear()
        time.sleep(4)
        assert worker({'op':'diagnostic_operation'})['kind'] == 'denied'
        authenticate()
        check('api-expiry-and-restoration-require-new-proof',denialObservedMilliseconds=round(elapsed*1000), observationIncludesSshRoundTrips=True)

        worker({'op':'disconnect'})
        for _ in range(5):
            assert challenge()[1]
            assert worker({'op':'authenticate','message':wrong})['state'] == 'wrong_proof'
        assert challenge()[0]['state'] == 'locked'
        before = root("from pathlib import Path;print(Path('"+STATE+"/attempts.json').read_text())")
        units('stop',WORKER)
        units('restart',SERVICE)
        units('start',WORKER)
        ready()
        assert challenge()[0]['state'] == 'locked'
        assert root("from pathlib import Path;print(Path('"+STATE+"/attempts.json').read_text())") == before
        check('lockout-survives-service-and-worker-restart-without-state-reset')

        units('stop',WORKER,SERVICE,SOCKET_UNIT)
        root("from pathlib import Path;p=Path('"+CONFIG+"/host.sealed.json');raw=p.read_bytes();p.with_suffix('.backup').write_bytes(raw);p.write_bytes(raw[:-2]+b'XX')")
        units('start',SOCKET_UNIT)
        failed = subprocess.run(vm.SSH+['sudo -n systemctl start '+SERVICE],capture_output=True)
        assert failed.returncode != 0
        assert int(vm.remote('systemctl show '+SERVICE+' -p ExecMainStatus --value')) == 78
        units('stop',SERVICE,SOCKET_UNIT)
        root("from pathlib import Path;p=Path('"+CONFIG+"/host.sealed.json');b=p.with_suffix('.backup');p.write_bytes(b.read_bytes());b.unlink()")
        units('reset-failed',SERVICE)
        units('start',SOCKET_UNIT,SERVICE,WORKER)
        ready()
        assert challenge()[0]['state'] == 'locked'
        check('tampered-encrypted-configuration-fails-closed-without-erasing-lockout')

        for fault in ['missing-attempts','corrupt-attempts','wrong-wrapping-key']:
            units('stop',WORKER,SERVICE,SOCKET_UNIT)
            target = STATE+'/attempts.json' if 'attempts' in fault else CONFIG+'/wrapping.key'
            root("from pathlib import Path;p=Path("+repr(target)+");b=p.with_suffix('.secure-backup');p.rename(b)"+
                 ("" if fault=='missing-attempts' else ";p.write_bytes("+("b'broken'" if fault=='corrupt-attempts' else "bytes(32)")+");p.chmod(0o600);"+
                  ("import os;os.chown(p,"+str(broker_uid)+","+str(broker_uid)+")" if 'attempts' in fault else "")))
            units('start',SOCKET_UNIT)
            failed = subprocess.run(vm.SSH+['sudo -n systemctl start '+SERVICE],capture_output=True)
            assert failed.returncode != 0
            assert int(vm.remote('systemctl show '+SERVICE+' -p ExecMainStatus --value')) == 78
            if fault=='missing-attempts':
                assert json.loads(root("from pathlib import Path;import json;print(json.dumps({'absent':not Path("+repr(target)+").exists()}))"))['absent']
            units('stop',SERVICE,SOCKET_UNIT)
            root("from pathlib import Path;p=Path("+repr(target)+");p.unlink(missing_ok=True);p.with_suffix('.secure-backup').rename(p)")
            units('reset-failed',SERVICE)
            units('start',SOCKET_UNIT,SERVICE,WORKER)
            ready()
            assert challenge()[0]['state'] == 'locked'
            assert root("from pathlib import Path;print(Path('"+STATE+"/attempts.json').read_text())") == before
        check('missing-corrupt-attempt-store-and-wrong-wrapping-key-never-reset-state')

        # Ni siquiera el informe privado o entorno del trabajador contienen los secretos.
        scan = '''import json,sys
from pathlib import Path
values=json.load(sys.stdin); pid=PID
raw=b''.join(p.read_bytes() for p in Path('/run/absorconnect-ipc-worker-lab').glob('*') if p.is_file())
raw+=Path('/proc/'+str(pid)+'/cmdline').read_bytes()+Path('/proc/'+str(pid)+'/environ').read_bytes()
raw+=Path('STATE/audit.json').read_bytes()
print(json.dumps({'secretFound':any(v.encode() in raw for v in values)}))
'''.replace('PID',str(int(vm.remote('systemctl show '+WORKER+' -p MainPID --value')))).replace('STATE',STATE)
        assert json.loads(root(scan,json.dumps([credentials['agent'],base64.b64encode(key).decode(),owner,password]).encode()))['secretFound'] is False
        check('worker-and-audit-contain-no-host-key-agent-token-or-account-token')

        assert request('DELETE',path+'/agent',{},owner)[0] == 204
        deadline=time.monotonic()+10
        while int(vm.remote('systemctl show '+SERVICE+' -p ExecMainStatus --value')) != 77:
            assert time.monotonic()<deadline
            time.sleep(.2)
        units('stop',WORKER)
        poll_before=credentials['lastPoll']
        subprocess.run(vm.SSH+['sudo -n systemctl start '+SERVICE],capture_output=True)
        time.sleep(.5)
        assert int(vm.remote('systemctl show '+SERVICE+' -p ExecMainStatus --value')) == 77
        assert credentials['lastPoll']==poll_before
        check('real-api-revocation-is-terminal-across-service-restart')
        matrix_passed = True
    finally:
        try:
            if installed:
                journal=root("import subprocess;print(subprocess.run(['journalctl','-u','absorconnect-secure-lab.service','-u','absorconnect-ipc-worker-lab.service','--no-pager','-n','120'],capture_output=True,text=True,check=True).stdout)")
                (output/'journal.txt').write_bytes(journal);(output/'journal.txt').chmod(0o600)
                code='import sys;sys.argv=["install-vm.py","remove"];\n'+installer
                cleanup=json.loads(root(code))
                assert cleanup['removed'] and cleanup['accountRemoved']
                service_removed = True
                check('reversible-removal-of-service-account-socket-state-and-secrets',lightdmModified=False)
            vm.remote('rm -rf /home/absorlab/AbsorConnectLab/secure-ipc-staging')
            if marker_created:
                root("from pathlib import Path;p=Path('/run/absorconnect-owned-vm-lab');assert p.read_bytes()==b'absorconnect-native-window-fixture-v1\\n';p.unlink()")
        finally:
            try:
                if owner:
                    assert request('DELETE','/api/me',{'password':password},owner)[0] == 204
                    account_removed = True
            finally:
                if tunnel:
                    tunnel.terminate();tunnel.wait(timeout=8)
                if server:
                    server.shutdown();server.server_close();thread.join(timeout=3)
                report={'schema':1,'cases':results,'productionTested':False,'captureTested':False,'inputTested':False,
                        'realDtlsBindingTested':False,'physicalMachinesTested':False,
                        'credentialsGeneratedUniquely':True,'accountRemoved':account_removed, 'matrixPassed':matrix_passed,
                        'serviceRemoved':service_removed,'artifactHashes':locals().get('manifest',{})}
                target=output/'report.json';target.write_text(json.dumps(report,indent=2)+'\n');target.chmod(0o600)
    print('Informe local: '+str(output/'report.json'))


if __name__ == '__main__':
    main()
