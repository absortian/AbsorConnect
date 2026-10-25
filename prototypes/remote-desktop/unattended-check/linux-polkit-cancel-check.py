#!/usr/bin/env python3
"""Ensayo Mint: Escape desde root cancela una solicitud propia de polkit sin credenciales."""
import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import stat
import subprocess
import sys
import time
import types


SESSION_SHA256 = "40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275"

# pkexec autoriza al proceso padre. El solicitante debe tener padre de usuario,
# no el supervisor root que solo envía Escape. No admite órdenes externas.
REQUESTER_WORKER = r'''
import os, signal, subprocess, sys
if os.getuid() == 0:
    sys.exit(3)
requester = None
result = 3
def stop(_signal, _frame):
    raise InterruptedError()
for number in (signal.SIGTERM, signal.SIGINT):
    signal.signal(number, stop)
try:
    requester = subprocess.Popen(["/usr/bin/pkexec", "--disable-internal-agent", "/usr/bin/true"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = requester.wait(timeout=20)
except (InterruptedError, subprocess.TimeoutExpired):
    pass
finally:
    if requester is not None and requester.poll() is None:
        requester.terminate()
        try:
            requester.wait(timeout=2)
        except subprocess.TimeoutExpired:
            requester.kill()
            requester.wait(timeout=2)
sys.exit(result)
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
    module = types.ModuleType("absor_polkit_cancel_session")
    module.__file__ = str(helper)
    exec(compile(data, str(helper), "exec"), module.__dict__)
    return module


def run(observation):
    helper = session_helper()
    initial = helper.context()
    session = initial[1]
    uid = int(session["User"])
    if (uid <= 0 or session.get("Class") != "user" or session.get("LockedHint") != "no"
            or session.get("Display") != ":0" or helper.cinnamon_active(session)):
        raise RuntimeError("unlocked_cinnamon_user_required")
    account = pwd.getpwuid(uid)
    user_authority = Path(account.pw_dir) / ".Xauthority"
    info = user_authority.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise RuntimeError("private_user_authority_required")
    for path in (Path("/usr/bin/pkexec"), Path("/usr/bin/true"), Path("/usr/bin/cinnamon")):
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
    bind(x11, "XQueryTree", integer, ptr, win, pw, pw, c.POINTER(pw), c.POINTER(unsigned))
    bind(x11, "XInternAtom", win, ptr, c.c_char_p, integer)
    bind(x11, "XGetWindowProperty", integer, ptr, win, win, c.c_long, c.c_long, integer, win,
         pw, pi, pw, pw, c.POINTER(ptr))
    bind(x11, "XFree", integer, ptr)
    bind(x11, "XQueryKeymap", integer, ptr, c.c_char_p)
    bind(x11, "XQueryPointer", integer, ptr, win, pw, pw, pi, pi, pi, pi, c.POINTER(unsigned))
    bind(x11, "XKeysymToKeycode", c.c_ubyte, ptr, win)
    bind(x11, "XSync", integer, ptr, integer)
    bind(xtst, "XTestQueryExtension", integer, ptr, pi, pi, pi, pi)
    bind(xtst, "XTestFakeKeyEvent", integer, ptr, unsigned, integer, win)
    display = x11.XOpenDisplay(b":0")
    if not display:
        raise RuntimeError("root_x11_connection_failed")
    requester = None
    try:
        root = x11.XDefaultRootWindow(display)
        atom = x11.XInternAtom(display, b"_NET_WM_PID", True)
        if not atom:
            raise RuntimeError("window_pid_atom_required")

        def focus():
            value, revert = win(), integer()
            x11.XGetInputFocus(display, c.byref(value), c.byref(revert))
            return value.value

        def focus_pid():
            window = focus()
            for _ in range(16):
                if window in (0, 1, root):
                    return None
                actual, format_, items, remaining, data = win(), integer(), win(), win(), ptr()
                try:
                    status = x11.XGetWindowProperty(display, window, atom, 0, 1, False, 6,
                                                   c.byref(actual), c.byref(format_), c.byref(items),
                                                   c.byref(remaining), c.byref(data))
                    if status != 0:
                        raise RuntimeError("focus_property_failed")
                    if actual.value == 6 and format_.value == 32 and items.value == 1 and remaining.value == 0 and data:
                        return c.cast(data, pw)[0] & 0xFFFFFFFF
                finally:
                    if data:
                        x11.XFree(data)
                rr, parent, children, size = win(), win(), pw(), unsigned()
                if not x11.XQueryTree(display, window, c.byref(rr), c.byref(parent), c.byref(children), c.byref(size)):
                    raise RuntimeError("focus_tree_failed")
                if children:
                    x11.XFree(children)
                window = parent.value
            raise RuntimeError("focus_tree_limit")

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

        def context_guard():
            if helper.context() != initial or helper.cinnamon_active(session):
                raise RuntimeError("original_unlocked_session_required")
            process = Path("/proc") / str(cinnamon_pid)
            if process.stat().st_uid != uid or (process / "exe").resolve() != Path("/usr/bin/cinnamon"):
                raise RuntimeError("cinnamon_identity_changed")

        extension = [integer() for _ in range(4)]
        if not xtst.XTestQueryExtension(display, *(c.byref(value) for value in extension)):
            raise RuntimeError("xtest_required")
        escape = x11.XKeysymToKeycode(display, 0xFF1B)
        if not escape:
            raise RuntimeError("escape_key_unavailable")
        previous_focus = focus()
        if focus_pid() == cinnamon_pid:
            raise RuntimeError("baseline_cinnamon_focus_prevents_probe")
        idle("beforeRequest", 2)
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": account.pw_dir,
                       "DISPLAY": ":0", "XAUTHORITY": str(user_authority),
                       "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus"}
        # Conserva la sesión de Terminal de sudo y descarta UID, GID y grupos en el trabajador.
        requester = subprocess.Popen(["/usr/bin/python3", "-I", "-c", REQUESTER_WORKER],
                                     user=uid, group=account.pw_gid, extra_groups=[], env=environment,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)
        if requester.poll() is not None:
            observation["userWorkerExitCode"] = requester.returncode
            raise RuntimeError("request_ended_before_input")
        context_guard()
        idle("pendingRequest", 4)
        if (Path("/proc") / str(requester.pid)).stat().st_uid != uid:
            raise RuntimeError("user_requester_worker_required")
        pending = []
        for process in Path("/proc").iterdir():
            if not process.name.isdigit():
                continue
            try:
                if (process / "comm").read_text().strip() == "pkexec":
                    fields = dict(line.split(":", 1) for line in (process / "status").read_text().splitlines() if ":" in line)
                    pending.append(int(fields["PPid"].strip()) == requester.pid)
            except OSError:
                pass
        if pending != [True]:
            raise RuntimeError("exclusive_own_pkexec_required")
        if focus_pid() != cinnamon_pid:
            raise RuntimeError("pending_cinnamon_prompt_focus_required")
        if requester.poll() is not None:
            raise RuntimeError("request_ended_before_input")
        # No imprime, lee ni envía texto. Solo Escape con liberación incluso al interrumpir.
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGTERM, signal.SIGINT})
        try:
            try:
                if not xtst.XTestFakeKeyEvent(display, escape, True, 0):
                    raise RuntimeError("escape_press_failed")
                observation["escapePressSent"] = True
                x11.XSync(display, False)
            finally:
                if not xtst.XTestFakeKeyEvent(display, escape, False, 0):
                    raise RuntimeError("escape_release_failed")
                observation["escapeReleaseSent"] = True
                x11.XSync(display, False)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        try:
            exit_code = requester.wait(timeout=5)
        except subprocess.TimeoutExpired:
            raise RuntimeError("native_polkit_cancellation_not_observed") from None
        observation["userWorkerExitCode"] = exit_code
        context_guard()
        if exit_code != 126:
            raise RuntimeError("request_not_dismissed_with_expected_code")
        return {"schema": 1, "platform": "linux", "status": "polkit_escape_cancellation_verified_not_certified",
                "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "sessionHelperSha256": SESSION_SHA256, "senderRoot": True, "requesterParentUnprivileged": True,
                "fixedRequest": "pkexec --disable-internal-agent /usr/bin/true", "requesterExitCode": exit_code,
                "cinnamonFocusVerifiedBeforeInput": True, "escapePressSent": True, "escapeReleaseSent": True,
                "requesterExited": True, "noOpCompleted": False, "inputTested": True,
                "polkitCancellationTested": True, "polkitAuthenticationTested": False,
                "previousFocusRestoredObserved": focus() == previous_focus,
                "preLoginTested": False, "readyForUnattended": False}
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
            x11.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-polkit-cancel", action="store_true", required=True)
    parser.parse_args()

    def interrupted(_signal, _frame):
        raise RuntimeError("probe_interrupted_or_timeout")

    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT):
        signal.signal(number, interrupted)
    signal.alarm(30)
    observation = {"escapePressSent": False, "escapeReleaseSent": False}
    try:
        report = run(observation)
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        report = {"schema": 1, "platform": "linux", "status": "polkit_escape_cancellation_not_verified",
                  "reason": str(error) if isinstance(error, RuntimeError) else type(error).__name__,
                  "inputTested": False, "readyForUnattended": False}
    finally:
        signal.alarm(0)
    report.update(observation)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["inputTested"] else 3


if __name__ == "__main__":
    sys.exit(main())
