#!/usr/bin/env python3
"""API real aislada → broker con secretos → IPC → DTLS/VP8/X11 en VM propia."""
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
import re
import secrets
import shlex
import signal
import subprocess
import tarfile
import threading
import time
import uuid
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[2]
NAMES=['correct','correct-reconnect','wrong-proof','fingerprint-mismatch','api-revoked','api-cut','linux-locked','worker-stall','broker-stall','broker-crash']
SERVICE='absorconnect-secure-lab.service'
WORKER='absorconnect-protected-worker-lab.service'


def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m


def main():
    parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('vm',type=Path);parser.add_argument('--api-base',required=True);parser.add_argument('--node',default='node');args=parser.parse_args()
    uri=urlsplit(args.api_base)
    assert uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.port and uri.path in ('','/') and not(uri.username or uri.password or uri.query or uri.fragment)
    lab=args.lab.resolve();directory=args.vm.resolve();m=directory.stat();assert m.st_uid==os.getuid() and m.st_mode&0o077==0
    control=directory/'vm-control.py';m=control.lstat();assert control.is_file() and not control.is_symlink() and m.st_uid==os.getuid() and m.st_mode&0o022==0
    vm=load('protected_vm',control);assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
    helper=load('native_helper',Path(__file__).with_name('native-x11-worker.py'))
    native=load('protected_api',Path(__file__).with_name('native-renewal.py'));native.BASE=args.api_base;request=native.request
    output=lab/('protected-webrtc-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
    installer=(ROOT/'agent/linux-secure-lab/install-vm.py').read_text()
    owned={};signals={};server=thread=tunnel=child=None;manifest_path=None;work=None
    installed=False;locked=False;errors=[];marker_created=False;result=None;target=None
    build=json.loads((directory/'linux-webrtc-build.json').read_text())
    artifacts={}

    def root(code,data=None,timeout=20):
        r=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -I -c '+shlex.quote(code)],input=data,capture_output=True,timeout=timeout)
        if r.returncode:
            p=output/'root-stderr.txt';p.write_bytes(r.stderr);p.chmod(0o600)
            raise RuntimeError('root_fixture_failed_inspect_private_stderr')
        return r.stdout

    def cleanup_install():
        nonlocal installed
        if installed:
            result=json.loads(root('import sys;sys.argv=["install-vm.py","remove-native"];\n'+installer))
            assert result['removed'] and result['accountRemoved'];installed=False

    def run_worker(name):
        nonlocal installed,locked
        item=owned[name]
        reconnect=name=='correct-reconnect'
        assert not installed or name=='correct-reconnect'
        if vm.context().get('Class')=='greeter':vm.login()
        if helper.screen_state(vm)=='(true,)':vm.logout();vm.login()
        assert helper.screen_state(vm)=='(false,)'
        if name=='linux-locked':
            vm.remote('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver --method org.cinnamon.ScreenSaver.SetActive true')
            locked=True
        data={'hashes':{n:hashlib.sha256(b).hexdigest() for n,b in artifacts.items()},
              'enrollment':{'origin':'http://127.0.0.1:28022','enrollmentToken':item['grant'],
                            'key':base64.b64encode(item['key']).decode(),'salt':item['salt'],'iterations':600000}}
        try:
            if reconnect:
                assert installed
                assert int(vm.remote('systemctl show '+SERVICE+' -p MainPID --value'))==item['brokerPid']
                root("from pathlib import Path;Path('/var/lib/absorconnect-protected-worker-lab/result.json').write_bytes(b'')")
                vm.remote('sudo -n systemctl start '+WORKER)
            else:
                install=json.loads(root('import sys;sys.argv=["install-vm.py","install-native"];\n'+installer,json.dumps(data).encode()))
                installed=True;assert install['brokerUid'] not in (0,1000)
                item['brokerPid']=int(vm.remote('systemctl show '+SERVICE+' -p MainPID --value'))
            # Las denegaciones se comprueban antes de que llegue la prueba HMAC del visor.
            wait='''import json,subprocess,time
from pathlib import Path
p=Path('/var/lib/absorconnect-protected-worker-lab/result.json');deadline=time.monotonic()+75
while time.monotonic()<deadline:
 state=subprocess.check_output(['systemctl','show','absorconnect-protected-worker-lab.service','-p','ActiveState','--value']).strip()
 if state in (b'inactive',b'failed'):
  status=int(subprocess.check_output(['systemctl','show','absorconnect-protected-worker-lab.service','-p','ExecMainStatus','--value']))
  if FAULT:
   print(json.dumps({'exitCode':status}));break
  assert status==0, 'native_worker_failed_'+str(status)
  assert p.exists() and 0<p.stat().st_size<=16384
  value=json.loads(p.read_text());assert value['native']['protectedIpc'] and not value['native']['hostSecretsInWorker']
  print(json.dumps(value));break
 time.sleep(.1)
else:raise AssertionError('native_worker_timeout')
'''
            fault=name in ['worker-stall','broker-stall','broker-crash']
            value=json.loads(root(wait.replace('FAULT',str(fault)),timeout=85))
            if fault:
                assert item.get('faultAt')
                value={'fault':{'name':name,'workerExitCode':value['exitCode'],'processCutMilliseconds':round((time.monotonic()-item['faultAt'])*1000)}}
            attempts=json.loads(root("from pathlib import Path;print(Path('/var/lib/absorconnect-secure-lab/attempts.json').read_text())"))
            assert len(attempts['failures'])==(1 if name in ['wrong-proof','fingerprint-mismatch'] else 0)
            audit=json.loads(root("from pathlib import Path;print(Path('/var/lib/absorconnect-secure-lab/audit.json').read_text())"))
            p=output/(name+'-audit.json');p.write_text(json.dumps(audit,indent=2)+'\n');p.chmod(0o600)
            if name!='correct':cleanup_install()
            value['systemd']={'systemService':True,'exitCode':0,'activeAfterExit':False,'runtimeRemoved':True,'restart':'no','privileged':False,'workerSupervised':True,'brokerWatchdog':True}
            value['protectedIpc']=True
            return value
        finally:
            if name!='correct':cleanup_install()
            if locked:
                vm.logout();vm.login();locked=False

    try:
        for name in NAMES:
            if name=='correct-reconnect':
                owned[name]=owned['correct'];continue
            if name in ['linux-locked','worker-stall','broker-stall','broker-crash']:
                password=owned['correct']['password'];account={'token':owned['correct']['owner']}
            else:
                password=secrets.token_urlsafe(32)
                status,account=request('POST','/api/auth/register',{'email':'protected-p2p-'+uuid.uuid4().hex+'@example.invalid','password':password,'deviceName':'Ensayo IPC P2P efímero'})
                assert status==201,'temporary_registration_failed'
            item=owned[name]={'owner':account['token'],'password':password,'key':secrets.token_bytes(32),'salt':base64.b64encode(secrets.token_bytes(16)).decode(),'cut':threading.Event()}
            item['path']='/api/devices/'+str(uuid.uuid4());device_key=secrets.token_urlsafe(32)
            info={'name':'Host IPC P2P propio','platform':'linux','appVersion':'0.1.0','remote':{'state':'available','features':{'clipboard':False,'files':False,'audio':False}}}
            assert request('PUT',item['path'],info,item['owner'],device_key)[0]==200
            status,enrollment=request('POST',item['path']+'/agent-enrollments',{},item['owner'],device_key);assert status==201;item['grant']=enrollment['enrollmentToken']

        class Proxy(http.server.BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def reply(self,status,data):
                raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def body(self,limit=65536):
                size=int(self.headers.get('Content-Length','0'));assert 0<size<=limit;return json.loads(self.rfile.read(size))
            def item(self):return next((v for v in owned.values() if v.get('agent') and self.headers.get('Authorization')=='Bearer '+v['agent']),None)
            def do_GET(self):
                name=self.path.removeprefix('/signal/')
                if name in signals and self.path=='/signal/'+name:
                    item=owned[name];status,data=request('GET','/api/remote-requests/'+signals[name]['id'],token=item['owner']);self.reply(status,data);return
                item=self.item();assert item and self.path in ['/api/host-agent/remote-requests','/api/host-agent/ice-servers']
                if item['cut'].is_set():self.close_connection=True;return
                status,data=request('GET',self.path,token=item['agent'])
                if status==200 and self.path.endswith('/remote-requests'):item['lastPoll']=time.monotonic()
                self.reply(status,data)
            def do_PUT(self):
                item=self.item();assert item and re.fullmatch('/api/host-agent/remote-requests/[0-9a-f-]{36}/answer',self.path)
                status,data=request('PUT',self.path,self.body(400000),item['agent'])
                if status==204:self.send_response(204);self.end_headers()
                else:self.reply(status,data)
            def do_POST(self):
                if self.path=='/api/host-agent/enroll':
                    body=self.body(4096);item=next(v for v in owned.values() if v['grant']==body.get('enrollmentToken'))
                    assert not self.headers.get('Authorization')
                    status,data=request('POST',self.path,body)
                    if status==201:item['agent']=data['token']
                    self.reply(status,data);return
                name=self.path.removeprefix('/protected/').removesuffix('/run')
                if self.path=='/protected/'+name+'/run' and name in owned:
                    self.body(32)
                    try:self.reply(200,run_worker(name))
                    except Exception:
                        import traceback
                        p=output/(name+'-failure.txt');p.write_text(traceback.format_exc());p.chmod(0o600)
                        self.reply(500,{'failed':True})
                    return
                name=self.path.removeprefix('/proof/')
                if self.path=='/proof/'+name and name in owned:
                    body=self.body(1024);assert set(body)=={'nonce','salt','iterations','offerFingerprint','answerFingerprint'}
                    assert body['salt']==owned[name]['salt'] and body['iterations']==600000 and len(base64.b64decode(body['nonce'],validate=True))==32
                    assert all(isinstance(body[k],str) and len(body[k])<=128 for k in ['offerFingerprint','answerFingerprint'])
                    text='absor-remote-auth-v1\n'+body['nonce']+'\n'+body['offerFingerprint']+'\n'+body['answerFingerprint']
                    if name in ['correct','correct-reconnect']:
                        nonces=owned[name].setdefault('nonces',set());assert body['nonce'] not in nonces;nonces.add(body['nonce'])
                    proof=base64.b64encode(hmac.digest(owned[name]['key'],text.encode(),'sha256')).decode();self.reply(200,{'proof':proof});return
                if self.path=='/signal/correct/busy':
                    item=owned['correct'];status,pending=request('POST',item['path']+'/remote-requests',{'offer':signals['correct']['offer']},item['owner']);assert status==201
                    end=time.monotonic()+10
                    while time.monotonic()<end:
                        status,data=request('GET','/api/remote-requests/'+pending['id'],token=item['owner'])
                        if status==200 and data.get('status')=='rejected':
                            assert data['rejection']['reason']=='busy';item['busyVerified']=True;self.send_response(204);self.end_headers();return
                        time.sleep(.1)
                    self.send_error(504);return
                name=self.path.removeprefix('/signal/')
                if self.path=='/signal/'+name and name in owned and name not in signals:
                    body=self.body(400000);assert set(body)=={'offer'} and isinstance(body['offer'],str) and 0<len(body['offer'].encode())<=65536
                    item=owned[name];end=time.monotonic()+30
                    while time.monotonic()-item.get('lastPoll',0)>1:
                        assert time.monotonic()<end;time.sleep(.02)
                    status,data=request('POST',item['path']+'/remote-requests',body,item['owner'])
                    if status==201:signals[name]={'id':data['id'],'offer':body['offer']}
                    self.reply(status,{'created':status==201});return
                name=self.path.removeprefix('/fault/');assert name in ['api-cut','api-revoked','worker-stall','broker-stall','broker-crash'] and self.path=='/fault/'+name
                if name in ['worker-stall','broker-stall','broker-crash']:
                    owned[name]['faultAt']=time.monotonic()
                    target=WORKER if name=='worker-stall' else SERVICE
                    sig='KILL' if name=='broker-crash' else 'STOP'
                    vm.remote('sudo -n systemctl kill --signal='+sig+' --kill-whom=main '+target)
                elif name=='api-cut':owned[name]['cut'].set()
                else:assert request('DELETE',owned[name]['path']+'/agent',{},owned[name]['owner'])[0]==204
                self.send_response(204);self.end_headers()

        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Proxy);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();origin='http://127.0.0.1:'+str(server.server_address[1])
        tunnel=subprocess.Popen(vm.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes','-R','127.0.0.1:28022:127.0.0.1:'+str(server.server_address[1]),vm.SSH[-1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(.5);assert tunnel.poll() is None
        artifacts['absor-protected-channel-lab']=(lab/'webrtc-native/src/out/AbsorLinuxProbe/rust_video_channel_check').read_bytes();assert hashlib.sha256(artifacts['absor-protected-channel-lab']).hexdigest()==build['binarySha256']
        artifacts['libabsor_agent_webrtc_lab.so']=(lab/'webrtc-native/src/absor_connect_probe/libabsor_agent_webrtc_lab.so').read_bytes();assert hashlib.sha256(artifacts['libabsor_agent_webrtc_lab.so']).hexdigest()==build['libraries']['libabsor_agent_webrtc_lab.so']
        for name in ['absor-secure-broker-lab','absor-secret-provision-lab']:artifacts[name]=vm.remote('cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/'+name)
        for name in ['absorconnect-secure-lab.service','absorconnect-secure-lab.socket','absorconnect-protected-worker-lab.service']:artifacts[name]=(ROOT/'agent/linux-secure-lab'/name).read_bytes()
        buffer=io.BytesIO()
        with tarfile.open(fileobj=buffer,mode='w') as archive:
            for name,raw in artifacts.items():
                info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o600;archive.addfile(info,io.BytesIO(raw))
        vm.remote('mkdir -m 700 /home/absorlab/AbsorConnectLab/secure-ipc-staging && tar -xf - -C /home/absorlab/AbsorConnectLab/secure-ipc-staging',buffer.getvalue())
        marker_created=json.loads(root("from pathlib import Path;import os,json;p=Path('/run/absorconnect-owned-vm-lab');created=not p.exists()\nif created:\n fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o444);os.write(fd,b'absorconnect-native-window-fixture-v1\\n');os.close(fd)\nelse:assert not p.is_symlink() and p.read_bytes()==b'absorconnect-native-window-fixture-v1\\n'\nprint(json.dumps(created))"))
        # Este manifiesto contiene únicamente rutas loopback y una cadena pública de compatibilidad.
        manifest={name:{'origin':origin,'credential':'acg_'+'a'*43,'apiSignaling':True,'signalUrl':origin+'/signal/'+name,'faultUrl':origin+'/fault/'+name} for name in NAMES}
        manifest_path=output/'controller.json';manifest_path.write_text(json.dumps(manifest));manifest_path.chmod(0o600)
        child=subprocess.Popen([args.node,str(ROOT/'prototypes/remote-desktop/webrtc-check/run-interop.cjs'),str(lab),'--agent-config',str(manifest_path),'--linux-vm',str(directory),'--linux-protected'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:stdout,stderr=child.communicate(timeout=290)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid,signal.SIGKILL);stdout,stderr=child.communicate(timeout=10)
        log=output/'interop.log';log.write_bytes(stdout+stderr);log.chmod(0o600)
        paths=re.findall(r'^Informe local: (.+)$',stdout.decode(errors='replace'),re.M);assert paths
        report_path=Path(paths[-1]);work=report_path.parent
        result=json.loads(report_path.read_text());assert child.returncode==0 and result['ok'],'protected_interop_failed_inspect_private_log'
        assert len(result['cases'])==10 and result['protectedIpcTested'] and result['rendererCredentialsDenied']
        assert owned['correct'].get('busyVerified') and len(owned['correct']['nonces'])==2
        assert all(c['native']['native']['protectedIpc'] and not c['native']['native']['hostSecretsInWorker'] for c in result['cases'] if 'native' in c)
        assert not list(work.glob('**/*.sdp'))
        result.update({'productionTested':False,'physicalMachinesTested':False,'uniqueHostKeys':True,'twoConnectionsSameBroker':True,'secondConnectionUsesNewNonce':True,'apiCredentialsKeptInBroker':True,'temporaryAccountsRemoved':False,'secondControllerBusyRejected':True,'sdpFilesWritten':False,'artifactHashes':{n:hashlib.sha256(b).hexdigest() for n,b in artifacts.items()}})
        target=output/'report.json';target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)
        print('Informe local: '+str(target))
    finally:
        cleanup_install()
        if locked:vm.logout();vm.login()
        vm.remote('rm -rf /home/absorlab/AbsorConnectLab/secure-ipc-staging')
        if marker_created:root("from pathlib import Path;p=Path('/run/absorconnect-owned-vm-lab');assert p.read_bytes()==b'absorconnect-native-window-fixture-v1\\n';p.unlink()")
        retired=set()
        for item in owned.values():
            if item['owner'] in retired:continue
            retired.add(item['owner'])
            try:assert request('DELETE','/api/me',{'password':item['password']},item['owner'])[0]==204
            except Exception:errors.append('account_cleanup')
        if tunnel:tunnel.terminate();tunnel.wait(timeout=8)
        if server:server.shutdown();server.server_close();thread.join(timeout=3)
        assert not errors,'temporary_account_cleanup_failed'
        if result is not None and target is not None:
            result['temporaryAccountsRemoved']=True
            result['servicesAndSecretsRemoved']=not installed
            target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)


if __name__=='__main__':main()
