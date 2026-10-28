#!/usr/bin/env python3
"""Ensayo de unidad/selección en la VM propia; sin API, pantalla, entrada o credenciales."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
SERVICE = 'absorconnect-sessiond.service'
INSTALL = r'''
import hashlib,json,os,stat,subprocess,sys
from pathlib import Path
request=json.loads(sys.stdin.buffer.read(65537));assert len(json.dumps(request))<65536
prefix=Path('/usr/lib/absorconnect');unit=Path('/etc/systemd/system/absorconnect-sessiond.service');claim=Path('/var/lib/absorconnect-sessiond-owned-lab')
assert not prefix.exists() and not unit.exists() and not claim.exists(),'reserved_paths_exist'
stage=Path(request['stage']);assert stage.parent==Path('/home/absorlab/AbsorConnectLab') and stage.name.startswith('sessiond-stage-') and len(stage.name)==47
assert not stage.is_symlink() and stat.S_ISDIR(stage.lstat().st_mode) and stage.lstat().st_uid==1000 and stage.lstat().st_mode&0o077==0
payload={}
for name,digest in request['hashes'].items():
 assert name in ['absor-sessiond','absorconnect-sessiond.service']
 p=stage/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<32*1024*1024
 raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==digest
 payload[name]=raw
assert set(payload)=={'absor-sessiond','absorconnect-sessiond.service'}
claim.mkdir(mode=0o700);(claim/'claim.json').write_text(json.dumps(request));(claim/'claim.json').chmod(0o600)
prefix.mkdir(mode=0o755)
for name,raw in payload.items():
 p=prefix/name if name=='absor-sessiond' else unit
 with p.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 p.chmod(0o555 if name=='absor-sessiond' else 0o644)
subprocess.run(['systemd-analyze','verify',str(unit)],capture_output=True,check=True,timeout=10)
subprocess.run(['systemctl','daemon-reload'],capture_output=True,check=True,timeout=10)
subprocess.run(['systemctl','enable','--now','absorconnect-sessiond.service'],capture_output=True,check=True,timeout=15)
print(json.dumps({'installed':True}))
'''
CLEANUP = r'''
import hashlib,json,subprocess,sys,stat
from pathlib import Path
request=json.loads(sys.stdin.buffer.read(65537));claim=Path('/var/lib/absorconnect-sessiond-owned-lab')
if not claim.exists():print(json.dumps({'removed':True,'alreadyAbsent':True}));sys.exit(0)
m=claim.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid==0 and m.st_mode&0o077==0
saved=json.loads((claim/'claim.json').read_text());assert saved['nonce']==request['nonce'] and saved['hashes']==request['hashes'],'foreign_claim'
paths={'absor-sessiond':Path('/usr/lib/absorconnect/absor-sessiond'),'absorconnect-sessiond.service':Path('/etc/systemd/system/absorconnect-sessiond.service')}
for name,p in paths.items():
 if p.exists():
  m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and hashlib.sha256(p.read_bytes()).hexdigest()==saved['hashes'][name],'foreign_file'
subprocess.run(['systemctl','disable','--now','absorconnect-sessiond.service'],capture_output=True,timeout=15)
for p in paths.values():p.unlink(missing_ok=True)
prefix=Path('/usr/lib/absorconnect')
if prefix.exists() and not any(prefix.iterdir()):prefix.rmdir()
subprocess.run(['systemctl','daemon-reload'],capture_output=True,check=True,timeout=10)
subprocess.run(['systemctl','reset-failed','absorconnect-sessiond.service'],capture_output=True,timeout=10)
(claim/'claim.json').unlink();claim.rmdir()
assert not Path('/run/absorconnect-sessiond').exists()
print(json.dumps({'removed':True,'serviceStopped':True,'runtimeRemoved':True}))
'''
READ = r'''
import json,os,stat,subprocess,time
from pathlib import Path
raw=subprocess.check_output(['systemctl','show','absorconnect-sessiond.service','-p','MainPID','-p','ActiveState','-p','SubState','-p','NRestarts'])
unit=dict(l.split('=',1) for l in raw.decode().splitlines());pid=int(unit['MainPID']);path=Path('/run/absorconnect-sessiond/status.json')
if unit['ActiveState']!='active' or pid<=1 or not path.exists():print(json.dumps({'active':False}));raise SystemExit()
m=path.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and stat.S_IMODE(m.st_mode)==0o444 and m.st_size<=1024
value=json.loads(path.read_text());assert set(value)=={'v','instance','bootId','publicationSequence','pid','publishedAtBoottimeMillis','sampleStartedBoottimeMillis','state','captureAvailable','inputAvailable','readyForUnattended'}
if value['pid']!=pid:print(json.dumps({'active':False}));raise SystemExit()
assert value['v']==1 and value['captureAvailable'] is False and value['inputAvailable'] is False and value['readyForUnattended'] is False
assert value['bootId']==Path('/proc/sys/kernel/random/boot_id').read_text().strip()
age=time.clock_gettime(time.CLOCK_BOOTTIME)*1000-value['publishedAtBoottimeMillis']
if not 0<=age<1200:print(json.dumps({'active':False,'staleSelectionRejected':True}));raise SystemExit()
status=dict(l.split(':',1) for l in Path('/proc/'+str(pid)+'/status').read_text().splitlines() if ':' in l)
assert status['NoNewPrivs'].strip()=='1' and int(status['CapEff'],16)==0 and int(status['CapBnd'],16)==0
assert os.readlink('/proc/'+str(pid)+'/ns/net')!=os.readlink('/proc/1/ns/net')
assert Path('/proc/'+str(pid)+'/exe').resolve()==Path('/usr/lib/absorconnect/absor-sessiond')
print(json.dumps({'active':True,'pid':pid,'instance':value['instance'],'state':value['state'],'publication':value['publicationSequence'],'restarts':int(unit['NRestarts']),'privateNetwork':True,'noCapabilities':True,'statusRootReadOnly':True}))
'''

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('vm',type=Path);parser.add_argument('--cold-boot',action='store_true');args=parser.parse_args()
    directory=args.vm.resolve();meta=directory.stat();assert meta.st_uid==os.getuid() and meta.st_mode&0o077==0
    spec=importlib.util.spec_from_file_location('session_vm',directory/'vm-control.py');vm=importlib.util.module_from_spec(spec);spec.loader.exec_module(vm)
    assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
    output=args.lab.resolve()/('linux-session-service-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
    records=[];request=None;claimed=False;installed=False;result=None
    def command(argv,label,timeout=20):
        p=subprocess.run(argv,capture_output=True,timeout=timeout)
        dest=output/(label+'.log');dest.write_bytes(p.stdout+p.stderr);dest.chmod(0o600)
        assert p.returncode==0,label+'_failed_inspect_private_log'
        return p.stdout
    def root(source,value=None,timeout=25):
        p=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -I -c '+shlex.quote(source)],input=json.dumps(value).encode() if value is not None else None,capture_output=True,timeout=timeout)
        if p.returncode:
            path=output/'last-root-error.log';path.write_bytes(p.stderr);path.chmod(0o600);raise RuntimeError('root_step_failed_inspect_private_log')
        return json.loads(p.stdout)
    def wait(state,old=None):
        end=time.monotonic()+14
        while time.monotonic()<end:
            value=root(READ)
            if value['active'] and value['state']==state and (old is None or value['pid']!=old):return value
            time.sleep(.15)
        raise RuntimeError('service_state_timeout')
    def record(name,value):
        records.append({'case':name,**value});print(json.dumps({'case':name,'passed':True}),flush=True)
    try:
        assert vm.context()['Class']=='user'
        unit=(ROOT/'agent/linux/absorconnect-sessiond.service').read_bytes();unit_hash=hashlib.sha256(unit).hexdigest()
        binary_hash=command(vm.SSH+['sha256sum /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/absor-sessiond'],'binary-hash').decode().split()[0];assert len(binary_hash)==64
        stage='/home/absorlab/AbsorConnectLab/sessiond-stage-'+uuid.uuid4().hex
        command(vm.SSH+['mkdir -m 700 '+shlex.quote(stage)+' && cp /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/absor-sessiond '+shlex.quote(stage+'/absor-sessiond')],'stage-binary')
        p=subprocess.run(vm.SSH+['cat > '+shlex.quote(stage+'/absorconnect-sessiond.service')],input=unit,capture_output=True,check=True,timeout=10)
        request={'nonce':uuid.uuid4().hex,'stage':stage,'hashes':{'absor-sessiond':binary_hash,'absorconnect-sessiond.service':unit_hash}}
        path=output/'owned-install.json';path.write_text(json.dumps(request));path.chmod(0o600)
        claimed=True;assert root(INSTALL,request,40)['installed'];installed=True
        initial=wait('user_session');record('desktop-selection',initial)
        time.sleep(.6);later=wait('user_session');assert later['instance']==initial['instance'] and later['publication']>initial['publication'];record('fresh-publication',{'advanced':True})
        denial=r'''import json,subprocess
code="from pathlib import Path\ntry:\n Path('/run/absorconnect-sessiond/status.json').write_bytes(b'fake')\nexcept PermissionError: raise SystemExit(0)\nraise SystemExit(9)"
p=subprocess.run(['/usr/sbin/runuser','-u','absorlab','--','/usr/bin/python3','-I','-c',code],capture_output=True);assert p.returncode==0
p=subprocess.run(['/usr/sbin/runuser','-u','absorlab','--','/usr/lib/absorconnect/absor-sessiond'],capture_output=True);assert p.returncode==78
p=subprocess.run(['/usr/lib/absorconnect/absor-sessiond'],capture_output=True);assert p.returncode==78
print(json.dumps({'unprivilegedWriteDenied':True,'unprivilegedStartDenied':True,'duplicateStartDenied':True}))'''
        record('denials',root(denial))
        vm.logout();record('greeter-selection',wait('greeter'));vm.login();record('new-user-session',wait('user_session'))
        for name,sig in [('crash-recovery','SIGKILL'),('watchdog-recovery','SIGSTOP')]:
            old=wait('user_session');command(vm.SSH+['sudo -n systemctl kill --kill-who=main --signal='+sig+' '+SERVICE],name+'-signal')
            if sig=='SIGSTOP':
                time.sleep(1.3);stale=root(READ);assert not stale['active'] and stale.get('staleSelectionRejected');record('stale-selection-rejected',{'beforeWatchdogRecovery':True})
            new=wait('user_session',old['pid']);assert new['instance']!=old['instance'] and new['restarts']>old['restarts'];record(name,{'newInstance':True,'restartsAdvanced':True})
        command(vm.SSH+['sudo -n systemctl stop '+SERVICE],'explicit-stop')
        time.sleep(4)
        stopped=command(vm.SSH+['systemctl show '+SERVICE+' -p MainPID -p ActiveState'],'stopped-state').decode();assert 'MainPID=0' in stopped and 'ActiveState=inactive' in stopped;record('explicit-stop',{'remainedStopped':True})
        if args.cold_boot:
            command([sys.executable,str(directory/'vm-lifecycle.py'),'stop'],'cold-poweroff',180)
            command([sys.executable,str(directory/'vm-lifecycle.py'),'start'],'cold-start',120)
            assert vm.context()['Class']=='greeter';record('cold-boot-without-login',wait('greeter'));vm.login();record('desktop-after-cold-boot',wait('user_session'))
        result={'schema':1,'ok':True,'cases':records,'binarySha256':binary_hash,'unitSha256':unit_hash,'coldBootTested':args.cold_boot,'captureTested':False,'inputTested':False,'brokerConnected':False,'physicalMachinesTested':False,'productionTested':False,'readyForUnattended':False}
    finally:
        if claimed:
            try:
                if root(CLEANUP,request,35)['removed']:installed=False
            except Exception:
                # Si el fallo ocurre durante el apagado, recuperar solo la VM propia antes de retirar.
                command([sys.executable,str(directory/'vm-lifecycle.py'),'start'],'cleanup-owned-vm-start',120)
                assert root(CLEANUP,request,35)['removed'];installed=False
        if request:command(vm.SSH+['rm -rf -- '+shlex.quote(request['stage'])],'remove-owned-stage')
        if vm.context()['Class']=='greeter':vm.login()
        if result is not None:
            result['ownServiceRemoved']=not installed
            p=output/'report.json';p.write_text(json.dumps(result,indent=2));p.chmod(0o600)
    assert result and result['ok'] and result['ownServiceRemoved']
    print(json.dumps({'ok':True,'cases':len(records),'ownServiceRemoved':True,'captureTested':False,'readyForUnattended':False}),flush=True)
if __name__=='__main__':main()
