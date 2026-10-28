#!/usr/bin/env python3
"""Componente de la matriz aislada: entrada fija con HMAC/API y dispositivo local propio."""
import hashlib
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
import time
import uuid

ROOT=Path(__file__).resolve().parents[2]
OWN='/opt/absorconnect-input-release-lab'
BINARY='/opt/absorconnect-seat-authority-lab/absor-input-lease-probe-lab'
UNIT='absorconnect-input-lease-probe-lab.service'
OBSERVER='absorconnect-input-observer-lab.service'
MARKER='/run/absorconnect-owned-vm-input-release-probe'
SETUP=r'''
import hashlib,json,os,stat,subprocess,sys
from pathlib import Path
r=json.load(sys.stdin);prefix=Path('/opt/absorconnect-input-release-lab');marker=Path('/run/absorconnect-owned-vm-input-release-probe')
assert not prefix.exists() and not marker.exists()
paths={'probe.py':prefix/'probe.py','linux-xauthority-fd-probe.py':prefix/'linux-xauthority-fd-probe.py','absor-input-lease-probe-lab':Path('/opt/absorconnect-seat-authority-lab/absor-input-lease-probe-lab'),'absorconnect-input-lease-probe-lab.service':Path('/etc/systemd/system/absorconnect-input-lease-probe-lab.service')}
assert set(r['hashes'])==set(paths)
stage=Path(r['stage']);m=stage.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid==1000 and m.st_mode&0o077==0 and stage.parent==Path('/home/absorlab/AbsorConnectLab') and stage.name.startswith('input-lease-staging-')
blobs={}
for name,path in paths.items():
 assert not path.exists();source=stage/name;m=source.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<32*1024*1024
 raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==r['hashes'][name];blobs[name]=raw
assert not any(p.read_text().strip()=='AbsorConnectLabLease' for p in Path('/sys/devices/virtual/input').glob('input*/name'))
prefix.mkdir(mode=0o755);(prefix/'claim.json').write_text(json.dumps(r));(prefix/'claim.json').chmod(0o600)
for name,path in paths.items():
 with path.open('xb') as f:f.write(blobs[name])
 path.chmod(0o644 if name.endswith('.service') else 0o555)
marker.write_bytes(b'absorconnect-owned-input-release-v1\n');marker.chmod(0o400)
subprocess.run(['systemd-analyze','verify',str(paths['absorconnect-input-lease-probe-lab.service'])],check=True,capture_output=True,timeout=10)
subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True,timeout=10)
print(json.dumps({'prepared':True}))
'''
REMOVE=r'''
import hashlib,json,stat,subprocess,sys
from pathlib import Path
r=json.load(sys.stdin);prefix=Path('/opt/absorconnect-input-release-lab');marker=Path('/run/absorconnect-owned-vm-input-release-probe')
if not prefix.exists():print(json.dumps({'removed':True}));raise SystemExit()
saved=json.loads((prefix/'claim.json').read_bytes());assert saved['nonce']==r['nonce'] and saved['hashes']==r['hashes']
for unit in ['absorconnect-input-lease-probe-lab.service','absorconnect-input-observer-lab.service']:
 subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=4)
 subprocess.run(['systemctl','reset-failed',unit],capture_output=True,timeout=4)
assert not any(p.read_text().strip()=='AbsorConnectLabLease' for p in Path('/sys/devices/virtual/input').glob('input*/name'))
paths={'probe.py':prefix/'probe.py','linux-xauthority-fd-probe.py':prefix/'linux-xauthority-fd-probe.py','absor-input-lease-probe-lab':Path('/opt/absorconnect-seat-authority-lab/absor-input-lease-probe-lab'),'absorconnect-input-lease-probe-lab.service':Path('/etc/systemd/system/absorconnect-input-lease-probe-lab.service')}
for name,path in paths.items():
 if path.exists():
  m=path.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and hashlib.sha256(path.read_bytes()).hexdigest()==saved['hashes'][name];path.unlink()
for path in prefix.iterdir():
 m=path.lstat();assert path.name in ['claim.json','window.json','observer-report.json','observer-report.next','observer-stop','observer-change-focus','device-adopted'] and stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and m.st_size<65536;path.unlink()
prefix.rmdir()
if marker.exists():
 m=marker.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and marker.read_bytes()==b'absorconnect-owned-input-release-v1\n';marker.unlink()
subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True,timeout=10)
print(json.dumps({'removed':True,'deviceRemoved':True}))
'''

def run(vm,root,worker,authenticate,ready,output,check):
    files={'probe.py':(ROOT/'prototypes/remote-desktop/unattended-check/linux-uinput-release-probe.py').read_bytes(),'linux-xauthority-fd-probe.py':(ROOT/'prototypes/remote-desktop/unattended-check/linux-xauthority-fd-probe.py').read_bytes(),'absorconnect-input-lease-probe-lab.service':(ROOT/'agent/linux-secure-lab'/UNIT).read_bytes(),'absor-input-lease-probe-lab':vm.remote('cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/absor-input-lease-probe-lab')}
    stage='/home/absorlab/AbsorConnectLab/input-lease-staging-'+uuid.uuid4().hex
    request={'nonce':uuid.uuid4().hex,'stage':stage,'hashes':{name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}}
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w') as archive:
        for name,raw in files.items():
            entry=tarfile.TarInfo(name);entry.size=len(raw);entry.mode=0o600;archive.addfile(entry,io.BytesIO(raw))
    p=subprocess.run(vm.SSH+['mkdir -m 700 '+shlex.quote(stage)+' && tar -xf - -C '+shlex.quote(stage)],input=buffer.getvalue(),capture_output=True,timeout=20);p.check_returncode()
    prepared=False;cases=[]
    def query():
        return json.loads(root("from pathlib import Path;print(Path('/opt/absorconnect-input-release-lab/observer-report.json').read_text())"))
    def wait(predicate,timeout):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            value=query()
            if predicate(value):return value
            time.sleep(.03)
        raise AssertionError('owned_input_observation_timeout')
    def stop_case():
        root("import subprocess;subprocess.run(['systemctl','stop','absorconnect-input-lease-probe-lab.service'],capture_output=True,timeout=3)")
        # Se conserva el observador hasta que el kernel haya retirado la entrada.
        try:
            value=wait(lambda v:not v['heldAtEnd'],2)
            assert not value['heldAtEnd']
        except (subprocess.SubprocessError,ValueError):pass
        root("from pathlib import Path;p=Path('/opt/absorconnect-input-release-lab/observer-stop');p.write_bytes(b'stop-owned-observer-v1\\n');p.chmod(0o400)")
        root("import subprocess;subprocess.run(['systemctl','stop','absorconnect-input-observer-lab.service'],capture_output=True,timeout=3);subprocess.run(['systemctl','reset-failed','absorconnect-input-lease-probe-lab.service','absorconnect-input-observer-lab.service'],capture_output=True,timeout=3)")
    try:
        prepared=True;assert json.loads(root(SETUP,json.dumps(request).encode()))['prepared']
        denied=subprocess.run(vm.SSH+['sudo -n setpriv --no-new-privs --reuid=1000 --regid=1000 --clear-groups '+BINARY],capture_output=True,timeout=5)
        assert denied.returncode==78
        check('owned-input-lease-non-root-cannot-create-device')
        bad_args=subprocess.run(vm.SSH+['sudo -n '+BINARY+' --unsupported'],capture_output=True,timeout=5)
        assert bad_args.returncode==78
        check('owned-input-lease-arbitrary-arguments-denied')
        plans=[('unauthenticated','lease-hold-key'),('normal-key','lease-normal-key'),('normal-button','lease-normal-button'),('disconnect-key','lease-hold-key'),('reauthentication-key','lease-hold-key'),('focus-loss-button','lease-hold-button'),('broker-stall-button','lease-hold-button'),('guard-kill-key','lease-hold-key'),('guard-stop-button','lease-hold-button'),('worker-crash-key','lease-hold-key')]
        for name,mode in plans:
            worker({'op':'disconnect'});ready()
            if name!='unauthenticated':authenticate()
            root("from pathlib import Path\nfor name in ['window.json','observer-report.json','observer-report.next','observer-stop','observer-change-focus','device-adopted']:\n p=Path('/opt/absorconnect-input-release-lab')/name\n if p.exists():\n  import stat;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1;p.unlink()")
            command=['systemd-run','--unit=absorconnect-input-observer-lab','--quiet','--property=Type=exec','--property=RuntimeMaxSec=38s','--property=TimeoutStopSec=1s','--property=KillMode=control-group','--property=NoNewPrivileges=yes','--property=CapabilityBoundingSet=','--property=PrivateNetwork=yes','--property=PrivateTmp=yes','--property=BindReadOnlyPaths=/tmp/.X11-unix','--property=ProtectHome=yes','--property=ProtectSystem=strict','--property=ReadWritePaths='+OWN,'--property=RestrictAddressFamilies=AF_UNIX','--property=LimitCORE=0','--property=MemoryMax=96M','--property=TasksMax=12','/usr/bin/python3','-B','-I',OWN+'/probe.py','lease-observer',mode]
            vm.remote('sudo -n '+' '.join(shlex.quote(v) for v in command))
            # El archivo no existe hasta que el observador termina su preparación.
            root("from pathlib import Path;import time\np=Path('/opt/absorconnect-input-release-lab/observer-report.json');end=time.monotonic()+4\nwhile not p.exists():\n assert time.monotonic()<end;time.sleep(.02)")
            broker_stopped=False
            try:
                p=subprocess.run(vm.SSH+['sudo -n systemctl start '+UNIT],capture_output=True,timeout=8)
                if name=='unauthenticated':
                    assert p.returncode!=0
                    assert not query()['downObserved']
                    assert json.loads(root("from pathlib import Path;import json;print(json.dumps({'none':not any(p.read_text().strip()=='AbsorConnectLabLease' for p in Path('/sys/devices/virtual/input').glob('input*/name'))}))"))['none']
                    case={'case':name,'passed':True,'inputBeforeAuthentication':False}
                else:
                    assert p.returncode==0,'input_guard_start_failed'
                    wait(lambda v:v['downObserved'],4)
                    if name=='disconnect-key':
                        facts=json.loads(root(r"""import json,os,subprocess
from pathlib import Path
pid=int(subprocess.check_output(['systemctl','show','absorconnect-input-lease-probe-lab.service','-p','MainPID','--value']))
assert pid>1
values=dict(line.split(':',1) for line in Path('/proc/'+str(pid)+'/status').read_text().splitlines() if ':' in line)
assert [int(x) for x in values['Uid'].split()]==[0,0,0,0] and int(values['CapEff'],16)==0 and int(values['CapBnd'],16)==0 and values['NoNewPrivs'].strip()=='1'
assert os.readlink('/proc/'+str(pid)+'/ns/net')!=os.readlink('/proc/1/ns/net')
profile=json.loads(Path('/opt/absorconnect-secure-lab/worker-profile.json').read_bytes())
probe="import os\ncount=0\nfor path in ['/dev/uinput','/proc/"+str(pid)+"/fd']:\n try:os.open(path,os.O_RDONLY)\n except PermissionError:count+=1\nassert count==2"
subprocess.run(['setpriv','--no-new-privs','--reuid='+str(profile['uid']),'--regid='+str(profile['gid']),'--clear-groups','/usr/bin/python3','-I','-c',probe],check=True,capture_output=True,timeout=3)
print(json.dumps({'noCapabilities':True,'privateNetwork':True,'noNewPrivileges':True,'workerCannotOpenDeviceOrDescriptors':True}))
"""))
                        assert all(facts.values());check('owned-input-lease-hardening-and-worker-descriptor-denial',**facts)
                    if name.startswith('normal-'):
                        value=wait(lambda v:v['releaseObserved'] and not v['heldAtEnd'],3)
                        elapsed=None
                    else:
                        assert query()['heldAtEnd']
                        fault=time.monotonic()
                        if name=='disconnect-key':worker({'op':'disconnect'})
                        elif name=='reauthentication-key':worker({'op':'disconnect'});ready();authenticate()
                        elif name=='focus-loss-button':root("from pathlib import Path;p=Path('/opt/absorconnect-input-release-lab/observer-change-focus');p.write_bytes(b'change-owned-focus-v1\\n');p.chmod(0o400)")
                        elif name=='broker-stall-button':
                            vm.remote('sudo -n systemctl kill --signal=STOP --kill-whom=main absorconnect-secure-lab.service');broker_stopped=True
                        elif name=='guard-kill-key':vm.remote('sudo -n systemctl kill --signal=KILL --kill-whom=main '+UNIT)
                        elif name=='guard-stop-button':vm.remote('sudo -n systemctl kill --signal=STOP --kill-whom=main '+UNIT)
                        elif name=='worker-crash-key':vm.remote('sudo -n systemctl kill --signal=KILL --kill-whom=main absorconnect-ipc-worker-lab.service')
                        value=wait(lambda v:v['releaseObserved'] and not v['heldAtEnd'],2)
                        elapsed=round((time.monotonic()-fault)*1000)
                    case={'case':name,'passed':True,'fixedInputDownObserved':value['downObserved'],'releaseObserved':value['releaseObserved'],'releaseObservationMilliseconds':elapsed,'observationIncludesSshRoundTrips':elapsed is not None,'heldAtEnd':value['heldAtEnd']}
                cases.append(case);check('owned-input-lease-'+name,**{k:v for k,v in case.items() if k not in ['case','passed']})
            finally:
                if broker_stopped:vm.remote('sudo -n systemctl kill --signal=CONT --kill-whom=main absorconnect-secure-lab.service')
                stop_case()
        worker({'op':'disconnect'});ready();authenticate()
    finally:
        journal=root("import subprocess;print(subprocess.run(['journalctl','--no-pager','-n','120','-u','absorconnect-input-lease-probe-lab.service','-u','absorconnect-input-observer-lab.service'],capture_output=True,text=True).stdout)")
        path=output/'input-lease-journal.log';path.write_bytes(journal);path.chmod(0o600)
        if prepared:assert json.loads(root(REMOVE,json.dumps(request).encode()))['removed']
        vm.remote('rm -rf -- '+shlex.quote(stage))
        path=output/'input-lease-results.json';path.write_text(json.dumps({'cases':cases,'sourceSha256':request['hashes'],'matrixSourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'removed':True,'productionTested':False,'readyForUnattended':False},indent=2));path.chmod(0o600)
    return cases
