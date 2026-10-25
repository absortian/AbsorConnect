#!/usr/bin/env python3
"""Ensayo local root → receptor de usuario propio; sin servicio, red ni órdenes arbitrarias."""
import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import stat
import subprocess
import sys
import types
import time


SESSION_SOURCE_SHA256 = "40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275"

# Este código fijo se entrega al trabajador sin privilegios mediante Popen.
# El socketpair heredado solo intercambia preparación y contadores de nuestra ventana.
RECEIVER = r'''
import json, os, socket, sys, time
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("GdkX11", "3.0")
from gi.repository import Gtk, Gdk, GdkX11
if os.getuid() == 0 or not Gtk.init_check([])[0]:
    sys.exit(3)
channel = socket.socket(fileno=int(sys.argv[1]))
keycode = int(sys.argv[2])
counts = {"mouseDown":0,"mouseUp":0,"keyDown":0,"keyUp":0,"unexpectedEvents":0}
window = Gtk.Window(title="AbsorConnect: receptor de usuario para prueba root")
window.set_default_size(340, 180)
window.set_position(Gtk.WindowPosition.MOUSE)
area = Gtk.DrawingArea()
area.set_can_focus(True)
area.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                Gdk.EventMask.KEY_PRESS_MASK | Gdk.EventMask.KEY_RELEASE_MASK)
def receive(_widget, event, name):
    expected = event.button == 1 if name.startswith("mouse") else event.hardware_keycode == keycode
    counts[name if expected and not event.send_event else "unexpectedEvents"] += 1
    return True
for event,name in (("button-press-event","mouseDown"),("button-release-event","mouseUp"),
                   ("key-press-event","keyDown"),("key-release-event","keyUp")):
    area.connect(event,receive,name)
def pump():
    end=time.monotonic()+0.03
    while Gtk.events_pending() and time.monotonic()<end:
        Gtk.main_iteration_do(False)
    time.sleep(0.005)
try:
    window.add(area)
    window.show_all()
    window.present()
    area.grab_focus()
    deadline=time.monotonic()+4
    while not (window.is_active() and area.has_focus()) and time.monotonic()<deadline:
        pump()
    if not (window.is_active() and area.has_focus()):
        raise RuntimeError("receiver_focus_unavailable")
    channel.sendall((json.dumps({"event":"ready","window":window.get_window().get_xid()})+"\n").encode())
    channel.setblocking(False)
    deadline=time.monotonic()+25
    incoming=b""
    while time.monotonic()<deadline:
        pump()
        try:
            data=channel.recv(64)
            if not data:
                break
            incoming+=data
        except BlockingIOError:
            pass
        if incoming == b"finish\n":
            # Drena los eventos enviados antes del mensaje de terminación.
            for _ in range(5):
                pump()
            channel.sendall((json.dumps({"event":"received","counts":counts})+"\n").encode())
            sys.exit(0)
        if len(incoming)>64:
            break
    sys.exit(3)
finally:
    window.destroy()
    channel.close()
'''


def load_session_helper():
    if os.getuid() != 0:
        raise RuntimeError("root_context_required")
    source = Path(__file__).absolute()
    for path in [source.parent, *source.parent.parents]:
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_protected_source_directory_required")
    helper = source.with_name("linux-session-check.py")
    for path in (source, helper):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_owned_source_required")
    data = helper.read_bytes()
    if hashlib.sha256(data).hexdigest() != SESSION_SOURCE_SHA256:
        raise RuntimeError("session_helper_hash_mismatch")
    module = types.ModuleType("absor_root_lab_session")
    module.__file__ = str(helper)
    # Ejecuta exactamente los bytes comprobados, sin usar pycache del directorio.
    exec(compile(data, str(helper), "exec"), module.__dict__)
    return module


def run():
    helper = load_session_helper()
    initial = helper.context()
    session = initial[1]
    uid = int(session["User"])
    if uid <= 0 or session.get("Class") != "user" or session.get("LockedHint") != "no" or session.get("Display") != ":0":
        raise RuntimeError("unlocked_user_console_required")
    if helper.cinnamon_active(session):
        raise RuntimeError("inactive_cinnamon_screensaver_required")
    account = pwd.getpwuid(uid)
    user_authority = Path(account.pw_dir) / ".Xauthority"
    info = user_authority.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise RuntimeError("private_user_authority_required")
    authority = helper.authority_for(":0")
    os.environ["XAUTHORITY"] = str(authority)
    x11 = c.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
    xtst = c.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    pointer_type, win, integer, unsigned = c.c_void_p, c.c_ulong, c.c_int, c.c_uint
    pw, pi = c.POINTER(win), c.POINTER(integer)
    def bind(lib, name, result, *args):
        function = getattr(lib, name)
        function.restype, function.argtypes = result, list(args)
    bind(x11,"XOpenDisplay",pointer_type,c.c_char_p)
    bind(x11,"XCloseDisplay",integer,pointer_type)
    bind(x11,"XDefaultScreen",integer,pointer_type)
    bind(x11,"XRootWindow",win,pointer_type,integer)
    bind(x11,"XGetInputFocus",integer,pointer_type,pw,pi)
    bind(x11,"XQueryKeymap",integer,pointer_type,c.c_char_p)
    bind(x11,"XQueryPointer",integer,pointer_type,win,pw,pw,pi,pi,pi,pi,c.POINTER(unsigned))
    bind(x11,"XTranslateCoordinates",integer,pointer_type,win,win,integer,integer,pi,pi,pw)
    bind(x11,"XQueryTree",integer,pointer_type,win,pw,pw,c.POINTER(pw),c.POINTER(unsigned))
    bind(x11,"XInternAtom",win,pointer_type,c.c_char_p,integer)
    bind(x11,"XGetWindowProperty",integer,pointer_type,win,win,c.c_long,c.c_long,integer,win,
         pw,pi,c.POINTER(win),c.POINTER(win),c.POINTER(pointer_type))
    bind(x11,"XFree",integer,pointer_type)
    bind(x11,"XSync",integer,pointer_type,integer)
    bind(x11,"XKeysymToKeycode",c.c_ubyte,pointer_type,win)
    bind(xtst,"XTestQueryExtension",integer,pointer_type,pi,pi,pi,pi)
    bind(xtst,"XTestFakeMotionEvent",integer,pointer_type,integer,integer,integer,win)
    bind(xtst,"XTestFakeButtonEvent",integer,pointer_type,unsigned,integer,win)
    bind(xtst,"XTestFakeKeyEvent",integer,pointer_type,unsigned,integer,win)
    display = x11.XOpenDisplay(b":0")
    if not display:
        raise RuntimeError("root_x11_connection_failed")
    child, channel, peer, stream = None, None, None, None
    moved, restored, target, owned = False, False, None, set()
    screen = x11.XDefaultScreen(display)
    root = x11.XRootWindow(display,screen)
    def focus():
        value,revert=win(),integer()
        x11.XGetInputFocus(display,c.byref(value),c.byref(revert))
        return value.value
    def pointer():
        rr,ch,x,y,wx,wy,mask=win(),win(),integer(),integer(),integer(),integer(),unsigned()
        if not x11.XQueryPointer(display,root,c.byref(rr),c.byref(ch),c.byref(x),c.byref(y),c.byref(wx),c.byref(wy),c.byref(mask)):
            raise RuntimeError("pointer_unavailable")
        return x.value,y.value,mask.value,ch.value
    def tree(window):
        rr,parent,children,size=win(),win(),pw(),unsigned()
        if not x11.XQueryTree(display,window,c.byref(rr),c.byref(parent),c.byref(children),c.byref(size)):
            raise RuntimeError("own_window_tree_unavailable")
        try:
            if size.value>64:
                raise RuntimeError("own_window_tree_limit")
            return parent.value,[children[i] for i in range(size.value)]
        finally:
            if children:x11.XFree(children)
    def context_guard():
        if helper.context()!=initial or helper.cinnamon_active(session):
            raise RuntimeError("original_unlocked_session_required")
    def idle_guard():
        keys=c.create_string_buffer(32)
        x11.XQueryKeymap(display,keys)
        if any(keys.raw) or pointer()[2]&0x1F00:
            raise RuntimeError("held_input_prevents_probe")
    def guard():
        context_guard()
        if child.poll() is not None or focus() not in owned:
            raise RuntimeError("own_receiver_focus_required")
        idle_guard()
    def pulse(function,code):
        previous=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGALRM,signal.SIGTERM,signal.SIGINT})
        try:
            try:
                if not function(display,code,True,0):raise RuntimeError("press_failed")
                x11.XSync(display,False)
            finally:
                if not function(display,code,False,0):raise RuntimeError("release_failed")
                x11.XSync(display,False)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK,previous)
    original,previous_focus=pointer()[:2],focus()
    try:
        extension=[integer() for _ in range(4)]
        if not xtst.XTestQueryExtension(display,*(c.byref(v) for v in extension)):
            raise RuntimeError("xtest_required")
        idle_guard()
        keycode=x11.XKeysymToKeycode(display,0x61)
        if not keycode:raise RuntimeError("fixed_key_unavailable")
        channel,peer=socket.socketpair()
        channel.settimeout(8)
        environment={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8","HOME":account.pw_dir,
                     "DISPLAY":":0","XAUTHORITY":str(user_authority),"GDK_BACKEND":"x11",
                     "DBUS_SESSION_BUS_ADDRESS":f"unix:path=/run/user/{uid}/bus"}
        child=subprocess.Popen(["/usr/bin/python3","-I","-c",RECEIVER,str(peer.fileno()),str(keycode)],
                               pass_fds=(peer.fileno(),),user=uid,group=account.pw_gid,extra_groups=[],env=environment,
                               stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        peer.close();peer=None
        stream=channel.makefile("rb")
        line=stream.readline(1025)
        if len(line)>1024:raise RuntimeError("receiver_message_too_large")
        ready=json.loads(line)
        if ready.get("event")!="ready" or not isinstance(ready.get("window"),int) or ready["window"]<=1:
            raise RuntimeError("invalid_receiver_ready")
        window=ready["window"]
        # La propiedad debe corresponder al PID creado por root, con UID descartado al usuario.
        if (Path("/proc")/str(child.pid)).stat().st_uid!=uid:
            raise RuntimeError("receiver_uid_mismatch")
        atom=x11.XInternAtom(display,b"_NET_WM_PID",True)
        if not atom:raise RuntimeError("receiver_pid_atom_required")
        actual,format_,items,remaining,data=win(),integer(),win(),win(),pointer_type()
        try:
            status=x11.XGetWindowProperty(display,window,atom,0,1,False,6,c.byref(actual),c.byref(format_),
                                          c.byref(items),c.byref(remaining),c.byref(data))
            if status!=0 or actual.value!=6 or format_.value!=32 or items.value!=1 or remaining.value!=0 or not data:
                raise RuntimeError("receiver_pid_property_required")
            if (c.cast(data,pw)[0]&0xFFFFFFFF)!=child.pid:raise RuntimeError("receiver_window_pid_mismatch")
        finally:
            if data:x11.XFree(data)
        pending=[window]
        while pending:
            if len(owned)>=64:raise RuntimeError("own_window_tree_limit")
            current=pending.pop()
            if current in owned:continue
            owned.add(current);pending.extend(tree(current)[1])
        guard()
        ancestors,current=set(),window
        for _ in range(16):
            if current==root:break
            ancestors.add(current);current=tree(current)[0]
        x,y,ch=integer(),integer(),win()
        if not x11.XTranslateCoordinates(display,window,root,170,90,c.byref(x),c.byref(y),c.byref(ch)):
            raise RuntimeError("receiver_position_unavailable")
        target=x.value,y.value
        moved=True
        if not xtst.XTestFakeMotionEvent(display,screen,*target,0):raise RuntimeError("pointer_move_failed")
        x11.XSync(display,False)
        guard()
        position=pointer()
        if position[:2]!=target or position[3] not in ancestors:raise RuntimeError("own_pointer_target_required")
        pulse(xtst.XTestFakeButtonEvent,1)
        guard()
        pulse(xtst.XTestFakeKeyEvent,keycode)
        guard()
        if pointer()[:2]!=target:raise RuntimeError("pointer_changed_during_probe")
        if not xtst.XTestFakeMotionEvent(display,screen,*original,0):raise RuntimeError("pointer_restore_failed")
        x11.XSync(display,False)
        restored=pointer()[:2]==original
        if not restored:raise RuntimeError("pointer_restore_not_observed")
        channel.sendall(b"finish\n")
        line=stream.readline(1025)
        if len(line)>1024:raise RuntimeError("receiver_message_too_large")
        received=json.loads(line)
        expected={"mouseDown":1,"mouseUp":1,"keyDown":1,"keyUp":1,"unexpectedEvents":0}
        if received.get("event")!="received" or received.get("counts")!=expected:
            raise RuntimeError("native_reception_not_verified")
        if child.wait(timeout=3)!=0:raise RuntimeError("receiver_failed")
        context_guard()
        return {"schema":1,"platform":"linux","status":"root_to_user_input_verified_not_certified",
                "sourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "sessionHelperSha256":SESSION_SOURCE_SHA256,"senderRoot":True,"receiverUnprivileged":True,
                "separateProcesses":True,"receiverPidVerified":True,"rootPrivateAuthority":True,
                "counts":received["counts"],"pointerRestored":restored,"receiverExited":True,
                "previousFocusRestoredObserved":focus()==previous_focus,
                "inputTested":True,"polkitInputTested":False,"preLoginTested":False,"readyForUnattended":False}
    finally:
        try:
            if moved and not restored and child is not None and child.poll() is None:
                context_guard()
                if focus() in owned and pointer()[:2]==target and not pointer()[2]&0x1F00:
                    xtst.XTestFakeMotionEvent(display,screen,*original,0);x11.XSync(display,False)
        finally:
            if stream is not None:stream.close()
            if channel is not None:channel.close()
            if peer is not None:peer.close()
            if child is not None and child.poll() is None:
                child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=3)
            x11.XCloseDisplay(display)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-root-owned-input",action="store_true",required=True)
    parser.parse_args()
    def interrupted(_signal,_frame):raise RuntimeError("probe_interrupted_or_timeout")
    for sig in (signal.SIGALRM,signal.SIGTERM,signal.SIGINT):signal.signal(sig,interrupted)
    signal.alarm(30)
    try:
        report=run()
    except (RuntimeError,OSError,ValueError,KeyError,subprocess.TimeoutExpired) as error:
        report={"schema":1,"platform":"linux","status":"root_to_user_input_not_verified",
                "reason":str(error) if isinstance(error,RuntimeError) else type(error).__name__,
                "inputTested":False,"readyForUnattended":False}
    finally:signal.alarm(0)
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
    return 0 if report["inputTested"] else 3


if __name__=="__main__":sys.exit(main())
