#!/usr/bin/env python3
"""Sonda local sin red IP ni privilegios: X11 solo mediante un descriptor sellado."""
import ctypes
import fcntl
import importlib.util
import json
import os
import resource
from pathlib import Path
import re
import struct
import sys


def main():
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    assert sys.argv[1:] in [[], ['--without-cookie']]
    expected=int(os.environ['ABSOR_PROBE_UID']);assert expected>0 and os.getuid()==expected and os.geteuid()==expected and not os.getgroups()
    status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    assert int(status['CapEff'],16)==0 and int(status['CapPrm'],16)==0 and int(status['CapBnd'],16)==0 and status['NoNewPrivs'].strip()=='1'
    libc=ctypes.CDLL('libc.so.6',use_errno=True);libc.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong];assert libc.prctl(4,0,0,0,0)==0
    interfaces={line.split(':',1)[0].strip() for line in Path('/proc/self/net/dev').read_text().splitlines() if ':' in line}
    assert interfaces=={'lo'}
    denied=0
    for name in ['/etc/shadow',os.environ['ABSOR_SOURCE_AUTHORITY']]:
        try:
            fd=os.open(name,os.O_RDONLY);os.close(fd)
        except PermissionError:denied+=1
    assert denied==2
    display=os.environ['DISPLAY'];assert re.fullmatch(r':(?:0|[1-9][0-9]{0,2})',display) and int(display[1:])<=255
    x11=ctypes.CDLL('libX11.so.6');x11.XSetAuthorization.argtypes=[ctypes.c_char_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_int];x11.XSetAuthorization.restype=None
    x11.XOpenDisplay.argtypes=[ctypes.c_char_p];x11.XOpenDisplay.restype=ctypes.c_void_p;x11.XCloseDisplay.argtypes=[ctypes.c_void_p]
    secret=None;sealed=False
    try:
        if '--without-cookie' not in sys.argv:
            fd=int(os.environ['ABSOR_AUTHORITY_FD']);assert fd>=3
            m=os.fstat(fd);assert m.st_uid==0 and m.st_size<128 and m.st_mode&0o077==0
            seals=fcntl.F_SEAL_SEAL|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_WRITE
            assert fcntl.fcntl(fd,fcntl.F_GET_SEALS)&seals==seals
            raw=bytearray(os.pread(fd,128,0));assert raw[:4]==b'AXA1' and len(raw)==24
            number=struct.unpack('>I',raw[4:8])[0];assert display==':'+str(number)
            secret=ctypes.create_string_buffer(bytes(raw[8:]),16)
            for i in range(len(raw)):raw[i]=0
            try:os.write(fd,b'x')
            except PermissionError:sealed=True
            assert sealed
            x11.XSetAuthorization(b'MIT-MAGIC-COOKIE-1',18,secret,16)
        connection=x11.XOpenDisplay(display.encode())
        x11.XSetAuthorization(None,0,None,0)
        if secret is not None:ctypes.memset(ctypes.addressof(secret),0,16)
        report={'schema':1,'unprivilegedWorker':True,'noCapabilities':True,'noSupplementaryGroups':True,'noNewPrivileges':True,'privateNetwork':True,'rootFilesDenied':True,'sealedAuthorityFd':sealed,'x11Connected':bool(connection),'captureTested':False,'inputTested':False,'readyForUnattended':False}
        if '--without-cookie' in sys.argv:
            assert not connection
        else:
            assert connection
            try:
                spec=importlib.util.spec_from_file_location('region_probe',Path(__file__).with_name('linux-probe.py'));probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
                capture=probe.capture_region(x11,connection);assert capture['captureTested'] and capture['frames']>=2
                report.update({key:capture[key] for key in ['captureTested','captureRegion','frames','nonUniformFrames']})
            finally:x11.XCloseDisplay(connection)
        print(json.dumps(report))
    finally:
        x11.XSetAuthorization(None,0,None,0)
        if secret is not None:ctypes.memset(ctypes.addressof(secret),0,16)
if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'schema':1,'status':'authority_fd_probe_failed','readyForUnattended':False}));sys.exit(3)
