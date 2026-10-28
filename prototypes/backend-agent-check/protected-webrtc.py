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
    parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('vm',type=Path);parser.add_argument('--api-base',required=True);parser.add_argument('--node',default='node');parser.add_argument('--mobile-device');parser.add_argument('--mobile-runtime',action='store_true');parser.add_argument('--turn-config',type=Path);parser.add_argument('--stun-config',type=Path);parser.add_argument('--android-mapped-direct',action='store_true');args=parser.parse_args()
    mobile_module=load('mobile_protected',Path(__file__).with_name('mobile-protected-runner.py')) if args.mobile_device else None
    assert not args.mobile_runtime or args.mobile_device, 'runtime_requires_mobile_device'
    names=['correct','correct-reconnect'] if args.mobile_runtime else mobile_module.NAMES if mobile_module else NAMES
    if args.mobile_device:
        assert args.mobile_device=='emulator-5554' or re.fullmatch('[0-9A-F-]{36}',args.mobile_device)
    assert not args.android_mapped_direct or args.mobile_device=='emulator-5554' and not(args.turn_config or args.stun_config)
    assert not(args.turn_config and args.stun_config)
    assert not args.stun_config or args.mobile_device
    ice_config=args.turn_config or args.stun_config
    controller_ice={'iceServers':[],'relayController':False}
    if ice_config:
        metadata=ice_config.lstat()
        assert ice_config.is_file() and not ice_config.is_symlink() and metadata.st_uid==os.getuid() and metadata.st_mode&0o077==0 and metadata.st_size<=16384
        value=json.loads(ice_config.read_text());assert set(value)=={'iceServers'} and isinstance(value['iceServers'],list) and 1<=len(value['iceServers'])<=8
        for entry in value['iceServers']:
            assert isinstance(entry,dict) and isinstance(entry.get('urls'),list) and 1<=len(entry['urls'])<=8
            assert all(isinstance(u,str) and len(u)<=512 and re.fullmatch(r'(?:turns?|stuns?):[^\s]+',u) for u in entry['urls'])
            turn=entry['urls'][0].startswith(('turn:','turns:'))
            assert all(u.startswith(('turn:','turns:'))==turn for u in entry['urls'])
            if turn:
                assert set(entry)=={'urls','username','credential'}
                assert all(isinstance(entry[k],str) and 0<len(entry[k])<=1024 for k in ['username','credential'])
            else:assert set(entry)=={'urls'}
        has_turn=any(u.startswith(('turn:','turns:')) for entry in value['iceServers'] for u in entry['urls'])
        assert has_turn is bool(args.turn_config)
        controller_ice={**value,'relayController':bool(args.turn_config)}
    source_names=['prototypes/backend-agent-check/protected-webrtc.py','prototypes/backend-agent-check/mobile-protected-runner.py','prototypes/backend-agent-check/isolated-webrtc-renewal.py','prototypes/remote-desktop/webrtc-check/mobile-protected-interop-test.dart','prototypes/remote-desktop/webrtc-check/mobile-runtime-interop-test.dart','prototypes/remote-desktop/webrtc-check/check-green-frame.swift','prototypes/remote-desktop/webrtc-check/run-interop.cjs','prototypes/remote-desktop/webrtc-check/interop-main.cjs','prototypes/remote-desktop/webrtc-check/interop-renderer.js']
    source_hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in source_names}
    mobile_runtime_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'mobile/lib').rglob('*.dart'))} if args.mobile_runtime else {}
    uri=urlsplit(args.api_base)
    assert uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.port and uri.path in ('','/') and not(uri.username or uri.password or uri.query or uri.fragment)
    lab=args.lab.resolve();directory=args.vm.resolve();m=directory.stat();assert m.st_uid==os.getuid() and m.st_mode&0o077==0
    control=directory/'vm-control.py';m=control.lstat();assert control.is_file() and not control.is_symlink() and m.st_uid==os.getuid() and m.st_mode&0o022==0
    vm=load('protected_vm',control);assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
    helper=load('native_helper',Path(__file__).with_name('native-x11-worker.py'))
    native=load('protected_api',Path(__file__).with_name('native-renewal.py'));native.BASE=args.api_base;request=native.request
    output=lab/('protected-webrtc-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
    installer=(ROOT/'agent/linux-secure-lab/install-vm.py').read_text()
    owned={};signals={};server=thread=tunnel=child=None;manifest_path=None;work=None;mapping=None
    installed=False;locked=False;errors=[];marker_created=False;result=None;target=None
    build=json.loads((directory/'linux-webrtc-build.json').read_text())
    # No atribuir el resultado a fuentes que no corresponden al binario probado.
    for name,digest in build['artifactSourceSha256'].items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,'native_build_source_drift'
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

    worker_lock=threading.Lock()
    def run_worker(name):
        with worker_lock:return run_worker_locked(name)

    def run_worker_locked(name):
        nonlocal installed,locked
        item=owned[name]
        completed=False
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
            saved=output/(name+'-native-result.json');saved.write_text(json.dumps(value,indent=2)+'\n');saved.chmod(0o600)
            item['nativeResult']=value
            completed=True
            return value
        finally:
            if not completed:
                error=output/'root-stderr.txt'
                if error.exists():
                    saved=output/(name+'-root-stderr.txt');saved.write_bytes(error.read_bytes());saved.chmod(0o600)
            if name!='correct' or not completed:cleanup_install()
            if locked:
                vm.logout();vm.login();locked=False

    try:
        for name in names:
            if name=='correct-reconnect':
                owned[name]=owned['correct'];continue
            if name in ['linux-locked','worker-stall','broker-stall','broker-crash']:
                password=owned['correct']['password'];account={'token':owned['correct']['owner']}
            else:
                password=secrets.token_urlsafe(32)
                status,account=request('POST','/api/auth/register',{'email':'protected-p2p-'+uuid.uuid4().hex+'@example.invalid','password':password,'deviceName':'Ensayo IPC P2P efímero'})
                assert status==201,'temporary_registration_failed'
            item=owned[name]={'owner':account['token'],'password':password,'key':secrets.token_bytes(32),'salt':base64.b64encode(secrets.token_bytes(16)).decode(),'cut':threading.Event()}
            if mobile_module:
                item['key']=hashlib.pbkdf2_hmac('sha256','contraseña-del-pc'.encode(),base64.b64decode(item['salt']),600000)
            item['path']='/api/devices/'+str(uuid.uuid4());device_key=secrets.token_urlsafe(32)
            info={'name':'Host IPC P2P propio','platform':'linux','appVersion':'0.1.0','remote':{'state':'available','features':{'clipboard':False,'files':False,'audio':False}}}
            assert request('PUT',item['path'],info,item['owner'],device_key)[0]==200
            status,enrollment=request('POST',item['path']+'/agent-enrollments',{},item['owner'],device_key);assert status==201;item['grant']=enrollment['enrollmentToken']

        mapping=mobile_module.VmDirectMapping(vm) if args.android_mapped_direct else None
        def prepare_mobile():
            if args.mobile_device!='emulator-5554':return
            import xml.etree.ElementTree as ET
            command=['/opt/homebrew/share/android-commandlinetools/platform-tools/adb','-s',args.mobile_device]
            assert subprocess.check_output(command+['emu','avd','name'],timeout=10).splitlines()[0]==b'absorconnect'
            path='/sdcard/absorconnect-owned-test-ui.xml'
            try:
                subprocess.run(command+['shell','uiautomator','dump',path],capture_output=True,check=True,timeout=15)
                tree=ET.fromstring(subprocess.check_output(command+['shell','cat',path],timeout=10))
                nodes=[n for n in tree.iter('node') if n.get('text')=='Got it' and n.get('clickable')=='true' and n.get('package') in ('android','com.android.systemui')]
                assert len(nodes)<=1,'ambiguous_fullscreen_tutorial'
                if nodes:
                    points=[int(v) for v in re.findall(r'\d+',nodes[0].get('bounds',''))];assert len(points)==4 and all(0<=v<=5000 for v in points)
                    subprocess.run(command+['shell','input','tap',str((points[0]+points[2])//2),str((points[1]+points[3])//2)],capture_output=True,check=True,timeout=10)
            finally:subprocess.run(command+['shell','rm',path],capture_output=True,timeout=10)

        def screenshot(name):
            assert args.mobile_runtime and name in ('correct','correct-reconnect')
            path=output/(name+'-production-mobile-screen.png');assert not path.exists()
            deadline=time.monotonic()+18
            while True:
                if args.mobile_device=='emulator-5554':
                    adb='/opt/homebrew/share/android-commandlinetools/platform-tools/adb'
                    assert subprocess.check_output([adb,'-s',args.mobile_device,'emu','avd','name'],timeout=10).splitlines()[0]==b'absorconnect'
                    data=subprocess.check_output([adb,'-s',args.mobile_device,'exec-out','screencap','-p'],timeout=15)
                    path.write_bytes(data)
                else:
                    assert args.mobile_device=='0D9B8664-A2FF-46C4-95AC-D30591167441'
                    subprocess.run(['xcrun','simctl','io',args.mobile_device,'screenshot','--type=png',str(path)],check=True,capture_output=True,timeout=15)
                    data=path.read_bytes()
                path.chmod(0o600)
                assert data.startswith(b'\x89PNG\r\n\x1a\n') and 1024<len(data)<20*1024*1024
                check=subprocess.run(['/usr/bin/swift','-module-cache-path',str(lab/'swift-pixel-cache'),str(ROOT/'prototypes/remote-desktop/webrtc-check/check-green-frame.swift'),str(path)],capture_output=True,timeout=25)
                assert check.returncode in (0,1),'png_analysis_failed'
                if check.returncode==0:
                    owned[name].setdefault('greenCases',set()).add(name);return
                assert time.monotonic()<deadline,'native_green_frame_not_rendered'
                path.unlink();time.sleep(.1)

        mobile=mobile_module.MobileController(owned,signals,request,output,controller_ice,mapping,runtime=args.mobile_runtime,screenshot=screenshot,prepare=prepare_mobile) if mobile_module else None

        class Proxy(http.server.BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def reply(self,status,data):
                raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def body(self,limit=65536):
                size=int(self.headers.get('Content-Length','0'));assert 0<size<=limit;return json.loads(self.rfile.read(size))
            def item(self):return next((v for v in owned.values() if v.get('agent') and self.headers.get('Authorization')=='Bearer '+v['agent']),None)
            def do_GET(self):
                if mobile and mobile.get(self):return
                name=self.path.removeprefix('/signal/')
                if name in signals and self.path=='/signal/'+name:
                    item=owned[name];status,data=request('GET','/api/remote-requests/'+signals[name]['id'],token=item['owner']);self.reply(status,data);return
                item=self.item();assert item and self.path in ['/api/host-agent/remote-requests','/api/host-agent/ice-servers']
                if item['cut'].is_set():self.close_connection=True;return
                status,data=request('GET',self.path,token=item['agent'])
                if status==200 and self.path.endswith('/ice-servers') and ice_config:data['iceServers']=controller_ice['iceServers']
                if status==200 and self.path.endswith('/remote-requests'):item['lastPoll']=time.monotonic()
                self.reply(status,data)
            def do_PUT(self):
                item=self.item();assert item and re.fullmatch('/api/host-agent/remote-requests/[0-9a-f-]{36}/answer',self.path)
                body=self.body(400000)
                if mapping and 'answer' in body:body['answer']=mapping.answer(body['answer'])
                status,data=request('PUT',self.path,body,item['agent'])
                if status==204:self.send_response(204);self.end_headers()
                else:self.reply(status,data)
            def do_POST(self):
                if mobile and mobile.post(self):return
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
        manifest={name:{'origin':origin,'credential':'acg_'+'a'*43,'apiSignaling':True,'signalUrl':origin+'/signal/'+name,'faultUrl':origin+'/fault/'+name} for name in names}
        manifest_path=output/'controller.json';manifest_path.write_text(json.dumps(manifest));manifest_path.chmod(0o600)
        if mobile:
            project=lab/'mobile-simulator'
            assert project.is_dir() and not project.is_symlink()
            import shutil
            if args.mobile_runtime:
                shutil.copytree(ROOT/'mobile/lib',project/'lib',dirs_exist_ok=True)
            else:
                for filename in ['auth.dart','pbkdf2.dart','agent_protocol.dart','input.dart','protocol.dart']:
                    shutil.copyfile(ROOT/'mobile/lib/src/remote'/filename,project/'lib/src/remote'/filename)
            shutil.copyfile(ROOT/'prototypes/remote-desktop/webrtc-check'/('mobile-runtime-interop-test.dart' if args.mobile_runtime else 'mobile-protected-interop-test.dart'),project/'integration_test/protected_native_interop_test.dart')
            adb=Path('/opt/homebrew/share/android-commandlinetools/platform-tools/adb')
            android=args.mobile_device=='emulator-5554'
            if android:subprocess.run([str(adb),'-s',args.mobile_device,'reverse','tcp:'+str(server.server_address[1]),'tcp:'+str(server.server_address[1])],check=True,capture_output=True,timeout=15)
            try:
                command=['/opt/homebrew/bin/flutter','drive','--no-pub','--driver=test_driver/integration_test.dart','--target=integration_test/protected_native_interop_test.dart','--dart-define=ABSOR_NATIVE_LAB_URL='+origin,'-d',args.mobile_device]
                environment=dict(os.environ)
                if android:environment.update(ANDROID_HOME='/opt/homebrew/share/android-commandlinetools',ANDROID_SDK_ROOT='/opt/homebrew/share/android-commandlinetools',JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home')
                log=output/'mobile-interop.log'
                descriptor=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(descriptor,'wb') as stream:
                    child=subprocess.Popen(command,cwd=project,env=environment,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
                    try:child.wait(timeout=480)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=10)
                assert child.returncode==0 and len(mobile.results)==len(names),'mobile_interop_failed_inspect_private_log'
                result={'ok':True,'cases':mobile.results,'protectedIpcTested':True,'nativeWorkerConnected':True,'mobileTested':True,'productionMobileRuntimeTested':args.mobile_runtime,'turnTested':bool(args.turn_config),'relayPolicy':'controller' if args.turn_config else 'none','readyForUnattended':False}
            finally:
                if android:subprocess.run([str(adb),'-s',args.mobile_device,'reverse','--remove','tcp:'+str(server.server_address[1])],capture_output=True,timeout=15)
        else:
            command=[args.node,str(ROOT/'prototypes/remote-desktop/webrtc-check/run-interop.cjs'),str(lab),'--agent-config',str(manifest_path),'--linux-vm',str(directory),'--linux-protected']
            if args.turn_config:command += ['--turn-config',str(args.turn_config.resolve()),'--relay-controller']
            child=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
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
        assert len(owned['correct']['nonces'])==2
        result.update({'productionTested':False,'physicalMachinesTested':False,'uniqueHostKeys':True,'twoConnectionsSameBroker':True,'secondConnectionUsesNewNonce':True,'apiCredentialsKeptInBroker':True,'temporaryAccountsRemoved':False,'sdpFilesWritten':False,'artifactHashes':{n:hashlib.sha256(b).hexdigest() for n,b in artifacts.items()}})
        result['fixtureSourceSha256']=source_hashes
        if args.mobile_runtime:result['mobileRuntimeSourceSha256']=mobile_runtime_hashes
        if mapping:result.update({'directVmNatMapping':True,'vmNatMappedPortsTotal':mapping.total,'vmNatMappingsRemoved':not mapping.ports})
        target=output/'report.json';target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)
        print('Informe local: '+str(target))
    finally:
        if mapping:
            try:mapping.close()
            except Exception:errors.append('vm_nat_cleanup')
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
        if work and work.parent==lab and work.name.startswith('interop-'):
            for name in ['turn-config.json','native-ice.json']:(work/name).unlink(missing_ok=True)
        assert not errors,'temporary_account_cleanup_failed'
        if result is not None and target is not None:
            result['temporaryAccountsRemoved']=True
            result['servicesAndSecretsRemoved']=not installed
            target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)


if __name__=='__main__':main()
