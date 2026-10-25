#!/usr/bin/env python3
"""Prueba explícita de XTest en una ventana propia del usuario Mint, sin texto guardado."""
import argparse
import ctypes as c
import ctypes.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
    if result.returncode:
        raise RuntimeError("session_query_failed")
    return result.stdout.strip()


def properties(*args):
    return dict(line.split("=", 1) for line in command(*args).splitlines() if "=" in line)


def context():
    if os.getuid() == 0:
        raise RuntimeError("unprivileged_user_required")
    identifier = properties("/usr/bin/loginctl", "show-seat", "seat0", "-p", "ActiveSession").get("ActiveSession")
    if not identifier:
        raise RuntimeError("active_session_unavailable")
    session = properties("/usr/bin/loginctl", "show-session", identifier, "-p", "User",
                         "-p", "Type", "-p", "Class", "-p", "State", "-p", "Display", "-p", "LockedHint")
    if (session.get("User") != str(os.getuid()) or session.get("Type") != "x11"
            or session.get("Class") != "user" or session.get("State") != "active"
            or session.get("LockedHint") != "no" or session.get("Display") != ":0"):
        raise RuntimeError("own_unlocked_x11_session_required")
    state = command("/usr/bin/gdbus", "call", "--session", "--dest", "org.cinnamon.ScreenSaver",
                    "--object-path", "/org/cinnamon/ScreenSaver", "--method", "org.cinnamon.ScreenSaver.GetActive")
    if state != "(false,)":
        raise RuntimeError("inactive_cinnamon_screensaver_required")
    return identifier, session


def run():
    if os.getuid() == 0:
        raise RuntimeError("unprivileged_user_required")
    # Solo se abre la autoridad privada del usuario actual; no se copian cookies ni se usa xhost.
    authority = Path.home() / ".Xauthority"
    info = authority.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("private_user_authority_required")
    os.environ.update(DISPLAY=":0", XAUTHORITY=str(authority), GDK_BACKEND="x11",
                      DBUS_SESSION_BUS_ADDRESS=f"unix:path=/run/user/{os.getuid()}/bus")
    initial = context()
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("GdkX11", "3.0")
    from gi.repository import Gtk, Gdk, GdkX11
    if not Gtk.init_check([])[0] or not isinstance(Gdk.Display.get_default(), GdkX11.X11Display):
        raise RuntimeError("gtk_x11_display_required")

    x11 = c.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
    xtst = c.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    def bind(lib, name, result, *args):
        function = getattr(lib, name)
        function.restype, function.argtypes = result, list(args)
        return function
    ptr, win, integer, unsigned = c.c_void_p, c.c_ulong, c.c_int, c.c_uint
    pi, pw = c.POINTER(integer), c.POINTER(win)
    bind(x11, "XOpenDisplay", ptr, c.c_char_p)
    bind(x11, "XCloseDisplay", integer, ptr)
    bind(x11, "XDefaultScreen", integer, ptr)
    bind(x11, "XRootWindow", win, ptr, integer)
    bind(x11, "XGetInputFocus", integer, ptr, pw, pi)
    bind(x11, "XQueryKeymap", integer, ptr, c.c_char_p)
    bind(x11, "XQueryPointer", integer, ptr, win, pw, pw, pi, pi, pi, pi, c.POINTER(unsigned))
    bind(x11, "XTranslateCoordinates", integer, ptr, win, win, integer, integer, pi, pi, pw)
    bind(x11, "XQueryTree", integer, ptr, win, pw, pw, c.POINTER(pw), c.POINTER(unsigned))
    bind(x11, "XFree", integer, ptr)
    bind(x11, "XSync", integer, ptr, integer)
    bind(x11, "XKeysymToKeycode", c.c_ubyte, ptr, c.c_ulong)
    bind(xtst, "XTestQueryExtension", integer, ptr, pi, pi, pi, pi)
    bind(xtst, "XTestFakeMotionEvent", integer, ptr, integer, integer, integer, c.c_ulong)
    bind(xtst, "XTestFakeButtonEvent", integer, ptr, unsigned, integer, c.c_ulong)
    bind(xtst, "XTestFakeKeyEvent", integer, ptr, unsigned, integer, c.c_ulong)
    display = x11.XOpenDisplay(b":0")
    if not display:
        raise RuntimeError("x11_connection_failed")
    window, original, target, moved, restored = None, None, None, False, False
    counts = {"mouseDown": 0, "mouseUp": 0, "keyDown": 0, "keyUp": 0, "unexpectedEvents": 0}
    def pump(duration=0.05):
        until = time.monotonic() + duration
        while time.monotonic() < until:
            while Gtk.events_pending() and time.monotonic() < until:
                Gtk.main_iteration_do(False)
            time.sleep(0.005)
    def focus():
        value, revert = win(), integer()
        x11.XGetInputFocus(display, c.byref(value), c.byref(revert))
        return value.value
    def pointer():
        root_return, child = win(), win()
        x, y, relative_x, relative_y, mask = integer(), integer(), integer(), integer(), unsigned()
        if not x11.XQueryPointer(display, root, c.byref(root_return), c.byref(child), c.byref(x),
                                 c.byref(y), c.byref(relative_x), c.byref(relative_y), c.byref(mask)):
            raise RuntimeError("pointer_unavailable")
        return x.value, y.value, mask.value, child.value
    def no_held_input():
        keys = c.create_string_buffer(32)
        x11.XQueryKeymap(display, keys)
        if any(keys.raw) or pointer()[2] & 0x1F00:
            raise RuntimeError("held_input_prevents_probe")
    def guard():
        if context() != initial:
            raise RuntimeError("original_user_session_required")
        if focus() not in owned_windows:
            raise RuntimeError("own_native_focus_required")
        if not area.has_focus():
            raise RuntimeError("own_gtk_focus_required")
        no_held_input()
    def pulse(function, code):
        # Difiere la cancelación solo durante el par, para no dejar teclas/botones retenidos.
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGTERM})
        try:
            try:
                if not function(display, code, True, 0):
                    raise RuntimeError("press_injection_failed")
                x11.XSync(display, False)
            finally:
                if not function(display, code, False, 0):
                    raise RuntimeError("release_injection_failed")
                x11.XSync(display, False)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)
    try:
        extension = [integer() for _ in range(4)]
        if not xtst.XTestQueryExtension(display, *(c.byref(v) for v in extension)):
            raise RuntimeError("xtest_required")
        screen = x11.XDefaultScreen(display)
        root = x11.XRootWindow(display, screen)
        original_focus, original = focus(), pointer()[:2]
        no_held_input()
        keycode = x11.XKeysymToKeycode(display, 0x61)
        if not keycode:
            raise RuntimeError("fixed_test_key_unavailable")
        window = Gtk.Window(title="AbsorConnect: prueba local de entrada")
        window.set_default_size(340, 180)
        window.set_position(Gtk.WindowPosition.MOUSE)
        area = Gtk.DrawingArea()
        area.set_can_focus(True)
        area.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK |
                        Gdk.EventMask.KEY_PRESS_MASK | Gdk.EventMask.KEY_RELEASE_MASK)
        def receive(_widget, event, name):
            expected = event.button == 1 if name.startswith("mouse") else event.hardware_keycode == keycode
            if expected and not event.send_event:
                counts[name] += 1
            else:
                counts["unexpectedEvents"] += 1
            return True
        for event, name in (("button-press-event", "mouseDown"), ("button-release-event", "mouseUp"),
                            ("key-press-event", "keyDown"), ("key-release-event", "keyUp")):
            area.connect(event, receive, name)
        window.add(area)
        window.show_all()
        window.present()
        area.grab_focus()
        xid = window.get_window().get_xid()
        # GTK puede enfocar un hijo InputOnly interno, no el XID de la ventana principal.
        owned_windows, pending = set(), [xid]
        while pending:
            if len(owned_windows) >= 64:
                raise RuntimeError("own_window_tree_limit")
            current = pending.pop()
            if current in owned_windows:
                continue
            owned_windows.add(current)
            root_return, parent, children, size = win(), win(), pw(), unsigned()
            if not x11.XQueryTree(display, current, c.byref(root_return), c.byref(parent), c.byref(children), c.byref(size)):
                raise RuntimeError("own_window_tree_unavailable")
            try:
                pending.extend(children[index] for index in range(size.value))
            finally:
                if children:
                    x11.XFree(children)
        deadline = time.monotonic() + 3
        while focus() not in owned_windows and time.monotonic() < deadline:
            pump()
        guard()
        native_focus_was_child = focus() != xid
        # Jerarquía opaca de nuestra ventana para evitar clics sobre otra ventana superpuesta.
        ancestors, current = set(), xid
        for _ in range(16):
            if current == root:
                break
            ancestors.add(current)
            root_return, parent, children, size = win(), win(), pw(), unsigned()
            if not x11.XQueryTree(display, current, c.byref(root_return), c.byref(parent), c.byref(children), c.byref(size)):
                raise RuntimeError("own_window_hierarchy_unavailable")
            if children:
                x11.XFree(children)
            current = parent.value
        x, y, child = integer(), integer(), win()
        if not x11.XTranslateCoordinates(display, xid, root, 170, 90, c.byref(x), c.byref(y), c.byref(child)):
            raise RuntimeError("own_window_position_unavailable")
        target = x.value, y.value
        if not xtst.XTestFakeMotionEvent(display, screen, *target, 0):
            raise RuntimeError("pointer_injection_failed")
        moved = True
        x11.XSync(display, False)
        pump()
        guard()
        position = pointer()
        if position[:2] != target or position[3] not in ancestors:
            raise RuntimeError("own_pointer_target_required")
        # Cada pulsación tiene liberación garantizada; no hay campo de texto ni acción de botón.
        pulse(xtst.XTestFakeButtonEvent, 1)
        pump()
        guard()
        pulse(xtst.XTestFakeKeyEvent, keycode)
        pump(0.2)
        guard()
        if counts != {"mouseDown": 1, "mouseUp": 1, "keyDown": 1, "keyUp": 1, "unexpectedEvents": 0}:
            raise RuntimeError("native_reception_not_verified")
        if pointer()[:2] != target:
            raise RuntimeError("pointer_changed_during_probe")
        if not xtst.XTestFakeMotionEvent(display, screen, *original, 0):
            raise RuntimeError("pointer_restore_failed")
        x11.XSync(display, False)
        restored = pointer()[:2] == original
        if not restored:
            raise RuntimeError("pointer_restore_not_observed")
        window.destroy()
        window = None
        pump(0.2)
        return {"schema": 1, "platform": "linux", "status": "own_window_input_verified_not_certified",
                "target": "own_window_same_process", "senderProfile": "unprivileged_console_user",
                "inputApi": "XTest", "receptionObservedBy": "gtk_native_event_callbacks", "counts": counts,
                "pointerRestored": restored, "previousFocusRestoredObserved": focus() == original_focus,
                "nativeFocusWasOwnedChild": native_focus_was_child,
                "inputTested": True, "captureTested": False, "polkitTested": False,
                "preLoginTested": False, "readyForUnattended": False}
    finally:
        try:
            if moved and not restored and window is not None:
                # No disputa el puntero si interviene el usuario o cambia de sesión/foco.
                if context() == initial and focus() in owned_windows and pointer()[:2] == target and not pointer()[2] & 0x1F00:
                    xtst.XTestFakeMotionEvent(display, screen, *original, 0)
                    x11.XSync(display, False)
        finally:
            try:
                if window is not None:
                    window.destroy()
                    pump()
            finally:
                x11.XCloseDisplay(display)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test-own-input", action="store_true", required=True,
                        help="Crea una ventana propia y comprueba un clic y una pulsación, con liberaciones.")
    parser.parse_args()
    def interrupted(_signal, _frame):
        raise RuntimeError("probe_interrupted_or_timeout")
    signal.signal(signal.SIGALRM, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    signal.alarm(20)
    try:
        report = run()
    except (RuntimeError, OSError, ValueError, ImportError, subprocess.TimeoutExpired) as error:
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        report = {"schema": 1, "platform": "linux", "status": "own_window_input_not_verified",
                  "reason": reason, "inputTested": False, "readyForUnattended": False}
    finally:
        signal.alarm(0)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return 0 if report["inputTested"] else 3


if __name__ == "__main__":
    sys.exit(main())
