#!/usr/bin/env python3
"""Ejecuta captura contada por UID de servicio mediante memfd, solo en la VM propia."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import uuid
ROOT=Path(__file__).resolve().parents[2]
PREFIX='/opt/absorconnect-seat-authority-probe'
NAME='absorconnect-seat-probe'
MARKER='/run/absorconnect-owned-vm-seat-probe'
SETUP=r'''
import hashlib,json,os,pwd,stat,subprocess,sys,tarfile
from pathlib import Path
request=json.loads(sys.stdin.buffer.read(16385));prefix=Path('/opt/absorconnect-seat-authority-probe');marker=Path('/run/absorconnect-owned-vm-seat-probe')
assert not prefix.exists() and not marker.exists()
try:pwd.getpwnam('absorconnect-seat-probe');raise AssertionError('foreign_account')
except KeyError:pass
stage=Path(request['stage']);assert stage.parent==Path('/home/absorlab/AbsorConnectLab') and stage.name.startswith('authority-stage-') and not stage.is_symlink()
raw={}
for name,digest in request['hashes'].items():
 assert name in ['linux-xauthority-fd-probe.py','linux-xauthority-fd-worker.py','linux-session-check.py','linux-probe.py']
 p=stage/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<65536
 raw[name]=p.read_bytes();assert hashlib.sha256(raw[name]).hexdigest()==digest
assert len(raw)==4
prefix.mkdir(mode=0o755)
(prefix/'claim.json').write_text(json.dumps(request));(prefix/'claim.json').chmod(0o600)
for name,data in raw.items():
 p=prefix/name
 with p.open('xb') as file:file.write(data)
 p.chmod(0o555)
subprocess.run(['useradd','--system','--user-group','--no-create-home','--shell','/usr/sbin/nologin','absorconnect-seat-probe'],check=True,capture_output=True,timeout=10)
marker.write_bytes(b'absorconnect-seat-authority-probe-v1\n');marker.chmod(0o400)
print(json.dumps({'prepared':True}))
'''
REMOVE=r'''
import hashlib,json,pwd,stat,subprocess,sys
from pathlib import Path
request=json.loads(sys.stdin.buffer.read(16385));prefix=Path('/opt/absorconnect-seat-authority-probe');marker=Path('/run/absorconnect-owned-vm-seat-probe')
if not prefix.exists():print(json.dumps({'removed':True}));sys.exit()
saved=json.loads((prefix/'claim.json').read_text());assert saved['nonce']==request['nonce'] and saved['hashes']==request['hashes']
for name,digest in saved['hashes'].items():
 p=prefix/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and hashlib.sha256(p.read_bytes()).hexdigest()==digest
try:
 account=pwd.getpwnam('absorconnect-seat-probe');assert account.pw_uid>0 and account.pw_shell=='/usr/sbin/nologin'
 subprocess.run(['userdel','absorconnect-seat-probe'],check=True,capture_output=True,timeout=10)
except KeyError:pass
if marker.exists():
 m=marker.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and marker.read_bytes()==b'absorconnect-seat-authority-probe-v1\n';marker.unlink()
cache=prefix/'__pycache__'
if cache.exists():
 m=cache.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid==0
 allowed={Path(name).stem+'.'+sys.implementation.cache_tag+'.pyc' for name in saved['hashes']}
 for p in cache.iterdir():
  m=p.lstat();assert p.name in allowed and stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and m.st_size<131072;p.unlink()
 cache.rmdir()
for name in saved['hashes']:(prefix/name).unlink()
(prefix/'claim.json').unlink();prefix.rmdir()
assert subprocess.run(['getent','passwd','absorconnect-seat-probe'],capture_output=True).returncode==2
assert subprocess.run(['getent','group','absorconnect-seat-probe'],capture_output=True).returncode==2
print(json.dumps({'removed':True,'temporaryIdentityRemoved':True,'markerRemoved':True}))
'''
def main():
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('lab',type=Path);p.add_argument('vm',type=Path);args=p.parse_args()
 vm_dir=args.vm.resolve();m=vm_dir.stat();assert m.st_uid==os.getuid() and m.st_mode&0o077==0
 spec=importlib.util.spec_from_file_location('vm',vm_dir/'vm-control.py');vm=importlib.util.module_from_spec(spec);spec.loader.exec_module(vm)
 assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
 output=args.lab.resolve()/('linux-authority-fd-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
 files={name:(ROOT/'prototypes/remote-desktop/unattended-check'/name).read_bytes() for name in ['linux-xauthority-fd-probe.py','linux-xauthority-fd-worker.py','linux-session-check.py','linux-probe.py']}
 stage='/home/absorlab/AbsorConnectLab/authority-stage-'+uuid.uuid4().hex
 request={'nonce':uuid.uuid4().hex,'stage':stage,'hashes':{name:hashlib.sha256(value).hexdigest() for name,value in files.items()}}
 (output/'owned-install.json').write_text(json.dumps(request));(output/'owned-install.json').chmod(0o600)
 def root(code,data=None,timeout=30):
  r=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -I -c '+shlex.quote(code)],input=json.dumps(data).encode() if data else None,capture_output=True,timeout=timeout)
  if r.returncode:
   (output/'last-root-error.log').write_bytes(r.stdout+r.stderr);(output/'last-root-error.log').chmod(0o600);raise RuntimeError('root_step_failed_inspect_private_log')
  return json.loads(r.stdout)
 prepared=False;reports=[]
 try:
  assert vm.context()['Class']=='user'
  buf=io.BytesIO()
  with tarfile.open(fileobj=buf,mode='w') as tar:
   for name,raw in files.items():
    info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o600;tar.addfile(info,io.BytesIO(raw))
  r=subprocess.run(vm.SSH+['mkdir -m 700 '+shlex.quote(stage)+' && tar -xf - -C '+shlex.quote(stage)],input=buf.getvalue(),capture_output=True,timeout=10);r.check_returncode()
  prepared=True;assert root(SETUP,request)['prepared']
  def sample(name):
   r=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -B -I '+PREFIX+'/linux-xauthority-fd-probe.py'],capture_output=True,timeout=20)
   path=output/(name+'.json');path.write_bytes(r.stdout);path.chmod(0o600)
   if r.returncode:
    (output/(name+'-stderr.log')).write_bytes(r.stderr);raise RuntimeError('authority_probe_failed_inspect_private_report')
   v=json.loads(r.stdout);assert v['captureTested'] and v['withoutAuthorityDenied'] and v['sealedAuthorityFd'] and v['unprivilegedWorker'];reports.append({'case':name,**v});print(json.dumps({'case':name,'passed':True}),flush=True)
  sample('desktop')
  vm.logout();sample('greeter');vm.login();sample('returned-desktop')
 finally:
  if vm.context()['Class']=='greeter':vm.login()
  if prepared:assert root(REMOVE,request)['removed']
  subprocess.run(vm.SSH+['rm -rf -- '+shlex.quote(stage)],capture_output=True,check=True,timeout=10)
 result={'schema':1,'ok':True,'cases':reports,'sourceSha256':request['hashes'],'temporaryIdentityRemoved':True,'markerAndFilesRemoved':True,'serviceInstalled':False,'inputTested':False,'networkWebRtcTested':False,'physicalMachinesTested':False,'productionTested':False,'readyForUnattended':False}
 (output/'report.json').write_text(json.dumps(result,indent=2));(output/'report.json').chmod(0o600)
 print(json.dumps({'ok':True,'cases':len(reports),'temporaryIdentityRemoved':True,'readyForUnattended':False}),flush=True)
if __name__=='__main__':main()
