#!/usr/bin/env python3
"""Solo VM propia: tecla fija en ventana propia y retirada del dispositivo al morir."""
import ctypes
import json
import os
from pathlib import Path
import resource
import signal
import socket
import stat
import subprocess
import sys
import time

PREFIX=Path('/opt/absorconnect-input-release-lab')
MARKER=Path('/run/absorconnect-owned-vm-input-release-probe')
MODES=[mode+'-'+kind for mode in ['normal','kill','watchdog'] for kind in ['key','button']]
NAME='AbsorConnectLabRelease-'

class Attributes(ctypes.Structure):
    _fields_=[(name,kind) for name,kind in [
        ('x',ctypes.c_int),('y',ctypes.c_int),('width',ctypes.c_int),('height',ctypes.c_int),
        ('border_width',ctypes.c_int),('depth',ctypes.c_int),('visual',ctypes.c_void_p),
        ('root',ctypes.c_ulong),('klass',ctypes.c_int),('bit_gravity',ctypes.c_int),
        ('win_gravity',ctypes.c_int),('backing_store',ctypes.c_int),('backing_planes',ctypes.c_ulong),
        ('backing_pixel',ctypes.c_ulong),('save_under',ctypes.c_int),('colormap',ctypes.c_ulong),
        ('map_installed',ctypes.c_int),('map_state',ctypes.c_int),('all_event_masks',ctypes.c_long),
        ('your_event_mask',ctypes.c_long),('do_not_propagate_mask',ctypes.c_long),
        ('override_redirect',ctypes.c_int),('screen',ctypes.c_void_p)]]


def marker():
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    assert os.geteuid()==0
    m=MARKER.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_mode&0o7777==0o400 and MARKER.read_bytes()==b'absorconnect-owned-input-release-v1\n'


def x11():
    # Autoridad fija de la VM LightDM; no se imprime ni se coloca en entorno/argumentos.
    path=Path('/run/lightdm/root/:0');m=path.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_mode&0o7777==0o600 and m.st_size<=65536
    import importlib.util
    spec=importlib.util.spec_from_file_location('authority_format',PREFIX/'linux-xauthority-fd-probe.py');parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
    raw=bytearray(path.read_bytes());secret=ctypes.create_string_buffer(bytes(parser.authority_record(raw,0)),16)
    for i in range(len(raw)):raw[i]=0
    lib=ctypes.CDLL('libX11.so.6');ptr=ctypes.c_void_p;u=ctypes.c_ulong;i=ctypes.c_int
    lib.XSetAuthorization.argtypes=[ctypes.c_char_p,i,ptr,i];lib.XSetAuthorization.restype=None
    lib.XOpenDisplay.argtypes=[ctypes.c_char_p];lib.XOpenDisplay.restype=ptr
    lib.XCloseDisplay.argtypes=[ptr];lib.XDefaultRootWindow.argtypes=[ptr];lib.XDefaultRootWindow.restype=u
    lib.XCreateSimpleWindow.argtypes=[ptr,u,i,i,ctypes.c_uint,ctypes.c_uint,ctypes.c_uint,u,u];lib.XCreateSimpleWindow.restype=u
    lib.XGetWindowAttributes.argtypes=[ptr,u,ctypes.POINTER(Attributes)];lib.XGetWindowAttributes.restype=i
    lib.XStoreName.argtypes=[ptr,u,ctypes.c_char_p];lib.XMapRaised.argtypes=[ptr,u];lib.XDestroyWindow.argtypes=[ptr,u]
    lib.XSetInputFocus.argtypes=[ptr,u,i,u];lib.XGetInputFocus.argtypes=[ptr,ctypes.POINTER(u),ctypes.POINTER(i)]
    lib.XKeysymToKeycode.argtypes=[ptr,u];lib.XKeysymToKeycode.restype=ctypes.c_ubyte
    lib.XQueryKeymap.argtypes=[ptr,ctypes.c_char_p];lib.XSync.argtypes=[ptr,i]
    lib.XWarpPointer.argtypes=[ptr,u,u,i,i,ctypes.c_uint,ctypes.c_uint,i,i]
    lib.XQueryPointer.argtypes=[ptr,u,ctypes.POINTER(u),ctypes.POINTER(u),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(i),ctypes.POINTER(ctypes.c_uint)]
    lib.XSetAuthorization(b'MIT-MAGIC-COOKIE-1',18,secret,16)
    try:display=lib.XOpenDisplay(b':0')
    finally:lib.XSetAuthorization(None,0,None,0);ctypes.memset(ctypes.addressof(secret),0,16)
    assert display
    return lib,display


def focus(lib,display):
    window=ctypes.c_ulong();revert=ctypes.c_int();lib.XGetInputFocus(display,ctypes.byref(window),ctypes.byref(revert));return window.value


def pointer(lib,display):
    root=ctypes.c_ulong();child=ctypes.c_ulong();rx=ctypes.c_int();ry=ctypes.c_int();wx=ctypes.c_int();wy=ctypes.c_int();mask=ctypes.c_uint()
    assert lib.XQueryPointer(display,lib.XDefaultRootWindow(display),ctypes.byref(root),ctypes.byref(child),ctypes.byref(rx),ctypes.byref(ry),ctypes.byref(wx),ctypes.byref(wy),ctypes.byref(mask))!=0
    return rx.value,ry.value,mask.value


def down(lib,display,code,kind='key'):
    if kind=='button':return bool(pointer(lib,display)[2] & (1<<8))
    keys=ctypes.create_string_buffer(32);lib.XQueryKeymap(display,keys)
    return bool(keys.raw[code//8] & (1<<(code%8)))


def notify(message):
    address=os.environ['NOTIFY_SOCKET'];address='\0'+address[1:] if address.startswith('@') else address
    s=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM);s.settimeout(.1)
    try:s.sendto(message,address)
    finally:s.close()



def adopted_by_xorg(display,label):
    class InputDevice(ctypes.Structure):
        _fields_=[('id',ctypes.c_ulong),('type',ctypes.c_ulong),('name',ctypes.c_char_p),('num_classes',ctypes.c_int),('use',ctypes.c_int),('inputclassinfo',ctypes.c_void_p)]
    xi=ctypes.CDLL('libXi.so.6');xi.XListInputDevices.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_int)];xi.XListInputDevices.restype=ctypes.POINTER(InputDevice)
    xi.XFreeDeviceList.argtypes=[ctypes.POINTER(InputDevice)]
    count=ctypes.c_int();devices=xi.XListInputDevices(display,ctypes.byref(count));assert devices and 0<count.value<256
    try:return any(devices[n].name==label.encode() for n in range(count.value))
    finally:xi.XFreeDeviceList(devices)

def child(mode, allow_owned_overlap=False):
    marker();assert mode in MODES
    kind=mode.rsplit('-',1)[1]
    config=json.loads((PREFIX/'window.json').read_text());assert config['mode']==mode and config['window']>1
    assert Path('/proc/'+str(config['parentPid'])).is_dir()
    values=dict(l.split(':',1) for l in Path('/proc/self/status').read_text().splitlines() if ':' in l)
    assert values['NoNewPrivs'].strip()=='1' and int(values['CapEff'],16)==0 and int(values['CapBnd'],16)==0
    assert os.readlink('/proc/self/ns/net')!=config['parentNetNamespace']
    lib,display=x11();assert focus(lib,display)==config['window']
    ev=ctypes.CDLL('libevdev.so.2');p=ctypes.c_void_p;ui=ctypes.c_uint;ii=ctypes.c_int
    ev.libevdev_new.restype=p;ev.libevdev_set_name.argtypes=[p,ctypes.c_char_p]
    ev.libevdev_enable_event_type.argtypes=[p,ui];ev.libevdev_enable_event_code.argtypes=[p,ui,ui,p]
    ev.libevdev_uinput_create_from_device.argtypes=[p,ii,ctypes.POINTER(p)]
    ev.libevdev_uinput_write_event.argtypes=[p,ui,ui,ii]
    ev.libevdev_free.argtypes=[p]
    device=ev.libevdev_new();assert device
    label=NAME+mode;ev.libevdev_set_name(device,label.encode())
    assert ev.libevdev_enable_event_type(device,1)==0
    # Capacidades mínimas de clasificación como teclado; se emite únicamente KEY_A.
    for code in [28,30,42,44,57,272]:assert ev.libevdev_enable_event_code(device,1,code,None)==0
    assert ev.libevdev_enable_event_type(device,2)==0
    for code in [0,1]:assert ev.libevdev_enable_event_code(device,2,code,None)==0
    fd=os.open('/dev/uinput',os.O_RDWR|os.O_NONBLOCK|os.O_CLOEXEC);virtual=p()
    assert ev.libevdev_uinput_create_from_device(device,fd,ctypes.byref(virtual))==0
    end=time.monotonic()+4
    class InputDevice(ctypes.Structure):
        _fields_=[('id',ctypes.c_ulong),('type',ctypes.c_ulong),('name',ctypes.c_char_p),('num_classes',ctypes.c_int),('use',ctypes.c_int),('inputclassinfo',ctypes.c_void_p)]
    xi=ctypes.CDLL('libXi.so.6');xi.XListInputDevices.argtypes=[p,ctypes.POINTER(ii)];xi.XListInputDevices.restype=ctypes.POINTER(InputDevice)
    xi.XFreeDeviceList.argtypes=[ctypes.POINTER(InputDevice)]
    while True:
        count=ii();devices=xi.XListInputDevices(display,ctypes.byref(count));assert devices and 0<count.value<256
        try:adopted=any(devices[n].name==label.encode() for n in range(count.value))
        finally:xi.XFreeDeviceList(devices)
        if adopted:break
        assert time.monotonic()<end,'device_not_adopted_by_xorg';time.sleep(.05)
    assert focus(lib,display)==config['window']
    key=lib.XKeysymToKeycode(display,0x61);assert key>0 and (allow_owned_overlap or not down(lib,display,key,kind))
    notify(b'READY=1')
    assert ev.libevdev_uinput_write_event(virtual,1,30 if kind=='key' else 272,1)==0
    assert ev.libevdev_uinput_write_event(virtual,0,0,0)==0
    if mode.startswith('normal-'):
        time.sleep(.25)
        # Sin keyup ni UI_DEV_DESTROY: el cierre del fd es lo que se evalúa.
        os.close(fd);ev.libevdev_free(device);lib.XCloseDisplay(display);return
    if allow_owned_overlap:
        # Solo el diagnóstico de dos dispositivos propios; no se habilita en el modo normal.
        def release_fixed(_signal,_frame):
            assert ev.libevdev_uinput_write_event(virtual,1,30 if kind=='key' else 272,0)==0
            assert ev.libevdev_uinput_write_event(virtual,0,0,0)==0
        signal.signal(signal.SIGUSR1,release_fixed)
    end=time.monotonic()+8
    while time.monotonic()<end:
        notify(b'WATCHDOG=1');time.sleep(.1)
    raise AssertionError('parent_did_not_finish_owned_test')


def parent():
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
    results=[]
    try:
        for mode in MODES:
            kind=mode.rsplit('-',1)[1]
            unit='absorconnect-input-release-lab-'+mode+'.service'
            assert focus(lib,display)==window and not down(lib,display,key,kind)
            path=PREFIX/'window.json';path.write_text(json.dumps({'mode':mode,'window':window,'parentPid':os.getpid(),'parentNetNamespace':os.readlink('/proc/self/ns/net')}));path.chmod(0o400)
            command=['systemd-run','--unit='+unit,'--quiet','--property=Type=notify','--property=WatchdogSec=1s','--property=WatchdogSignal=SIGKILL','--property=NotifyAccess=main','--property=Restart=no','--property=TimeoutStartSec=6s','--property=TimeoutStopSec=2s','--property=KillMode=control-group','--property=NoNewPrivileges=yes','--property=CapabilityBoundingSet=','--property=PrivateNetwork=yes','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=BindReadOnlyPaths=/tmp/.X11-unix','--property=DevicePolicy=closed','--property=DeviceAllow=/dev/uinput rw','--property=RestrictAddressFamilies=AF_UNIX','--property=LimitCORE=0','--property=MemoryMax=96M','--property=TasksMax=12','/usr/bin/python3','-B','-I',str(PREFIX/'probe.py'),'child',mode]
            process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            started=time.monotonic();end=started+7;pressed=False
            try:
                while time.monotonic()<end:
                    assert focus(lib,display)==window,'own_window_lost_focus'
                    if down(lib,display,key,kind):pressed=True;break
                    if process.poll() is not None and process.returncode!=0:raise RuntimeError('owned_input_unit_failed')
                    time.sleep(.01)
                assert pressed,'fixed_keydown_not_observed'
                fault=time.monotonic()
                if mode.startswith(('kill-','watchdog-')):
                    subprocess.run(['systemctl','kill','--kill-who=main','--signal='+('KILL' if mode.startswith('kill-') else 'STOP'),unit],check=True,capture_output=True,timeout=2)
                end=time.monotonic()+3
                while down(lib,display,key,kind):
                    assert focus(lib,display)==window,'own_window_lost_focus'
                    assert time.monotonic()<end,'fixed_key_still_pressed'
                    time.sleep(.01)
                elapsed=round((time.monotonic()-fault)*1000)
                subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=4)
                end=time.monotonic()+2
                while any(p.read_text().strip()==NAME+mode for p in Path('/sys/devices/virtual/input').glob('input*/name')):
                    assert time.monotonic()<end,'owned_device_not_removed';time.sleep(.02)
                results.append({'case':mode,'fixedInputDownObserved':True,'fixedInputKind':kind,'releaseObserved':True,'releaseMilliseconds':elapsed,'deviceRemoved':True,'ownWindowFocusVerified':True,'explicitInputUpSent':False})
                print(json.dumps({'case':mode,'passed':True}),flush=True)
            finally:
                subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=4)
                subprocess.run(['systemctl','reset-failed',unit],capture_output=True,timeout=4)
                try:process.communicate(timeout=2)
                except subprocess.TimeoutExpired:process.kill();process.communicate(timeout=2)
        (PREFIX/'report.json').write_text(json.dumps({'schema':1,'ok':True,'cases':results,'fixedInputsOnly':['KeyA','LeftButton'],'keyboardTextRead':False,'imagesCapturedOrStored':False,'networkProtocolTested':False,'readyForUnattended':False},indent=2))
        (PREFIX/'report.json').chmod(0o600)
    finally:
        # Eliminar el dispositivo, no liberar teclas de otros teclados mediante XTest.
        retained_key=down(lib,display,key);retained_button=down(lib,display,key,'button');retained=retained_key or retained_button
        if retained:
            # Rescate exclusivo de la tecla fija del ensayo; este resultado nunca cuenta como pase.
            xtst=ctypes.CDLL('libXtst.so.6');xtst.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
            if retained_key:xtst.XTestFakeKeyEvent(display,key,0,0)
            if retained_button:
                xtst.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong];xtst.XTestFakeButtonEvent(display,1,0,0)
            lib.XSync(display,0)
        lib.XWarpPointer(display,0,root,0,0,0,0,old_pointer[0],old_pointer[1]);lib.XSync(display,0)
        if old:lib.XSetInputFocus(display,old,2,0)
        lib.XDestroyWindow(display,window);lib.XSync(display,0);lib.XCloseDisplay(display)
        assert not retained,'owned_virtual_key_required_emergency_restore'



LEASE_MODES=['lease-normal-key','lease-normal-button','lease-hold-key','lease-hold-button']


def lease_target():
    marker();path=PREFIX/'window.json';m=path.lstat()
    assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and m.st_mode&0o7777==0o400 and m.st_size<=512
    value=json.loads(path.read_bytes());assert set(value)=={'mode','window','parentPid','parentNetNamespace'} and value['mode'] in LEASE_MODES and value['window']>1 and value['parentPid']>1
    assert Path('/proc/'+str(value['parentPid'])).is_dir()
    return value


def check_focus():
    value=lease_target();lib,display=x11()
    try:assert focus(lib,display)==value['window']
    finally:lib.XCloseDisplay(display)


def lease_observer(mode):
    marker();assert mode in LEASE_MODES
    lib,display=x11();root=lib.XDefaultRootWindow(display);old=focus(lib,display);old_pointer=pointer(lib,display)
    window=lib.XCreateSimpleWindow(display,root,50,50,440,160,0,0,0x164e63);assert window>1
    lib.XStoreName(display,window,b'AbsorConnect owned input-lease observer');lib.XMapRaised(display,window);lib.XSync(display,0)
    deadline=time.monotonic()+5
    while True:
        attributes=Attributes();assert lib.XGetWindowAttributes(display,window,ctypes.byref(attributes))!=0
        if attributes.map_state==2:break
        assert time.monotonic()<deadline;time.sleep(.02)
    lib.XSetInputFocus(display,window,2,0);lib.XWarpPointer(display,0,window,0,0,0,0,220,80);lib.XSync(display,0)
    key=lib.XKeysymToKeycode(display,0x61);kind=mode.rsplit('-',1)[1]
    assert key>0 and not down(lib,display,key) and not down(lib,display,key,'button')
    path=PREFIX/'window.json';path.write_text(json.dumps({'mode':mode,'window':window,'parentPid':os.getpid(),'parentNetNamespace':os.readlink('/proc/self/ns/net')}));path.chmod(0o400)
    state={'observerReady':True,'downObserved':False,'releaseObserved':False,'heldAtEnd':False,'keyboardTextRead':False,'imagesStored':False,'readyForUnattended':False}
    end=time.monotonic()+35;secondary=None
    try:
        while time.monotonic()<end:
            adopted=PREFIX/'device-adopted'
            if not adopted.exists() and adopted_by_xorg(display,'AbsorConnectLabLease'):
                adopted.write_bytes(b'owned-uinput-adopted-v1\n');adopted.chmod(0o400)
            change=PREFIX/'observer-change-focus'
            if secondary is None and change.exists():
                m=change.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and change.read_bytes()==b'change-owned-focus-v1\n'
                secondary=lib.XCreateSimpleWindow(display,root,70,70,300,100,0,0,0x164e63);assert secondary>1
                lib.XMapRaised(display,secondary);lib.XSync(display,0)
                deadline=time.monotonic()+2
                while True:
                    attributes=Attributes();assert lib.XGetWindowAttributes(display,secondary,ctypes.byref(attributes))!=0
                    if attributes.map_state==2:break
                    assert time.monotonic()<deadline;time.sleep(.01)
                lib.XSetInputFocus(display,secondary,2,0);lib.XSync(display,0)
            held=down(lib,display,key,kind)
            if held:state['downObserved']=True
            if state['downObserved'] and not held:state['releaseObserved']=True
            state['heldAtEnd']=held
            temporary=PREFIX/'observer-report.next';temporary.write_text(json.dumps(state));temporary.chmod(0o600);os.replace(temporary,PREFIX/'observer-report.json')
            stop=PREFIX/'observer-stop'
            if stop.exists():
                m=stop.lstat();assert stat.S_ISREG(m.st_mode) and m.st_uid==0 and m.st_nlink==1 and stop.read_bytes()==b'stop-owned-observer-v1\n';break
            time.sleep(.01)
    finally:
        lib.XWarpPointer(display,0,root,0,0,0,0,old_pointer[0],old_pointer[1]);lib.XSync(display,0)
        if old:lib.XSetInputFocus(display,old,2,0)
        if secondary is not None:lib.XDestroyWindow(display,secondary)
        lib.XDestroyWindow(display,window);lib.XSync(display,0);lib.XCloseDisplay(display)


if __name__=='__main__':
    try:
        if sys.argv[1:]==['parent']:parent()
        elif sys.argv[1:]==['check-focus']:check_focus()
        elif len(sys.argv)==3 and sys.argv[1]=='lease-observer':lease_observer(sys.argv[2])
        elif len(sys.argv)==3 and sys.argv[1]=='child':child(sys.argv[2])
        else:raise SystemExit(2)
    except Exception as error:
        import traceback
        frames=traceback.extract_tb(error.__traceback__)[-3:]
        print(json.dumps({'status':'owned_input_probe_failed','errorType':type(error).__name__,'stages':[{'function':f.name,'line':f.lineno} for f in frames]}),flush=True)
        raise SystemExit(3)
