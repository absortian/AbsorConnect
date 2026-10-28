#!/usr/bin/env python3
"""Sonda fija sin entrada/red: X11 únicamente desde el descriptor heredado como stdin."""
import ctypes
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import resource
import struct
import sys


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    assert len(sys.argv)==1 and os.getuid() not in (0,1000) and os.geteuid()==os.getuid()
    assert set(os.getgroups()) <= {os.getgid()}
    values=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    assert int(values['CapEff'],16)==0 and int(values['CapPrm'],16)==0 and int(values['CapBnd'],16)==0 and values['NoNewPrivs'].strip()=='1'
    interfaces={line.split(':',1)[0].strip() for line in Path('/proc/self/net/dev').read_text().splitlines() if ':' in line}
    assert interfaces=={'lo'}
    libc=ctypes.CDLL('libc.so.6');libc.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong];assert libc.prctl(4,0,0,0,0)==0
    fd=0;m=os.fstat(fd);assert m.st_uid==0 and m.st_size==24 and m.st_mode&0o7777==0o400
    flags=fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL
    assert fcntl.fcntl(fd,fcntl.F_GET_SEALS)&flags==flags
    raw=bytearray(os.pread(fd,24,0));assert raw[:4]==b'AXA1';display=struct.unpack('>I',raw[4:8])[0];assert display<=255
    denied=0
    for path in ['/etc/shadow','/run/lightdm/root/:'+str(display)]:
        try:f=os.open(path,os.O_RDONLY);os.close(f)
        except PermissionError:denied+=1
    assert denied==2
    secret=ctypes.create_string_buffer(bytes(raw[8:]),16)
    for i in range(len(raw)):raw[i]=0
    x11=ctypes.CDLL('libX11.so.6');x11.XSetAuthorization.argtypes=[ctypes.c_char_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_int];x11.XSetAuthorization.restype=None
    x11.XOpenDisplay.argtypes=[ctypes.c_char_p];x11.XOpenDisplay.restype=ctypes.c_void_p;x11.XCloseDisplay.argtypes=[ctypes.c_void_p]
    x11.XSetAuthorization(b'MIT-MAGIC-COOKIE-1',18,secret,16)
    try:connection=x11.XOpenDisplay((':'+str(display)).encode())
    finally:x11.XSetAuthorization(None,0,None,0);ctypes.memset(ctypes.addressof(secret),0,16)
    assert connection
    try:
        spec=importlib.util.spec_from_file_location('counted_capture',Path(__file__).with_name('linux-probe.py'));probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
        captured=probe.capture_region(x11,connection);assert captured['captureTested'] and captured['frames']>=2
    finally:x11.XCloseDisplay(connection)
    print(json.dumps({'captureTested':True,'frames':captured['frames'],'nonUniformFrames':captured['nonUniformFrames'],'dedicatedIdentity':True,'noCapabilities':True,'privateNetwork':True,'rootFilesDenied':True,'inputTested':False,'imagesStored':False,'readyForUnattended':False}))


if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'captureTested':False,'inputTested':False,'imagesStored':False,'readyForUnattended':False}));sys.exit(3)
