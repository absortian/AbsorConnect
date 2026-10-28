#!/usr/bin/env python3
"""Solo VM propia: ciclo de vida de un teclado virtual y tecla fija, sin WebRTC."""
import argparse,hashlib,importlib.util,json,os,shlex,subprocess,sys,time,uuid
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('vm',type=Path);args=parser.parse_args()
os.umask(0o077)
root=Path(__file__).resolve().parents[2];lab=args.lab.resolve();directory=args.vm.resolve()
m=directory.stat();assert m.st_uid==os.getuid() and m.st_mode&0o077==0
spec=importlib.util.spec_from_file_location('own_vm',directory/'vm-control.py');vm=importlib.util.module_from_spec(spec);spec.loader.exec_module(vm)
assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
assert vm.context()['Class']=='user'
output=lab/('uinput-release-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
files={'probe.py':(root/'prototypes/remote-desktop/unattended-check/linux-uinput-release-probe.py').read_bytes(),'linux-xauthority-fd-probe.py':(root/'prototypes/remote-desktop/unattended-check/linux-xauthority-fd-probe.py').read_bytes()}
stage='/home/absorlab/AbsorConnectLab/uinput-stage-'+uuid.uuid4().hex
request={'nonce':uuid.uuid4().hex,'hashes':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()},'stage':stage}
(output/'owned.json').write_text(json.dumps(request));(output/'owned.json').chmod(0o600)
def run_root(source,data=None,timeout=30):
 p=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -I -c '+shlex.quote(source)],input=json.dumps(data).encode() if data else None,capture_output=True,timeout=timeout)
 if p.returncode:
  path=output/'root-error.log';path.write_bytes(p.stderr);path.chmod(0o600);raise RuntimeError('inspect_private_root_error')
 return p.stdout
setup="""import hashlib,json,os,stat,sys
from pathlib import Path
r=json.load(sys.stdin);prefix=Path('/opt/absorconnect-input-release-lab');marker=Path('/run/absorconnect-owned-vm-input-release-probe');assert not prefix.exists() and not marker.exists()
stage=Path(r['stage']);assert stage.parent==Path('/home/absorlab/AbsorConnectLab') and stage.name.startswith('uinput-stage-')
raw={}
for name,digest in r['hashes'].items():
 assert name in ['probe.py','linux-xauthority-fd-probe.py'];p=stage/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<32768
 raw[name]=p.read_bytes();assert hashlib.sha256(raw[name]).hexdigest()==digest
assert len(raw)==2
prefix.mkdir(mode=0o755);(prefix/'claim.json').write_text(json.dumps(r));(prefix/'claim.json').chmod(0o600)
for name,data in raw.items():
 with (prefix/name).open('xb') as f:f.write(data)
 (prefix/name).chmod(0o555)
marker.write_bytes(b'absorconnect-owned-input-release-v1\\n');marker.chmod(0o400)
print(json.dumps({'prepared':True}))
"""
cleanup="""import hashlib,json,stat,subprocess,sys
from pathlib import Path
r=json.load(sys.stdin);prefix=Path('/opt/absorconnect-input-release-lab');marker=Path('/run/absorconnect-owned-vm-input-release-probe')
if not prefix.exists():print(json.dumps({'removed':True}));raise SystemExit()
saved=json.loads((prefix/'claim.json').read_text());assert saved['nonce']==r['nonce'] and saved['hashes']==r['hashes']
for mode in [action+'-'+kind for action in ['normal','kill','watchdog'] for kind in ['key','button']]:
 unit='absorconnect-input-release-lab-'+mode+'.service';subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=4);subprocess.run(['systemctl','reset-failed',unit],capture_output=True,timeout=4)
assert not any(p.read_text().strip().startswith('AbsorConnectLabRelease-') for p in Path('/sys/devices/virtual/input').glob('input*/name'))
for name,digest in saved['hashes'].items():
 p=prefix/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and hashlib.sha256(p.read_bytes()).hexdigest()==digest;p.unlink()
for name in ['window.json','report.json','claim.json','observer-report.json','observer-report.next','observer-stop','observer-change-focus','device-adopted']:
 p=prefix/name
 if p.exists():
  m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_size<65536;p.unlink()
prefix.rmdir();m=marker.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and marker.read_bytes()==b'absorconnect-owned-input-release-v1\\n';marker.unlink()
print(json.dumps({'removed':True,'ownedDevicesRemoved':True}))
"""
prepared=False;result=None
try:
 vm.remote('mkdir -m 700 '+stage)
 for name,data in files.items():vm.remote('cat > '+stage+'/'+name,data)
 prepared=True;run_root(setup,request)
 p=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -B -I /opt/absorconnect-input-release-lab/probe.py parent'],capture_output=True,timeout=65)
 f=output/'probe.log';f.write_bytes(p.stdout+p.stderr);f.chmod(0o600)
 journal=run_root("import subprocess;print(subprocess.run(['journalctl','--no-pager','-n','90','-u','absorconnect-input-release-lab-normal.service','-u','absorconnect-input-release-lab-kill.service','-u','absorconnect-input-release-lab-watchdog.service'],capture_output=True,text=True).stdout)")
 f=output/'journal.log';f.write_bytes(journal);f.chmod(0o600)
 assert p.returncode==0,'probe_failed_inspect_private_log'
 result=json.loads(run_root("from pathlib import Path;print(Path('/opt/absorconnect-input-release-lab/report.json').read_text())"))
finally:
 if prepared:removed=json.loads(run_root(cleanup,request));assert removed['removed']
 vm.remote('rm -rf -- '+shlex.quote(stage))
 if result:
  result.update({'ownedFilesAndDevicesRemoved':True,'sourceSha256':request['hashes'],'productionTested':False,'physicalMachinesTested':False})
  f=output/'report.json';f.write_text(json.dumps(result,indent=2));f.chmod(0o600)
print(json.dumps({'ok':True,'cases':len(result['cases']),'ownedFilesAndDevicesRemoved':True,'report':str(output/'report.json')}))
