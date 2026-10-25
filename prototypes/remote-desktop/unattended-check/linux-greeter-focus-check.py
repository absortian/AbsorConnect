#!/usr/bin/env python3
"""Observa LightDM y el foco de Slick Greeter, sin captura, entrada ni autenticación."""
import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import sys
import time
import types


SESSION_SHA256 = "40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275"
GREETER = Path("/usr/sbin/slick-greeter")

# Recibe solo PID/UID y una dirección local de accesibilidad. No recibe cookies
# X11 ni consulta entornos de procesos. Nunca usa interfaces de texto o acciones.
OBSERVER = r'''
import json, os, signal, sys, time
from pathlib import Path
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
pid,uid=int(sys.argv[1]),int(sys.argv[2])
if uid<=0 or os.getuid()!=uid or os.getgid()!=int(sys.argv[3]) or os.getgroups():
    sys.exit(3)
def interrupted(_signal,_frame):raise RuntimeError("observer_timeout")
signal.signal(signal.SIGALRM,interrupted)
signal.alarm(12)
Atspi.set_timeout(500,1500)
def identity():
    p=Path("/proc")/str(pid)
    if p.stat().st_uid!=uid or (p/"exe").resolve()!=Path("/usr/sbin/slick-greeter"):
        raise RuntimeError("greeter_process_changed")
def matches(app,states,roles):
    collection=app.get_collection_iface()
    if collection is None:raise RuntimeError("accessible_collection_required")
    rule=Atspi.MatchRule.new(Atspi.StateSet.new(states),Atspi.CollectionMatchType.ALL,
                            {},Atspi.CollectionMatchType.ALL,roles,Atspi.CollectionMatchType.ANY,
                            [],Atspi.CollectionMatchType.ALL,False)
    values=collection.get_matches(rule,Atspi.CollectionSortOrder.CANONICAL,16,True)
    if len(values)>=16:raise RuntimeError("accessible_result_limit")
    return values
report={"greeterProcessVerified":False,"observerUnprivileged":True,
        "supplementaryGroupsEmpty":True,"inputSent":False}
try:
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        identity()
        desktop=Atspi.get_desktop(0)
        count=desktop.get_child_count()
        if count>64:raise RuntimeError("accessible_application_limit")
        applications=[]
        for i in range(count):
            app=desktop.get_child_at_index(i)
            if app.get_process_id()==pid:applications.append(app)
        if len(applications)>1:raise RuntimeError("unique_greeter_application_required")
        snapshot={"accessibleApplicationCount":len(applications),"showingPasswordFields":0,
                  "focusedPasswordFields":0,"focusedRoleCounts":{}}
        if applications:
            app=applications[0];app.clear_cache()
            snapshot["showingPasswordFields"]=len(matches(app,[Atspi.StateType.SHOWING],[Atspi.Role.PASSWORD_TEXT]))
            for node in matches(app,[Atspi.StateType.SHOWING,Atspi.StateType.FOCUSED],[]):
                role=node.get_role()
                label=str(int(role))
                snapshot["focusedRoleCounts"][label]=snapshot["focusedRoleCounts"].get(label,0)+1
                if role==Atspi.Role.PASSWORD_TEXT:snapshot["focusedPasswordFields"]+=1
        report["snapshot"]=snapshot
        if snapshot["showingPasswordFields"]==1 and snapshot["focusedPasswordFields"]==1:
            identity()
            report.update(greeterProcessVerified=True,focusedPasswordObserved=True,
                          focusQueriesStoppedBeforeManualLogin=True)
            break
        time.sleep(0.25)
    else:raise RuntimeError("focused_greeter_password_not_observed")
except Exception as error:
    report["reason"]=str(error) if isinstance(error,RuntimeError) else type(error).__name__
finally:signal.alarm(0)
print(json.dumps(report),flush=True)
sys.exit(0 if report.get("focusedPasswordObserved") else 3)
'''


def helper():
    if os.getuid() != 0:
        raise RuntimeError("root_context_required")
    source = Path(__file__).absolute()
    for path in (source.parent, *source.parent.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_protected_source_directory_required")
    auxiliary = source.with_name("linux-session-check.py")
    for path in (source, auxiliary):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("root_owned_source_required")
    data = auxiliary.read_bytes()
    if hashlib.sha256(data).hexdigest() != SESSION_SHA256:
        raise RuntimeError("session_helper_hash_mismatch")
    module = types.ModuleType("absor_greeter_session")
    module.__file__ = str(auxiliary)
    exec(compile(data, str(auxiliary), "exec"), module.__dict__)
    for path in (GREETER, Path("/usr/bin/python3")):
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("fixed_system_executable_required")
    return module


def greeter_process(uid):
    candidates = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid == uid and (process / "exe").resolve() == GREETER:
                candidates.append(int(process.name))
        except OSError:
            pass
    if len(candidates) != 1:
        raise RuntimeError("unique_greeter_process_required")
    return candidates[0]


def accessibility_address(authority, display_name):
    # Solo AT_SPI_BUS, propiedad pública del servidor X actual, limitada a 512
    # bytes. No consulta títulos, ventanas de usuario ni cookies Xauthority.
    os.environ["XAUTHORITY"] = str(authority)
    x11 = c.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
    pointer, number = c.c_void_p, c.c_ulong
    signatures = {
        "XOpenDisplay": (pointer, [c.c_char_p]),
        "XCloseDisplay": (c.c_int, [pointer]),
        "XDefaultRootWindow": (number, [pointer]),
        "XInternAtom": (number, [pointer, c.c_char_p, c.c_int]),
        "XGetWindowProperty": (c.c_int, [pointer, number, number, c.c_long, c.c_long, c.c_int,
                                        number, c.POINTER(number), c.POINTER(c.c_int),
                                        c.POINTER(number), c.POINTER(number), c.POINTER(pointer)]),
        "XFree": (c.c_int, [pointer]),
    }
    for name, (result, arguments) in signatures.items():
        function = getattr(x11, name)
        function.restype, function.argtypes = result, arguments
    display = x11.XOpenDisplay(display_name.encode("ascii"))
    if not display:
        raise RuntimeError("root_x11_connection_failed")
    value = pointer()
    try:
        atom = x11.XInternAtom(display, b"AT_SPI_BUS", True)
        if not atom:
            raise RuntimeError("greeter_accessibility_property_absent")
        actual, width, length, remaining = number(), c.c_int(), number(), number()
        status = x11.XGetWindowProperty(display, x11.XDefaultRootWindow(display), atom, 0, 128,
                                       False, 31, c.byref(actual), c.byref(width), c.byref(length),
                                       c.byref(remaining), c.byref(value))
        if status or actual.value != 31 or width.value != 8 or remaining.value or not 0 < length.value <= 512:
            raise RuntimeError("bounded_accessibility_string_required")
        address = c.string_at(value, length.value).decode("ascii").rstrip("\x00")
        # Una única dirección local; nunca TCP, autolaunch ni listas alternativas.
        if not re.fullmatch(r"unix:(?:path|abstract)=[/A-Za-z0-9_.%-]+(?:,guid=[0-9a-f]{32})?", address):
            raise RuntimeError("single_local_accessibility_address_required")
        return address
    finally:
        if value.value:
            x11.XFree(value)
        x11.XCloseDisplay(display)


def observe(report):
    session_api = helper()
    initial = session_api.context()
    if initial[1].get("Class") != "user" or session_api.cinnamon_active(initial[1]):
        raise RuntimeError("initial_unlocked_user_required")
    original_uid = int(initial[1]["User"])
    if original_uid <= 0:
        raise RuntimeError("unprivileged_original_user_required")
    deadline = time.monotonic() + 160
    print("READY_TO_LOGOUT_MINT", file=sys.stderr, flush=True)
    while time.monotonic() < deadline:
        try:
            current = session_api.context()
        except RuntimeError:
            time.sleep(0.25)
            continue
        if current[1].get("Class") == "greeter":
            break
        if current[1].get("Class") != "user" or int(current[1]["User"]) != original_uid:
            raise RuntimeError("unexpected_session_before_greeter")
        time.sleep(0.25)
    else:
        raise RuntimeError("owner_greeter_transition_timeout")
    report["greeterSessionObserved"] = True
    uid = int(current[1]["User"])
    account = pwd.getpwnam("lightdm")
    if uid <= 0 or uid != account.pw_uid or current[1].get("Display") != ":0":
        raise RuntimeError("expected_lightdm_x11_greeter_required")
    # logind puede anunciar el greeter antes de que publique su bus accesible.
    startup_deadline = min(deadline, time.monotonic() + 10)
    while True:
        try:
            pid = greeter_process(uid)
            address = accessibility_address(session_api.authority_for(":0"), ":0")
            break
        except RuntimeError as error:
            if str(error) not in ("unique_greeter_process_required", "unique_private_root_authority_required",
                                  "root_x11_connection_failed", "greeter_accessibility_property_absent"):
                raise
            if time.monotonic() >= startup_deadline or session_api.context() != current:
                raise
            time.sleep(0.25)
    if session_api.context() != current or greeter_process(uid) != pid:
        raise RuntimeError("greeter_changed_before_observation")
    # El trabajador no recibe DISPLAY ni XAUTHORITY: solo usa AT-SPI como lightdm.
    environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": account.pw_dir,
                   "AT_SPI_BUS_ADDRESS": address}
    child = subprocess.run(["/usr/bin/python3", "-I", "-c", OBSERVER, str(pid), str(uid), str(account.pw_gid)],
                           user=uid, group=account.pw_gid, extra_groups=[], env=environment,
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=15, check=False)
    if len(child.stdout) > 4096:
        raise RuntimeError("observer_report_limit")
    report["observerExitCode"] = child.returncode
    report["observerExited"] = True
    report["greeterFocus"] = json.loads(child.stdout)
    if child.returncode or report["greeterFocus"].get("focusedPasswordObserved") is not True:
        raise RuntimeError("greeter_focus_not_observed")
    if session_api.context() != current or greeter_process(uid) != pid:
        raise RuntimeError("greeter_changed_during_observation")
    report["authorityResolvedForGreeter"] = True
    print("GREETER_OBSERVED_WAIT_FOR_MANUAL_LOGIN", file=sys.stderr, flush=True)
    # Ya no consulta el foco: el propietario puede introducir su contraseña.
    while time.monotonic() < deadline:
        try:
            returned = session_api.context()
        except RuntimeError:
            time.sleep(0.25)
            continue
        if returned[1].get("Class") == "user":
            if int(returned[1]["User"]) != original_uid or returned[0] == initial[0]:
                raise RuntimeError("new_original_user_session_required")
            try:
                locked = session_api.cinnamon_active(returned[1])
            except RuntimeError:
                time.sleep(0.25)
                continue
            if locked:
                raise RuntimeError("returned_unlocked_desktop_required")
            report.update(manualLoginObserved=True, newUserSessionObserved=True,
                          status="greeter_focus_metadata_observed_not_certified")
            return
        time.sleep(0.25)
    raise RuntimeError("owner_return_to_desktop_timeout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observe-greeter", action="store_true", required=True)
    parser.parse_args()
    report = {"schema": 1, "platform": "linux", "status": "greeter_focus_not_observed",
              "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "sessionHelperSha256": SESSION_SHA256, "inputTested": False,
              "captureTested": False, "preLoginTested": False, "readyForUnattended": False}

    def interrupted(_signal, _frame):
        raise RuntimeError("observation_interrupted_or_timeout")

    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    signal.alarm(180)
    try:
        observe(report)
    except Exception as error:
        report["reason"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        signal.alarm(0)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["status"] == "greeter_focus_metadata_observed_not_certified" else 3


if __name__ == "__main__":
    sys.exit(main())
