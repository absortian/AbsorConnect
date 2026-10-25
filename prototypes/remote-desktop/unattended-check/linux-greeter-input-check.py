#!/usr/bin/env python3
"""Ensayo root → Slick Greeter: Tab y Mayús+Tab, sin texto ni autenticación."""
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


GREETER_SHA256 = "99526cac541b0e4853934a1cd8d7314cd805d99b77e20e9bd35813d833dfc799"

# Solo metadatos y fases fijas por un socketpair heredado. Los objetos accesibles
# permanecen en el trabajador; no se publican nombres, valores o referencias.
WORKER = r'''
import json,os,re,signal,socket,sys,time
from pathlib import Path
import gi
from gi.repository import Gio,GLib
fd,uid,gid,pid=map(int,sys.argv[1:])
if uid<=0 or os.getuid()!=uid or os.getgid()!=gid or os.getgroups():sys.exit(3)
channel=socket.socket(fileno=fd);channel.settimeout(10);stream=channel.makefile("rb")
bus=registry_bus=None
def stop(_signal,_frame):raise RuntimeError("greeter_worker_interrupted")
for number in (signal.SIGALRM,signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(number,stop)
signal.alarm(35)
def send(value):channel.sendall((json.dumps(value)+"\n").encode())
def expect(command):
    if stream.readline(65)!=command:raise RuntimeError("unexpected_worker_phase")
def call(connection,destination,path,interface,method,parameters,type_):
    return connection.call_sync(destination,path,interface,method,parameters,GLib.VariantType.new(type_),
                                Gio.DBusCallFlags.NO_AUTO_START,1500,None).unpack()[0]
def owner(connection,method,name,type_):
    return call(connection,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus",
                method,GLib.Variant("(s)",(name,)),type_)
def identity():
    p=Path("/proc")/str(pid)
    if p.stat().st_uid!=uid or (p/"exe").resolve()!=Path("/usr/sbin/slick-greeter"):
        raise RuntimeError("greeter_process_changed")
    if (owner(bus,"GetConnectionUnixProcessID","x.dm.SlickGreeter","(u)")!=pid
            or owner(bus,"GetConnectionUnixUser","x.dm.SlickGreeter","(u)")!=uid):
        raise RuntimeError("greeter_bus_owner_mismatch")
def matches(app,states,roles):
    collection=app.get_collection_iface()
    if collection is None:raise RuntimeError("accessible_collection_required")
    rule=Atspi.MatchRule.new(Atspi.StateSet.new(states),Atspi.CollectionMatchType.ALL,
                            {},Atspi.CollectionMatchType.ALL,roles,Atspi.CollectionMatchType.ANY,
                            [],Atspi.CollectionMatchType.ALL,False)
    values=collection.get_matches(rule,Atspi.CollectionSortOrder.CANONICAL,16,True)
    if len(values)>=16:raise RuntimeError("accessible_result_limit")
    return values
def snapshot():
    identity()
    desktop=Atspi.get_desktop(0)
    if desktop.get_child_count()>64:raise RuntimeError("accessible_application_limit")
    applications=[]
    for i in range(desktop.get_child_count()):
        app=desktop.get_child_at_index(i)
        if app.get_process_id()==pid:applications.append(app)
    if len(applications)!=1:raise RuntimeError("unique_greeter_application_required")
    app=applications[0];app.clear_cache()
    passwords=matches(app,[Atspi.StateType.SHOWING],[Atspi.Role.PASSWORD_TEXT])
    nodes=matches(app,[Atspi.StateType.SHOWING,Atspi.StateType.FOCUSED],[])
    controls=[n for n in nodes if n.get_role() not in (Atspi.Role.WINDOW,Atspi.Role.FRAME,Atspi.Role.APPLICATION)]
    if len(passwords)!=1 or len(controls)!=1:raise RuntimeError("unique_greeter_focus_required")
    return {"busOwnerVerified":True,"showingPasswordFields":1,"focusedControlCount":1,
            "focusedRole":int(controls[0].get_role())},controls[0]
try:
    flags=Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT|Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION
    bus=Gio.DBusConnection.new_for_address_sync(os.environ["DBUS_SESSION_BUS_ADDRESS"],flags,None,None)
    deadline=time.monotonic()+4
    while not owner(bus,"NameHasOwner","x.dm.SlickGreeter","(b)"):
        if time.monotonic()>=deadline:raise RuntimeError("existing_greeter_bus_required")
        time.sleep(.1)
    identity()
    while not owner(bus,"NameHasOwner","org.a11y.Bus","(b)"):
        if time.monotonic()>=deadline:raise RuntimeError("existing_accessibility_bus_required")
        time.sleep(.1)
    address=call(bus,"org.a11y.Bus","/org/a11y/bus","org.a11y.Bus","GetAddress",None,"(s)")
    if len(address)>512 or not re.fullmatch(r"unix:(?:path|abstract)=[/A-Za-z0-9_.%-]+(?:,guid=[0-9a-f]{32})?",address):
        raise RuntimeError("single_local_accessibility_address_required")
    registry_bus=Gio.DBusConnection.new_for_address_sync(address,flags,None,None)
    if not owner(registry_bus,"NameHasOwner","org.a11y.atspi.Registry","(b)"):
        raise RuntimeError("existing_registry_required")
    if owner(registry_bus,"GetConnectionUnixUser","org.a11y.atspi.Registry","(u)")!=uid:
        raise RuntimeError("registry_owner_mismatch")
    os.environ["AT_SPI_BUS_ADDRESS"]=address
    gi.require_version("Atspi","2.0")
    from gi.repository import Atspi
    Atspi.set_timeout(500,1500)
    value,initial=snapshot()
    if initial.get_role()!=Atspi.Role.PASSWORD_TEXT:raise RuntimeError("initial_password_focus_required")
    time.sleep(.1)
    fresh,current=snapshot()
    if current!=initial:raise RuntimeError("stable_greeter_focus_required")
    send({"event":"ready","snapshot":fresh,"identityStable":True,"registryOwnerVerified":True})
    expect(b"before_tab\n")
    value,current=snapshot()
    if current!=initial:raise RuntimeError("initial_focus_changed")
    send({"event":"before_tab","snapshot":value,"sameAsInitial":True})
    expect(b"after_tab\n")
    deadline=time.monotonic()+2
    while True:
        value,different=snapshot()
        if different!=initial:break
        if time.monotonic()>=deadline:raise RuntimeError("native_tab_not_observed")
        time.sleep(.05)
    send({"event":"after_tab","snapshot":value,"changed":True})
    expect(b"before_reverse\n")
    value,current=snapshot()
    if current!=different:raise RuntimeError("tab_destination_changed")
    send({"event":"before_reverse","snapshot":value,"sameAsTabDestination":True})
    expect(b"after_reverse\n")
    deadline=time.monotonic()+2
    while True:
        value,current=snapshot()
        if current==initial:break
        if time.monotonic()>=deadline:raise RuntimeError("native_reverse_not_observed")
        time.sleep(.05)
    send({"event":"after_reverse","snapshot":value,"restored":True})
    expect(b"finish\n")
    send({"event":"done","focusQueriesStoppedBeforeLogin":True})
except Exception as error:
    try:send({"event":"error","reason":str(error) if isinstance(error,RuntimeError) else type(error).__name__})
    except OSError:pass
finally:
    signal.alarm(0)
    stream.close();channel.close()
    for connection in (registry_bus,bus):
        if connection is not None:
            try:connection.close_sync(None)
            except GLib.Error:pass
'''


def load_helpers():
    if os.getuid() != 0:
        raise RuntimeError("root_context_required")
    source = Path(__file__).absolute()
    for path in (source.parent, *source.parent.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_protected_source_directory_required")
    greeter_source = source.with_name("linux-greeter-focus-check.py")
    for path in (source, greeter_source):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_owned_source_required")
    data = greeter_source.read_bytes()
    if hashlib.sha256(data).hexdigest() != GREETER_SHA256:
        raise RuntimeError("greeter_helper_hash_mismatch")
    module = types.ModuleType("absor_greeter_input_context")
    module.__file__ = str(greeter_source)
    exec(compile(data, str(greeter_source), "exec"), module.__dict__)
    return module, module.helper()


def navigate(greeter, helper, expected, observation):
    uid = int(expected[1]["User"])
    account = pwd.getpwnam("lightdm")
    if uid <= 0 or uid != account.pw_uid or expected[1].get("Display") != ":0":
        raise RuntimeError("expected_lightdm_greeter_required")
    deadline = time.monotonic() + 8
    while True:
        try:
            pid = greeter.greeter_process(uid)
            address = greeter.greeter_session_bus(pid, uid)
            authority = helper.authority_for(":0")
            break
        except RuntimeError:
            if time.monotonic() >= deadline or helper.context() != expected:
                raise
            time.sleep(.1)
    def context_guard():
        if helper.context() != expected or greeter.greeter_process(uid) != pid:
            raise RuntimeError("original_greeter_context_required")
    context_guard()
    os.environ["XAUTHORITY"] = str(authority)
    x11 = c.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
    xtst = c.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    pointer, window, integer = c.c_void_p, c.c_ulong, c.c_int
    def bind(library, name, result, *arguments):
        function = getattr(library, name)
        function.restype, function.argtypes = result, list(arguments)
    bind(x11, "XOpenDisplay", pointer, c.c_char_p)
    bind(x11, "XCloseDisplay", integer, pointer)
    bind(x11, "XDefaultRootWindow", window, pointer)
    bind(x11, "XQueryKeymap", integer, pointer, c.c_char_p)
    bind(x11, "XQueryPointer", integer, pointer, window, c.POINTER(window), c.POINTER(window),
         c.POINTER(integer), c.POINTER(integer), c.POINTER(integer), c.POINTER(integer), c.POINTER(c.c_uint))
    bind(x11, "XKeysymToKeycode", c.c_ubyte, pointer, window)
    bind(x11, "XSync", integer, pointer, integer)
    bind(xtst, "XTestQueryExtension", integer, pointer, *([c.POINTER(integer)]*4))
    bind(xtst, "XTestFakeKeyEvent", integer, pointer, c.c_uint, integer, window)
    display = x11.XOpenDisplay(b":0")
    if not display:
        raise RuntimeError("root_x11_connection_failed")
    worker = channel = peer = stream = None
    try:
        root = x11.XDefaultRootWindow(display)
        extension = [integer() for _ in range(4)]
        if not xtst.XTestQueryExtension(display, *(c.byref(value) for value in extension)):
            raise RuntimeError("xtest_required")
        tab, shift = (x11.XKeysymToKeycode(display, key) for key in (0xFF09, 0xFFE1))
        if not tab or not shift or tab == shift:
            raise RuntimeError("navigation_keys_unavailable")
        def input_counts():
            keys = c.create_string_buffer(32)
            if not x11.XQueryKeymap(display, keys):
                raise RuntimeError("keyboard_state_unavailable")
            r, child, x, y, wx, wy, mask = window(), window(), integer(), integer(), integer(), integer(), c.c_uint()
            if not x11.XQueryPointer(display, root, c.byref(r), c.byref(child), c.byref(x), c.byref(y),
                                     c.byref(wx), c.byref(wy), c.byref(mask)):
                raise RuntimeError("pointer_state_unavailable")
            return sum(value.bit_count() for value in keys.raw), (mask.value & 0x1F00).bit_count()
        def idle(stage):
            samples = 0
            deadline = time.monotonic() + 2
            while True:
                keys, buttons = input_counts()
                samples = samples + 1 if keys == buttons == 0 else 0
                if samples >= 2:
                    observation.setdefault("neutralInputChecks", {})[stage] = True
                    return
                if time.monotonic() >= deadline:
                    raise RuntimeError("held_input_prevents_probe")
                time.sleep(.1)
        def chord(reverse):
            pressed = []
            previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGINT, signal.SIGTERM, signal.SIGHUP})
            released = True
            try:
                for label, key in ([("shift", shift), ("tab", tab)] if reverse else [("tab", tab)]):
                    if not xtst.XTestFakeKeyEvent(display, key, True, 0):
                        raise RuntimeError("navigation_press_failed")
                    pressed.append((label, key))
                    observation["sentCounts"][label+"Down"] += 1
                    x11.XSync(display, False)
            finally:
                try:
                    for label, key in reversed(pressed):
                        if xtst.XTestFakeKeyEvent(display, key, False, 0):
                            observation["sentCounts"][label+"Up"] += 1
                        else:
                            released = False
                        x11.XSync(display, False)
                finally:
                    signal.pthread_sigmask(signal.SIG_SETMASK, previous)
                if not released:
                    raise RuntimeError("navigation_release_failed")
        idle("beforeWorker")
        channel, peer = socket.socketpair()
        channel.settimeout(12)
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": account.pw_dir,
                       "DBUS_SESSION_BUS_ADDRESS": address}
        worker = subprocess.Popen(["/usr/bin/python3", "-I", "-c", WORKER, str(peer.fileno()),
                                   str(uid), str(account.pw_gid), str(pid)],
                                  pass_fds=(peer.fileno(),), user=uid, group=account.pw_gid, extra_groups=[], env=environment,
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        peer.close();peer = None
        stream = channel.makefile("rb")
        def receive(expected):
            line = stream.readline(1025)
            if len(line) > 1024:
                raise RuntimeError("worker_message_limit")
            value = json.loads(line)
            if not isinstance(value, dict):
                raise RuntimeError("worker_object_required")
            if value.get("event") == "error":
                raise RuntimeError("worker_"+value.get("reason", "failed"))
            if value.get("event") != expected:
                raise RuntimeError("unexpected_worker_event")
            return value
        ready = receive("ready")
        if ready.get("identityStable") is not True or ready.get("registryOwnerVerified") is not True:
            raise RuntimeError("stable_greeter_target_required")
        observation["initialFocus"] = ready["snapshot"]
        for reverse, before, after, flag in ((False,"before_tab","after_tab","sameAsInitial"),
                                              (True,"before_reverse","after_reverse","sameAsTabDestination")):
            context_guard();idle(before)
            if (Path("/proc")/str(worker.pid)).stat().st_uid != uid:
                raise RuntimeError("lightdm_worker_required")
            channel.sendall((before+"\n").encode())
            fresh = receive(before)
            if fresh.get(flag) is not True or worker.poll() is not None or any(input_counts()):
                raise RuntimeError("fresh_neutral_live_target_required")
            context_guard()
            chord(reverse)
            channel.sendall((after+"\n").encode())
            value = receive(after)
            if value.get("restored" if reverse else "changed") is not True:
                raise RuntimeError("native_focus_transition_not_observed")
            observation[after+"Focus"] = value["snapshot"]
        context_guard();idle("afterNavigation")
        channel.sendall(b"finish\n")
        if receive("done").get("focusQueriesStoppedBeforeLogin") is not True:
            raise RuntimeError("focus_observation_not_finished")
        observation["observerExitCode"] = worker.wait(timeout=3)
        if worker.returncode != 0:
            raise RuntimeError("observer_failed")
        if observation["sentCounts"] != {"tabDown":2,"tabUp":2,"shiftDown":1,"shiftUp":1}:
            raise RuntimeError("navigation_counts_mismatch")
        observation.update(nativeTabFocusChangeObserved=True, nativeShiftTabFocusReturnObserved=True,
                           lightdmWorkerUnprivileged=True, registryOwnerVerified=True,
                           focusQueriesStoppedBeforeLogin=True, greeterNavigationVerified=True)
    finally:
        try:
            if worker is not None and worker.poll() is None:
                worker.terminate()
                try:worker.wait(timeout=3)
                except subprocess.TimeoutExpired:worker.kill();worker.wait(timeout=3)
        finally:
            if worker is not None:observation["observerExited"] = worker.poll() is not None
            if stream is not None:stream.close()
            if channel is not None:channel.close()
            if peer is not None:peer.close()
            x11.XCloseDisplay(display)


def run(observation):
    greeter, helper = load_helpers()
    initial = helper.context()
    if initial[1].get("Class") != "user" or int(initial[1]["User"]) <= 0 or helper.cinnamon_active(initial[1]):
        raise RuntimeError("initial_unlocked_user_required")
    deadline = time.monotonic() + 160
    print("READY_TO_LOGOUT_MINT", file=sys.stderr, flush=True)
    while time.monotonic() < deadline:
        try:current = helper.context()
        except RuntimeError:time.sleep(.25);continue
        if current[1].get("Class") == "greeter":break
        if current[1].get("Class") != "user" or current[1].get("User") != initial[1].get("User"):
            raise RuntimeError("unexpected_session_before_greeter")
        time.sleep(.25)
    else:raise RuntimeError("greeter_transition_timeout")
    navigate(greeter, helper, current, observation)
    print("GREETER_INPUT_COMPLETE_WAIT_FOR_LOGIN", file=sys.stderr, flush=True)
    # El trabajador ha terminado y la conexión X11 está cerrada antes del acceso.
    while time.monotonic() < deadline:
        try:returned = helper.context()
        except RuntimeError:time.sleep(.25);continue
        if returned[1].get("Class") == "user":
            if returned[1].get("User") != initial[1].get("User") or returned[0] == initial[0]:
                raise RuntimeError("new_original_user_session_required")
            try:locked = helper.cinnamon_active(returned[1])
            except RuntimeError:time.sleep(.25);continue
            if locked:raise RuntimeError("returned_unlocked_desktop_required")
            observation["newUserSessionObserved"] = True
            return
        time.sleep(.25)
    raise RuntimeError("return_to_desktop_timeout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-greeter-navigation", action="store_true", required=True)
    parser.parse_args()
    def interrupted(_signal, _frame):raise RuntimeError("probe_interrupted_or_timeout")
    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT, signal.SIGHUP):signal.signal(number, interrupted)
    observation = {"sentCounts":{"tabDown":0,"tabUp":0,"shiftDown":0,"shiftUp":0}}
    report = {"schema":1,"platform":"linux","sourceSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "greeterHelperSha256":GREETER_SHA256,"inputTested":False,"captureTested":False,
              "preLoginTested":False,"readyForUnattended":False,"status":"greeter_navigation_not_verified"}
    signal.alarm(180)
    try:
        run(observation)
        report.update(status="greeter_tab_navigation_verified_not_certified",inputTested=True)
    except Exception as error:
        report["reason"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:signal.alarm(0)
    report.update(observation)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["inputTested"] else 3


if __name__ == "__main__":sys.exit(main())
