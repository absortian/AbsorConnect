#!/usr/bin/env python3
"""Complemento root exclusivo de la VM; sin credenciales nuevas, servicios físicos o políticas X."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys

OPT=Path('/opt/absorconnect-seat-authority-lab')
RUN=Path('/run/absorconnect-seat-authority-lab')
STAGE=Path('/home/absorlab/AbsorConnectLab/authority-native-staging')
UNITS=['absorconnect-seat-authority-lab.socket','absorconnect-seat-authority-lab.service']
DROP=Path('/etc/systemd/system/absorconnect-secure-lab.service.d/absorconnect-authority-lab.conf')
NAMES=['absor-seat-authority-lab',*UNITS]
MARK=b'absorconnect-owned-authority-install-v1\n'

def call(*args):return subprocess.run(args,capture_output=True,check=True,timeout=20).stdout

def write(path,raw,mode):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode),'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    path.chmod(mode)

def remove():
    m=(OPT/'owned-installation').lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and (OPT/'owned-installation').read_bytes()==MARK
    claim=json.loads((OPT/'claim.json').read_text())
    for name in NAMES:
        p=OPT/name if name=='absor-seat-authority-lab' else Path('/etc/systemd/system')/name
        if p.exists():
            m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and hashlib.sha256(p.read_bytes()).hexdigest()==claim['hashes'][name]
    if DROP.exists():assert DROP.read_text()=='[Service]\nReadWritePaths=/run/absorconnect-seat-authority-lab/grant.json\n'
    subprocess.run(['systemctl','stop','absorconnect-ipc-worker-lab.service','absorconnect-secure-lab.service',UNITS[1],UNITS[0]],capture_output=True,timeout=20)
    for unit in UNITS:(Path('/etc/systemd/system')/unit).unlink(missing_ok=True)
    DROP.unlink(missing_ok=True)
    if DROP.parent.exists() and not any(DROP.parent.iterdir()):DROP.parent.rmdir()
    for name in NAMES:
        if name=='absor-seat-authority-lab':(OPT/name).unlink(missing_ok=True)
    for name in ['profile.json','owned-installation','claim.json']:(OPT/name).unlink(missing_ok=True)
    OPT.rmdir()
    for name in ['grant.json','authority.sock']:
        p=RUN/name
        if p.exists():
            m=p.lstat();assert m.st_uid==0 and (stat.S_ISREG(m.st_mode) if name=='grant.json' else stat.S_ISSOCK(m.st_mode));p.unlink()
    if RUN.exists():RUN.rmdir()
    call('systemctl','daemon-reload')
    subprocess.run(['systemctl','reset-failed',*UNITS],capture_output=True,timeout=10)
    print(json.dumps({'authorityServiceRemoved':True,'grantFileRemoved':True,'brokerDropInRemoved':True,'lightdmModified':False}))

def install():
    assert not OPT.exists() and not RUN.exists() and not DROP.exists()
    for unit in UNITS:assert not (Path('/etc/systemd/system')/unit).exists()
    # Estas cuentas ya pertenecen al laboratorio de credenciales; aquí no se crean usuarios.
    broker=pwd.getpwnam('absorconnect-lab');worker=pwd.getpwnam('absorlab')
    assert broker.pw_uid not in [0,worker.pw_uid] and broker.pw_gid>0 and worker.pw_uid==1000 and worker.pw_gid>0 and broker.pw_gid!=worker.pw_gid
    assert broker.pw_gid not in os.getgrouplist('absorlab',worker.pw_gid) and worker.pw_gid not in os.getgrouplist('absorconnect-lab',broker.pw_gid)
    data=sys.stdin.buffer.read(16385);assert len(data)<=16384;request=json.loads(data);assert set(request)=={'hashes'} and set(request['hashes'])==set(NAMES)
    blobs={}
    for name in NAMES:
        p=STAGE/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<32*1024*1024
        raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==request['hashes'][name];blobs[name]=raw
    OPT.mkdir(mode=0o755);write(OPT/'owned-installation',MARK,0o600);write(OPT/'claim.json',json.dumps(request).encode(),0o600)
    write(OPT/'profile.json',json.dumps({'brokerUid':broker.pw_uid,'brokerGid':broker.pw_gid,'workerUid':worker.pw_uid,'workerGid':worker.pw_gid}).encode(),0o444)
    RUN.mkdir(mode=0o755);write(RUN/'grant.json',b'',0o660);os.chown(RUN/'grant.json',0,broker.pw_gid)
    for name,raw in blobs.items():write(OPT/name if name=='absor-seat-authority-lab' else Path('/etc/systemd/system')/name,raw,0o555 if name=='absor-seat-authority-lab' else 0o644)
    if not DROP.parent.exists():DROP.parent.mkdir(mode=0o755)
    else:
        m=DROP.parent.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid==0 and not m.st_mode&0o022
    write(DROP,b'[Service]\nReadWritePaths=/run/absorconnect-seat-authority-lab/grant.json\n',0o644)
    call('systemd-analyze','verify',*(str(Path('/etc/systemd/system')/u) for u in UNITS));call('systemctl','daemon-reload')
    call('systemctl','start',UNITS[0]);call('systemctl','restart','absorconnect-secure-lab.service')
    print(json.dumps({'authorityInstalled':True,'grantRootOwned':True,'lightdmModified':False}))

def main():
    assert os.geteuid()==0 and sys.argv[1:] in [['install'],['remove']]
    marker=Path('/run/absorconnect-owned-vm-lab');m=marker.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and stat.S_IMODE(m.st_mode)==0o444 and marker.read_bytes()==b'absorconnect-native-window-fixture-v1\n'
    if sys.argv[1]=='install':install()
    else:remove()
if __name__=='__main__':main()
