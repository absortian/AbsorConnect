#!/usr/bin/env python3
"""Solo VM: dos dispositivos virtuales propios con la misma tecla/botón; no usa entrada física."""
import importlib.util,json,os,subprocess,sys,time
from pathlib import Path
BASE=Path('/opt/absorconnect-input-release-lab')
spec=importlib.util.spec_from_file_location('owned_probe',BASE/'probe.py');probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
marker,x11,focus,pointer,down=probe.marker,probe.x11,probe.focus,probe.pointer,probe.down
ctypes,Attributes,PREFIX,NAME=probe.ctypes,probe.Attributes,probe.PREFIX,probe.NAME

def isolation_parent():
    marker();assert sys.argv[1:]==['parent']
    assert not any(p.read_text().strip().startswith(NAME) for p in Path('/sys/devices/virtual/input').glob('input*/name'))
    lib,display=x11();root=lib.XDefaultRootWindow(display);old=focus(lib,display)
    old_pointer=pointer(lib,display)
    window=lib.XCreateSimpleWindow(display,root,50,50,440,160,0,0,0x164e63);assert window>1
    lib.XStoreName(display,window,b'AbsorConnect owned virtual-keyboard diagnostic')
    lib.XMapRaised(display,window);lib.XSync(display,0)
    deadline=time.monotonic()+5
    while True:
        attributes=Attributes();assert lib.XGetWindowAttributes(display,window,ctypes.byref(attributes))!=0
        if attributes.map_state==2:break
        assert time.monotonic()<deadline,'own_window_not_viewable';time.sleep(.02)
    lib.XSetInputFocus(display,window,2,0);lib.XSync(display,0)
    lib.XWarpPointer(display,0,window,0,0,0,0,220,80);lib.XSync(display,0)
    key=lib.XKeysymToKeycode(display,0x61);assert key>0 and not down(lib,display,key) and not down(lib,display,key,'button')
    import fcntl
    def own_down(label,code):
        values=[p.parent for p in Path('/sys/devices/virtual/input').glob('input*/name') if p.read_text().strip()==label]
        assert len(values)==1
        events=list(values[0].glob('event*'));assert len(events)==1 and events[0].name[5:].isdigit()
        fd=os.open('/dev/input/'+events[0].name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
        try:
            bits=bytearray(36);fcntl.ioctl(fd,(2<<30)|(36<<16)|(ord('E')<<8)|0x18,bits,True)
            return bool(bits[code//8] & (1<<(code%8)))
        finally:os.close(fd)
    results=[]
    try:
        for kind in ['key','button']:
            units=[];code=30 if kind=='key' else 272
            try:
                for role,mode in [('local','kill-'+kind),('remote','watchdog-'+kind)]:
                    path=PREFIX/'window.json';path.write_text(json.dumps({'mode':mode,'window':window,'parentPid':os.getpid(),'parentNetNamespace':os.readlink('/proc/self/ns/net')}));path.chmod(0o400)
                    unit='absorconnect-input-release-lab-'+mode+'.service';units.append(unit)
                    command=['systemd-run','--unit='+unit,'--quiet','--property=Type=notify','--property=WatchdogSec=1s','--property=WatchdogSignal=SIGKILL','--property=NotifyAccess=main','--property=Restart=no','--property=TimeoutStartSec=6s','--property=TimeoutStopSec=2s','--property=KillMode=control-group','--property=NoNewPrivileges=yes','--property=CapabilityBoundingSet=','--property=PrivateNetwork=yes','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=BindReadOnlyPaths=/tmp/.X11-unix','--property=DevicePolicy=closed','--property=DeviceAllow=/dev/uinput rw','--property=RestrictAddressFamilies=AF_UNIX','--property=LimitCORE=0','--property=MemoryMax=96M','--property=TasksMax=12','/usr/bin/python3','-B','-I',str(PREFIX/'isolation.py'),'child',mode]
                    subprocess.run(command,capture_output=True,check=True,timeout=7)
                    end=time.monotonic()+2
                    while not own_down(NAME+mode,code):
                        assert time.monotonic()<end;time.sleep(.01)
                    assert focus(lib,display)==window and down(lib,display,key,kind)
                subprocess.run(['systemctl','kill','--kill-who=main','--signal=USR1',units[1]],capture_output=True,check=True,timeout=2)
                end=time.monotonic()+1
                while own_down(NAME+'watchdog-'+kind,code):
                    assert time.monotonic()<end;time.sleep(.01)
                time.sleep(.1)
                after_up=down(lib,display,key,kind)
                subprocess.run(['systemctl','kill','--kill-who=main','--signal=KILL',units[1]],capture_output=True,check=True,timeout=2)
                end=time.monotonic()+2
                while any(p.read_text().strip()==NAME+'watchdog-'+kind for p in Path('/sys/devices/virtual/input').glob('input*/name')):
                    assert time.monotonic()<end;time.sleep(.01)
                time.sleep(.1)
                local_kernel=own_down(NAME+'kill-'+kind,code);master=down(lib,display,key,kind)
                results.append({'case':kind,'otherOwnedDeviceStillDownInKernel':local_kernel,'masterStateAfterExplicitUp':after_up,'masterStateStillDown':master,'ownWindowFocusVerified':focus(lib,display)==window})
            finally:
                for unit in units:
                    subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=3);subprocess.run(['systemctl','reset-failed',unit],capture_output=True,timeout=3)
            end=time.monotonic()+2
            while down(lib,display,key,kind):
                assert time.monotonic()<end;time.sleep(.01)
        (PREFIX/'report.json').write_text(json.dumps({'schema':1,'ok':all(c['otherOwnedDeviceStillDownInKernel'] and c['masterStateStillDown'] and c['ownWindowFocusVerified'] for c in results),'cases':results,'imagesStored':False,'keyboardTextRead':False,'readyForUnattended':False}))
    finally:
        lib.XWarpPointer(display,0,root,0,0,0,0,old_pointer[0],old_pointer[1]);lib.XSync(display,0)
        if old:lib.XSetInputFocus(display,old,2,0)
        lib.XDestroyWindow(display,window);lib.XSync(display,0);lib.XCloseDisplay(display)


if __name__=='__main__':
    try:
        if sys.argv[1:]==['parent']:isolation_parent()
        elif len(sys.argv)==3 and sys.argv[1]=='child' and sys.argv[2] in ['kill-key','kill-button','watchdog-key','watchdog-button']:
            probe.child(sys.argv[2],allow_owned_overlap=sys.argv[2].startswith('watchdog-'))
        else:raise SystemExit(2)
    except Exception as error:
        import traceback
        print(json.dumps({'status':'owned_isolation_probe_failed','errorType':type(error).__name__,'stages':[{'function':f.name,'line':f.lineno} for f in traceback.extract_tb(error.__traceback__)[-3:]]}),flush=True)
        raise SystemExit(3)
