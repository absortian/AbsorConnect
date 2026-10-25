#!/usr/bin/env python3
"""Ensayo Mint: Tab y Mayús+Tab desde root en bloqueo, sin texto ni autenticación."""
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
import time
import types


FOCUS_SHA256 = "5e698b3110a4bb433b1cc05fca4a186c1fd31c127ae4b5da9fb7f1d23d843e86"
SESSION_SHA256 = "40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275"

# El trabajador de usuario consulta metadatos del bloqueo; root solo envía dos
# secuencias fijas de navegación. El canal no admite órdenes arbitrarias.
REQUESTER_WORKER = r'''
import json, os, signal, socket, sys, time
from pathlib import Path
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib
if os.getuid() == 0 or os.getuid() != int(sys.argv[2]):
    sys.exit(3)
mode = sys.argv[3]
if mode not in ("navigation", "inventory"):
    sys.exit(3)
channel = socket.socket(fileno=int(sys.argv[1]))
channel.settimeout(10)
stream = channel.makefile("rb")
Atspi.set_timeout(500, 1500)
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
locked_pid = None
def stop(_signal, _frame):
    raise RuntimeError("user_worker_interrupted")
def send(value):
    channel.sendall((json.dumps(value)+"\n").encode())
def expect(command):
    if stream.readline(65) != command:
        raise RuntimeError("unexpected_fixed_worker_command")
def call(destination, path, interface, method, parameters, result_type):
    return bus.call_sync(destination,path,interface,method,parameters,GLib.VariantType.new(result_type),
                         Gio.DBusCallFlags.NONE,2000,None).unpack()[0]
def active():
    return call("org.cinnamon.ScreenSaver","/org/cinnamon/ScreenSaver","org.cinnamon.ScreenSaver","GetActive",None,"(b)")
def snapshot():
    name = GLib.Variant("(s)",("org.cinnamon.ScreenSaver",))
    pid = call("org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","GetConnectionUnixProcessID",name,"(u)")
    uid = call("org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus","GetConnectionUnixUser",name,"(u)")
    if uid != os.getuid() or (Path("/proc")/str(pid)).stat().st_uid != uid or (locked_pid is not None and pid != locked_pid):
        raise RuntimeError("screensaver_bus_owner_changed")
    desktop = Atspi.get_desktop(0)
    if desktop.get_child_count()>64:
        raise RuntimeError("accessible_application_limit")
    applications = []
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        try:
            if app.get_process_id()==pid:applications.append(app)
        except GLib.Error:
            continue
    if len(applications)>1:raise RuntimeError("unique_screensaver_application_required")
    value = {"busOwnerVerified":True,"accessibleApplicationCount":len(applications),
             "showingPasswordFields":0,"focusedControlCount":0,"focusedRole":None}
    if not applications:return value,None,pid
    app=applications[0];app.clear_cache()
    reader=focus_module.FocusObserver.__new__(focus_module.FocusObserver)
    reader.api,reader.application=Atspi,app
    value["showingPasswordFields"]=len(reader.matches(app,[Atspi.StateType.SHOWING],[Atspi.Role.PASSWORD_TEXT]))
    nodes=reader.matches(app,[Atspi.StateType.SHOWING,Atspi.StateType.FOCUSED],[])
    controls=[node for node in nodes if node.get_role() not in (Atspi.Role.WINDOW,Atspi.Role.FRAME,Atspi.Role.APPLICATION)]
    value["focusedControlCount"]=len(controls)
    if len(controls)==1:
        value["focusedRole"]=int(controls[0].get_role())
        return value,controls[0],pid
    return value,None,pid

def locked_focus():
    if not active():raise RuntimeError("locked_context_required")
    value,node,pid=snapshot()
    if value["showingPasswordFields"]!=1 or node is None:
        raise RuntimeError("unique_locked_focus_required")
    return value,node,pid

for number in (signal.SIGTERM,signal.SIGINT,signal.SIGALRM):signal.signal(number,stop)
signal.alarm(170)
try:
    if active():raise RuntimeError("initial_unlocked_desktop_required")
    baseline,_,_=snapshot()
    if baseline["showingPasswordFields"]:raise RuntimeError("initial_password_field_prevents_probe")
    send({"event":"baseline","snapshot":baseline})
    if mode=="navigation":
        deadline=time.monotonic()+145
        initial=None
        while time.monotonic()<deadline:
            if active():
                value,node,pid=snapshot()
                if value["showingPasswordFields"]==1 and node is not None and node.get_role()==Atspi.Role.PASSWORD_TEXT:
                    time.sleep(0.1)
                    fresh,current,fresh_pid=locked_focus()
                    if current==node and fresh_pid==pid:
                        initial=current;locked_pid=pid;break
            time.sleep(0.25)
        if initial is None:raise RuntimeError("owner_locked_password_focus_timeout")
        send({"event":"locked","snapshot":fresh,"identityStable":True})
        expect(b"focus_before_tab\n")
        value,current,_=locked_focus()
        if current!=initial:raise RuntimeError("initial_locked_focus_changed")
        send({"event":"focus_before_tab","snapshot":value,"sameAsInitial":True})
        expect(b"after_tab\n")
        deadline=time.monotonic()+2
        different=None
        while time.monotonic()<deadline:
            value,current,_=locked_focus()
            if current!=initial:
                different=current;break
            time.sleep(0.05)
        if different is None:raise RuntimeError("native_tab_focus_change_not_observed")
        send({"event":"after_tab","snapshot":value,"changed":True})
        expect(b"focus_before_reverse\n")
        value,current,_=locked_focus()
        if current!=different:raise RuntimeError("tab_destination_focus_changed")
        send({"event":"focus_before_reverse","snapshot":value,"sameAsTabDestination":True})
        expect(b"after_reverse\n")
        deadline=time.monotonic()+2
        restored=False
        while time.monotonic()<deadline:
            value,current,_=locked_focus()
            if current==initial:
                restored=True;break
            time.sleep(0.05)
        if not restored:raise RuntimeError("native_reverse_focus_return_not_observed")
        send({"event":"after_reverse","snapshot":value,"restored":True,"focusQueriesStoppedBeforeUnlock":True})
        expect(b"wait_unlock\n")
        while active():time.sleep(0.25)
        send({"event":"unlocked","screensaverActive":False,"focusQueriesStoppedBeforeUnlock":True})
except Exception as error:
    try:send({"event":"error","reason":str(error) if isinstance(error,RuntimeError) else type(error).__name__})
    except OSError:pass
finally:
    signal.alarm(0);stream.close();channel.close()
'''


def session_helper():
    if os.getuid() != 0:
        raise RuntimeError("root_context_required")
    source = Path(__file__).absolute()
    for path in (source.parent, *source.parent.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_protected_source_directory_required")
    helper = source.with_name("linux-session-check.py")
    for path in (source, helper):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_owned_source_required")
    data = helper.read_bytes()
    if hashlib.sha256(data).hexdigest() != SESSION_SHA256:
        raise RuntimeError("session_helper_hash_mismatch")
    module = types.ModuleType("absor_locked_navigation_session")
    module.__file__ = str(helper)
    exec(compile(data, str(helper), "exec"), module.__dict__)
    focus_source = source.with_name("linux-polkit-focus-check.py")
    info = focus_source.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError("root_owned_focus_source_required")
    focus_data = focus_source.read_bytes()
    if hashlib.sha256(focus_data).hexdigest() != FOCUS_SHA256:
        raise RuntimeError("focus_helper_hash_mismatch")
    return module, focus_data


def run(observation):
    helper, focus_data = session_helper()
    def read_context():
        identifier, value = helper.context()
        return identifier, {key: field for key, field in value.items() if key != "LockedHint"}
    initial = read_context()
    session = initial[1]
    uid = int(session["User"])
    if (uid <= 0 or session.get("Class") != "user"
            or session.get("Display") != ":0" or helper.cinnamon_active(session)):
        raise RuntimeError("unlocked_cinnamon_user_required")
    account = pwd.getpwuid(uid)
    user_authority = Path(account.pw_dir) / ".Xauthority"
    info = user_authority.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise RuntimeError("private_user_authority_required")
    for path in (Path("/usr/bin/python3"), Path("/usr/bin/cinnamon")):
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("fixed_system_executable_required")
    cinnamon = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            if (process / "comm").read_text().strip() == "pkexec":
                raise RuntimeError("another_pkexec_is_running")
            if process.stat().st_uid == uid and (process / "exe").resolve() == Path("/usr/bin/cinnamon"):
                cinnamon.append(int(process.name))
        except OSError:
            pass
    if len(cinnamon) != 1:
        raise RuntimeError("unique_user_cinnamon_process_required")
    cinnamon_pid = cinnamon[0]
    authority = helper.authority_for(":0")
    os.environ["XAUTHORITY"] = str(authority)
    x11 = c.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
    xtst = c.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    ptr, win, integer, unsigned = c.c_void_p, c.c_ulong, c.c_int, c.c_uint
    pw, pi = c.POINTER(win), c.POINTER(integer)

    def bind(library, name, result, *arguments):
        function = getattr(library, name)
        function.restype, function.argtypes = result, list(arguments)

    bind(x11, "XOpenDisplay", ptr, c.c_char_p)
    bind(x11, "XCloseDisplay", integer, ptr)
    bind(x11, "XDefaultRootWindow", win, ptr)
    bind(x11, "XGetInputFocus", integer, ptr, pw, pi)
    bind(x11, "XQueryKeymap", integer, ptr, c.c_char_p)
    bind(x11, "XQueryPointer", integer, ptr, win, pw, pw, pi, pi, pi, pi, c.POINTER(unsigned))
    bind(x11, "XKeysymToKeycode", c.c_ubyte, ptr, win)
    bind(x11, "XSync", integer, ptr, integer)
    bind(xtst, "XTestQueryExtension", integer, ptr, pi, pi, pi, pi)
    bind(xtst, "XTestFakeKeyEvent", integer, ptr, unsigned, integer, win)
    display = x11.XOpenDisplay(b":0")
    if not display:
        raise RuntimeError("root_x11_connection_failed")
    requester, channel, peer, stream = None, None, None, None
    try:
        root = x11.XDefaultRootWindow(display)

        def focus():
            value, revert = win(), integer()
            x11.XGetInputFocus(display, c.byref(value), c.byref(revert))
            return value.value

        def input_counts():
            keys = c.create_string_buffer(32)
            if not x11.XQueryKeymap(display, keys):
                raise RuntimeError("keyboard_state_unavailable")
            rr, child, x, y, wx, wy, mask = win(), win(), integer(), integer(), integer(), integer(), unsigned()
            if not x11.XQueryPointer(display, root, c.byref(rr), c.byref(child), c.byref(x), c.byref(y),
                                     c.byref(wx), c.byref(wy), c.byref(mask)):
                raise RuntimeError("pointer_unavailable")
            return sum(value.bit_count() for value in keys.raw), (mask.value & 0x1F00).bit_count()

        def idle(stage, wait_seconds):
            # Solo contadores agregados: nunca códigos, mapas de teclas ni texto.
            deadline = time.monotonic() + wait_seconds
            state = {"samples": 0, "maxHeldKeys": 0, "maxHeldButtons": 0, "neutralSamples": 0}
            observation.setdefault("idleChecks", {})[stage] = state
            while True:
                held_keys, held_buttons = input_counts()
                state["samples"] += 1
                if state["samples"] == 1:
                    state.update(initialHeldKeys=held_keys, initialHeldButtons=held_buttons)
                state.update(finalHeldKeys=held_keys, finalHeldButtons=held_buttons)
                state["maxHeldKeys"] = max(state["maxHeldKeys"], held_keys)
                state["maxHeldButtons"] = max(state["maxHeldButtons"], held_buttons)
                state["neutralSamples"] = state["neutralSamples"] + 1 if not (held_keys or held_buttons) else 0
                if state["neutralSamples"] >= 2:
                    return
                if time.monotonic() >= deadline:
                    raise RuntimeError("held_input_prevents_probe")
                if requester is not None and requester.poll() is not None:
                    raise RuntimeError("request_ended_while_waiting_for_idle")
                time.sleep(0.1)

        def context_guard(locked):
            if read_context() != initial or helper.cinnamon_active(session) != locked:
                raise RuntimeError("original_unlocked_session_required")
            process = Path("/proc") / str(cinnamon_pid)
            if process.stat().st_uid != uid or (process / "exe").resolve() != Path("/usr/bin/cinnamon"):
                raise RuntimeError("cinnamon_identity_changed")

        extension = [integer() for _ in range(4)]
        if not xtst.XTestQueryExtension(display, *(c.byref(value) for value in extension)):
            raise RuntimeError("xtest_required")
        tab = x11.XKeysymToKeycode(display, 0xFF09)
        shift = x11.XKeysymToKeycode(display, 0xFFE1)
        if not tab or not shift or tab == shift:
            raise RuntimeError("navigation_keys_unavailable")
        previous_focus = focus()
        idle("beforeLock", 2)
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": account.pw_dir,
                       "DISPLAY": ":0", "XAUTHORITY": str(user_authority),
                       "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus"}
        channel, peer = socket.socketpair()
        channel.settimeout(165)
        worker_code = ("import types\nfocus_module=types.ModuleType('absor_pinned_focus')\n"
                       + "exec(compile(" + repr(focus_data) + ",'<pinned-focus>','exec'),focus_module.__dict__)\n"
                       + REQUESTER_WORKER)
        requester = subprocess.Popen(["/usr/bin/python3", "-I", "-c", worker_code, str(peer.fileno()), str(uid), "navigation"],
                                     pass_fds=(peer.fileno(),),user=uid, group=account.pw_gid, extra_groups=[], env=environment,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        peer.close();peer = None
        stream = channel.makefile("rb")
        def receive(expected):
            line = stream.readline(1025)
            if len(line) > 1024:raise RuntimeError("worker_message_limit")
            value = json.loads(line)
            if not isinstance(value,dict):raise RuntimeError("worker_object_required")
            if value.get("event") == "error":raise RuntimeError("user_worker_" + value.get("reason","failed"))
            if value.get("event") != expected:raise RuntimeError("unexpected_worker_event")
            return value
        def fresh(expected, flag):
            channel.sendall((expected+"\n").encode())
            result = receive(expected)
            if result.get(flag) is not True:raise RuntimeError("fresh_locked_focus_required")
            if requester.poll() is not None or any(input_counts()):raise RuntimeError("neutral_live_worker_required")
            return result["snapshot"]
        def chord(reverse):
            keys = [("shift",shift),("tab",tab)] if reverse else [("tab",tab)]
            previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGALRM,signal.SIGTERM,signal.SIGINT,signal.SIGHUP})
            pressed = []
            released = True
            try:
                for label,key in keys:
                    if not xtst.XTestFakeKeyEvent(display,key,True,0):raise RuntimeError("navigation_press_failed")
                    pressed.append((label,key));observation["sentCounts"][label+"Down"] += 1
                    x11.XSync(display,False)
            finally:
                try:
                    for label,key in reversed(pressed):
                        if xtst.XTestFakeKeyEvent(display,key,False,0):observation["sentCounts"][label+"Up"] += 1
                        else:released = False
                        x11.XSync(display,False)
                finally:signal.pthread_sigmask(signal.SIG_SETMASK,previous_mask)
                if not released:raise RuntimeError("navigation_release_failed")
        observation["baselineFocus"] = receive("baseline")["snapshot"]
        if observation["baselineFocus"].get("showingPasswordFields") != 0:raise RuntimeError("initial_password_field_prevents_probe")
        context_guard(False)
        print("READY_TO_LOCK_MINT",file=sys.stderr,flush=True)
        locked = receive("locked")
        observation["lockedFocus"] = locked["snapshot"]
        if locked.get("identityStable") is not True:raise RuntimeError("stable_locked_identity_required")
        channel.settimeout(8)
        context_guard(True)
        idle("beforeTab",4)
        if (Path("/proc")/str(requester.pid)).stat().st_uid != uid:raise RuntimeError("user_worker_required")
        observation["beforeTabFocus"] = fresh("focus_before_tab","sameAsInitial")
        chord(False)
        channel.sendall(b"after_tab\n")
        result = receive("after_tab")
        if result.get("changed") is not True:raise RuntimeError("native_tab_focus_change_not_observed")
        observation["afterTabFocus"] = result["snapshot"]
        context_guard(True)
        idle("beforeReverse",2)
        observation["beforeReverseFocus"] = fresh("focus_before_reverse","sameAsTabDestination")
        chord(True)
        channel.sendall(b"after_reverse\n")
        result = receive("after_reverse")
        if result.get("restored") is not True:raise RuntimeError("native_reverse_focus_return_not_observed")
        observation["afterReverseFocus"] = result["snapshot"]
        context_guard(True)
        if any(input_counts()):raise RuntimeError("neutral_input_after_navigation_required")
        channel.sendall(b"wait_unlock\n")
        channel.settimeout(165)
        print("LOCKED_INPUT_COMPLETE_WAIT_FOR_UNLOCK",file=sys.stderr,flush=True)
        unlocked = receive("unlocked")
        if unlocked.get("screensaverActive") is not False or unlocked.get("focusQueriesStoppedBeforeUnlock") is not True:
            raise RuntimeError("manual_unlock_not_observed")
        worker_exit = requester.wait(timeout=3)
        observation["userWorkerExitCode"] = worker_exit
        if worker_exit != 0:raise RuntimeError("user_worker_failed")
        context_guard(False)
        expected = {"tabDown":2,"tabUp":2,"shiftDown":1,"shiftUp":1}
        if observation["sentCounts"] != expected:raise RuntimeError("navigation_release_counts_mismatch")
        return {"schema":1,"platform":"linux","status":"locked_tab_navigation_verified_not_certified",
                "sourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "sessionHelperSha256":SESSION_SHA256,"focusHelperSha256":FOCUS_SHA256,
                "senderRoot":True,"userWorkerUnprivileged":True,"lockedTargetIdentityStable":True,
                "nativeTabFocusChangeObserved":True,"nativeShiftTabFocusReturnObserved":True,
                "lockedContextRetainedDuringInput":True,"manualUnlockObserved":True,
                "focusQueriesStoppedBeforeUnlock":True,"previousFocusRestoredObserved":focus()==previous_focus,
                "inputTested":True,"captureTested":False,"preLoginTested":False,"readyForUnattended":False}
    finally:
        try:
            if requester is not None and requester.poll() is None:
                requester.terminate()
                try:
                    requester.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    requester.kill()
                    requester.wait(timeout=3)
        finally:
            if requester is not None:
                observation["userWorkerExited"] = requester.poll() is not None
            if stream is not None:
                stream.close()
            if channel is not None:
                channel.close()
            if peer is not None:
                peer.close()
            x11.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-locked-navigation", action="store_true", required=True)
    parser.parse_args()

    def interrupted(_signal, _frame):
        raise RuntimeError("probe_interrupted_or_timeout")

    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    signal.alarm(180)
    observation = {"sentCounts": {"tabDown":0,"tabUp":0,"shiftDown":0,"shiftUp":0}}
    try:
        report = run(observation)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        report = {"schema": 1, "platform": "linux", "status": "locked_tab_navigation_not_verified",
                  "reason": str(error) if isinstance(error, RuntimeError) else type(error).__name__,
                  "inputTested": False, "readyForUnattended": False}
    finally:
        signal.alarm(0)
    report.update(observation)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["inputTested"] else 3


if __name__ == "__main__":
    sys.exit(main())
