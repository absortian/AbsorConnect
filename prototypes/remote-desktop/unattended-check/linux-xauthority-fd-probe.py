#!/usr/bin/env python3
"""Solo VM propia: entrega autoridad X11 acotada por memfd a una identidad sin login."""
import fcntl
import importlib.util
import json
import os
import resource
from pathlib import Path
import pwd
import stat
import struct
import subprocess
import sys

MARKER=Path('/run/absorconnect-owned-vm-seat-probe')
NAME='absorconnect-seat-probe'

def check_marker():
    m=MARKER.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and stat.S_IMODE(m.st_mode)==0o400 and MARKER.read_bytes()==b'absorconnect-seat-authority-probe-v1\n'

def authority_record(raw,number):
    assert len(raw)<=65536;offset=0;matches=[]
    def field():
        nonlocal offset
        assert offset+2<=len(raw);length=int.from_bytes(raw[offset:offset+2],'big');offset+=2
        assert offset+length<=len(raw);value=raw[offset:offset+length];offset+=length;return value
    while offset<len(raw):
        assert offset+2<=len(raw);family=int.from_bytes(raw[offset:offset+2],'big');offset+=2
        address=field();display=field();name=field();secret=field()
        if family in [256,65535] and display==str(number).encode() and name==b'MIT-MAGIC-COOKIE-1' and len(secret)==16:matches.append(secret)
    assert len(matches)==1
    return matches[0]

def server_identity(display,authority):
    socket=Path('/tmp/.X11-unix')/('X'+display[1:]);m=socket.lstat();assert stat.S_ISSOCK(m.st_mode) and m.st_uid==0
    found=[]
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():continue
        try:
            values=dict(line.split(':',1) for line in (proc/'status').read_text().splitlines() if ':' in line)
            if [int(v) for v in values['Uid'].split()]!=[0,0,0,0] or (proc/'comm').read_text().strip()!='Xorg':continue
            executable=(proc/'exe').resolve();metadata=executable.stat()
            if str(executable)!='/usr/lib/xorg/Xorg' or not stat.S_ISREG(metadata.st_mode) or metadata.st_uid!=0 or metadata.st_mode&0o022:continue
            raw=(proc/'cmdline').read_bytes();assert len(raw)<=16384
            args=raw.rstrip(b'\0').split(b'\0')
            if display.encode() not in args or b'-auth' not in args or Path(os.fsdecode(args[args.index(b'-auth')+1]))!=authority:continue
            tail=(proc/'stat').read_text().rsplit(')',1)[1].split();start=int(tail[19]);found.append((int(proc.name),start))
        except (OSError,KeyError,ValueError,IndexError):continue
    assert len(found)==1
    return found[0]

def main():
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    assert os.geteuid()==0 and sys.argv[1:]==[];check_marker()
    account=pwd.getpwnam(NAME);assert account.pw_uid>0 and account.pw_shell=='/usr/sbin/nologin'
    spec=importlib.util.spec_from_file_location('session_probe',Path(__file__).with_name('linux-session-check.py'));session=importlib.util.module_from_spec(spec);spec.loader.exec_module(session)
    expected=session.context();assert int(expected[1]['User'])!=account.pw_uid
    display=expected[1]['Display'];number=int(display[1:]);assert display==':'+str(number) and 0<=number<=255
    authority=session.authority_for(display);server=server_identity(display,authority);fd=os.open(authority,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
    try:
        m=os.fstat(fd);assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_mode&0o077==0 and m.st_nlink==1 and m.st_size<=65536
        cookie=authority_record(os.read(fd,65537),number)
    finally:os.close(fd)
    sealed=os.memfd_create('absorconnect-x11-authority',os.MFD_CLOEXEC|os.MFD_ALLOW_SEALING)
    try:
        payload=bytearray(b'AXA1'+struct.pack('>I',number)+cookie);assert len(payload)==24
        os.write(sealed,payload);os.fchmod(sealed,0o400)
        for i in range(len(payload)):payload[i]=0
        fcntl.fcntl(sealed,fcntl.F_ADD_SEALS,fcntl.F_SEAL_SEAL|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_WRITE)
        env={'PATH':'/usr/bin:/bin','LC_ALL':'C','HOME':'/nonexistent','DISPLAY':display,'ABSOR_PROBE_UID':str(account.pw_uid),'ABSOR_SOURCE_AUTHORITY':str(authority)}
        worker=Path(__file__).with_name('linux-xauthority-fd-worker.py')
        command=['/usr/bin/unshare','--net','--','/usr/bin/setpriv','--reuid',str(account.pw_uid),'--regid',str(account.pw_gid),'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/python3','-B','-I',str(worker)]
        denied=subprocess.run(command+['--without-cookie'],env=env,capture_output=True,timeout=10);assert denied.returncode==0;assert not json.loads(denied.stdout)['x11Connected']
        env['ABSOR_AUTHORITY_FD']=str(sealed)
        tested=subprocess.run(command,env=env,pass_fds=[sealed],capture_output=True,timeout=10)
        assert tested.returncode==0,'unprivileged_fd_worker_failed'
        report=json.loads(tested.stdout);assert report['x11Connected'] and report['captureTested'] and report['sealedAuthorityFd']
        assert session.context()==expected,'session_changed_during_probe'
        assert server_identity(display,authority)==server,'xorg_identity_changed'
        report.update({'sourceClass':expected[1]['Class'],'withoutAuthorityDenied':True,'authorityCopiedToDisk':False,'cookieBytesInArgumentsOrEnvironment':False,'serverIdentityStable':True,'status':'unprivileged_fd_capture_ok_not_certified'})
        print(json.dumps(report))
    finally:os.close(sealed)
if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'schema':1,'status':'authority_fd_parent_failed','reason':str(error) if isinstance(error,AssertionError) else type(error).__name__,'captureTested':False,'inputTested':False,'readyForUnattended':False}));sys.exit(3)
