#!/usr/bin/env python3
"""Complemento root exclusivo de la VM; sin credenciales de usuario ni políticas X."""
import hashlib
import grp
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys

OPT=Path('/opt/absorconnect-seat-authority-lab')
RUN=Path('/run/absorconnect-seat-authority-lab')
BASE=Path('/opt/absorconnect-secure-lab')
STAGE=Path('/home/absorlab/AbsorConnectLab/authority-native-staging')
UNITS=['absorconnect-seat-authority-lab.socket','absorconnect-seat-authority-lab.service']
DROP=Path('/etc/systemd/system/absorconnect-secure-lab.service.d/absorconnect-authority-lab.conf')
WORKER_DROP=Path('/etc/systemd/system/absorconnect-ipc-worker-lab.service.d/absorconnect-authority-lab.conf')
SOCKET_DROP=Path('/etc/systemd/system/absorconnect-secure-lab.socket.d/absorconnect-authority-lab.conf')
PROFILE=BASE/'worker-profile.json'
ACCOUNT='absorconnect-worker-lab'
MARK=b'absorconnect-owned-authority-install-v1\n'


def call(*args):return subprocess.run(args,capture_output=True,check=True,timeout=20).stdout

def write(path,raw,mode):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode),'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    path.chmod(mode)

def root_regular(path,limit=65536):
    m=path.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and m.st_size<=limit
    return path.read_bytes()

def dropin(path,raw):
    if not path.parent.exists():path.parent.mkdir(mode=0o755)
    m=path.parent.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid==0 and not m.st_mode&0o022
    write(path,raw,0o644)

def clear_mailbox(uid,gid):
    path=Path('/run/absorconnect-ipc-worker-lab')
    if not path.exists():return
    m=path.lstat();assert stat.S_ISDIR(m.st_mode) and m.st_uid in (1000,uid) and m.st_mode&0o077==0
    for item in path.iterdir():
        m=item.lstat();assert item.name in ('command.json','command.next','reply.json','reply.next') and stat.S_ISREG(m.st_mode) and m.st_uid in (1000,uid) and m.st_nlink==1 and m.st_size<65536
        item.unlink()
    os.chown(path,uid,gid)

def remove():
    assert root_regular(OPT/'owned-installation')==MARK
    claim=json.loads(root_regular(OPT/'claim.json').decode());hashes=claim['installedHashes']
    for name,digest in hashes.items():
        p=OPT/name if name not in UNITS else Path('/etc/systemd/system')/name
        if p.exists():assert hashlib.sha256(root_regular(p,32*1024*1024)).hexdigest()==digest
    for path,raw in [(DROP,b'[Service]\nReadWritePaths=/run/absorconnect-seat-authority-lab/grant.json\n')]:
        if path.exists():assert root_regular(path)==raw
    for name,digest in claim.get('dropInHashes',{}).items():
        path=WORKER_DROP if name=='worker' else SOCKET_DROP
        if path.exists():assert hashlib.sha256(root_regular(path)).hexdigest()==digest
    if PROFILE.exists():assert hashlib.sha256(root_regular(PROFILE)).hexdigest()==claim['workerProfileHash']
    subprocess.run(['systemctl','stop','absorconnect-ipc-worker-lab.service','absorconnect-secure-lab.service','absorconnect-secure-lab.socket',UNITS[1],UNITS[0]],capture_output=True,timeout=25)
    for unit in UNITS:(Path('/etc/systemd/system')/unit).unlink(missing_ok=True)
    for path in [DROP,WORKER_DROP,SOCKET_DROP]:
        if path==DROP or str(path) in claim.get('ownedDropIns',[]):
            path.unlink(missing_ok=True)
            if path.parent.exists() and not any(path.parent.iterdir()):path.parent.rmdir()
    if claim.get('dedicated'):
        if PROFILE.exists():PROFILE.unlink()
        identity=claim.get('workerIdentity')
        if identity:
            account=pwd.getpwnam(ACCOUNT);assert (account.pw_uid,account.pw_gid)==(identity['uid'],identity['gid']) and account.pw_shell=='/usr/sbin/nologin'
            clear_mailbox(account.pw_uid,account.pw_gid)
            if Path('/run/absorconnect-ipc-worker-lab').exists():os.chown('/run/absorconnect-ipc-worker-lab',1000,1000)
            call('userdel',ACCOUNT)
            try:
                group=grp.getgrnam(ACCOUNT);assert group.gr_gid==identity['gid'] and not group.gr_mem
                call('groupdel',ACCOUNT)
            except KeyError:pass
            assert subprocess.run(['getent','passwd',ACCOUNT],capture_output=True).returncode==2
            assert subprocess.run(['getent','group',ACCOUNT],capture_output=True).returncode==2
    for name in hashes:
        if name not in UNITS:(OPT/name).unlink(missing_ok=True)
    for name in ['profile.json','owned-installation','claim.json']:(OPT/name).unlink(missing_ok=True)
    OPT.rmdir()
    for name in ['grant.json','authority.sock']:
        p=RUN/name
        if p.exists():
            m=p.lstat();assert m.st_uid==0 and (stat.S_ISREG(m.st_mode) if name=='grant.json' else stat.S_ISSOCK(m.st_mode));p.unlink()
    if RUN.exists():RUN.rmdir()
    call('systemctl','daemon-reload');subprocess.run(['systemctl','reset-failed',*UNITS],capture_output=True,timeout=10)
    print(json.dumps({'authorityServiceRemoved':True,'grantFileRemoved':True,'brokerDropInRemoved':True,'dedicatedWorkerRemoved':bool(claim.get('dedicated')),'lightdmModified':False}))

def install():
    assert not OPT.exists() and not RUN.exists() and not DROP.exists() and not WORKER_DROP.exists() and not SOCKET_DROP.exists() and not PROFILE.exists()
    for unit in UNITS:assert not (Path('/etc/systemd/system')/unit).exists()
    broker=pwd.getpwnam('absorconnect-lab');worker=pwd.getpwnam('absorlab')
    assert broker.pw_uid not in [0,worker.pw_uid] and broker.pw_gid>0 and worker.pw_uid==1000 and worker.pw_gid>0 and broker.pw_gid!=worker.pw_gid
    assert broker.pw_gid not in os.getgrouplist('absorlab',worker.pw_gid) and worker.pw_gid not in os.getgrouplist('absorconnect-lab',broker.pw_gid)
    data=sys.stdin.buffer.read(16385);assert len(data)<=16384;request=json.loads(data)
    assert set(request) in ({'hashes'},{'hashes','dedicated'}) and isinstance(request.get('dedicated',False),bool)
    dedicated=request.get('dedicated',False)
    names=['absor-seat-authority-lab',*UNITS]+(['capture-worker.py','linux-probe.py'] if dedicated else [])
    assert set(request['hashes'])==set(names)
    blobs={}
    for name in names:
        p=STAGE/name;m=p.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==1000 and m.st_nlink==1 and m.st_size<32*1024*1024
        raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==request['hashes'][name];blobs[name]=raw
    if dedicated:
        try:pwd.getpwnam(ACCOUNT);raise AssertionError('foreign_worker_account')
        except KeyError:pass
    OPT.mkdir(mode=0o755);write(OPT/'owned-installation',MARK,0o600)
    claim={'hashes':request['hashes'],'installedHashes':{},'dedicated':dedicated,'ownedDropIns':[],'dropInHashes':{}}
    def save():
        temporary=OPT/'claim.next';write(temporary,json.dumps(claim).encode(),0o600);temporary.replace(OPT/'claim.json')
    save()
    call('systemctl','stop','absorconnect-ipc-worker-lab.service','absorconnect-secure-lab.service','absorconnect-secure-lab.socket')
    if dedicated:
        call('useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',ACCOUNT)
        worker=pwd.getpwnam(ACCOUNT)
        assert worker.pw_uid not in (0,1000,broker.pw_uid) and worker.pw_gid not in (0,1000,broker.pw_gid)
        claim['workerIdentity']={'uid':worker.pw_uid,'gid':worker.pw_gid};save()
        raw=json.dumps({'v':1,'uid':worker.pw_uid,'gid':worker.pw_gid}).encode();write(PROFILE,raw,0o444);claim['workerProfileHash']=hashlib.sha256(raw).hexdigest();save()
        clear_mailbox(worker.pw_uid,worker.pw_gid)
        for key,path,raw in [('worker',WORKER_DROP,('[Service]\nUser='+ACCOUNT+'\nGroup='+ACCOUNT+'\nPrivateNetwork=yes\nBindReadOnlyPaths=/tmp/.X11-unix\n').encode()),('socket',SOCKET_DROP,('[Socket]\nSocketGroup='+ACCOUNT+'\n').encode())]:
            dropin(path,raw);claim['ownedDropIns'].append(str(path));claim['dropInHashes'][key]=hashlib.sha256(raw).hexdigest();save()
        assert blobs[UNITS[0]].count(b'SocketGroup=absorlab\n')==1
        blobs[UNITS[0]]=blobs[UNITS[0]].replace(b'SocketGroup=absorlab\n',('SocketGroup='+ACCOUNT+'\n').encode())
    write(OPT/'profile.json',json.dumps({'brokerUid':broker.pw_uid,'brokerGid':broker.pw_gid,'workerUid':worker.pw_uid,'workerGid':worker.pw_gid}).encode(),0o444)
    RUN.mkdir(mode=0o755);write(RUN/'grant.json',b'',0o660);os.chown(RUN/'grant.json',0,broker.pw_gid)
    for name,raw in blobs.items():
        write(OPT/name if name not in UNITS else Path('/etc/systemd/system')/name,raw,0o555 if name not in UNITS else 0o644)
        claim['installedHashes'][name]=hashlib.sha256(raw).hexdigest();save()
    dropin(DROP,b'[Service]\nReadWritePaths=/run/absorconnect-seat-authority-lab/grant.json\n')
    call('systemd-analyze','verify',*(str(Path('/etc/systemd/system')/u) for u in UNITS));call('systemctl','daemon-reload')
    call('systemctl','start',UNITS[0],'absorconnect-secure-lab.socket','absorconnect-ipc-worker-lab.service')
    print(json.dumps({'authorityInstalled':True,'grantRootOwned':True,'dedicatedWorker':dedicated,'workerUid':worker.pw_uid,'workerGid':worker.pw_gid,'installedArtifactHashes':claim['installedHashes'],'lightdmModified':False}))

def main():
    assert os.geteuid()==0 and sys.argv[1:] in [['install'],['remove']]
    marker=Path('/run/absorconnect-owned-vm-lab');m=marker.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and stat.S_IMODE(m.st_mode)==0o444 and marker.read_bytes()==b'absorconnect-native-window-fixture-v1\n'
    if sys.argv[1]=='install':install()
    else:remove()
if __name__=='__main__':main()
