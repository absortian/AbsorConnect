#!/usr/bin/env python3
"""Comprueba X11; --capture cuenta imágenes de una región sin guardarlas ni transmitirlas."""
import argparse
import ctypes
import ctypes.util
import json
import os
from pathlib import Path
import platform
import shlex
import subprocess
import time


def capture_region(x11, display):
    """Muestrea una región central pequeña; no prueba captura de toda la pantalla."""
    x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
    x11.XDefaultScreen.restype = ctypes.c_int
    x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XRootWindow.restype = ctypes.c_ulong
    x11.XDisplayWidth.argtypes = x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayWidth.restype = x11.XDisplayHeight.restype = ctypes.c_int
    x11.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int,
                             ctypes.c_int, ctypes.c_uint, ctypes.c_uint,
                             ctypes.c_ulong, ctypes.c_int]
    x11.XGetImage.restype = ctypes.c_void_p
    x11.XGetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    x11.XGetPixel.restype = ctypes.c_ulong
    x11.XDestroyImage.argtypes = [ctypes.c_void_p]
    x11.XDestroyImage.restype = ctypes.c_int
    screen = x11.XDefaultScreen(display)
    width, height = x11.XDisplayWidth(display, screen), x11.XDisplayHeight(display, screen)
    if width < 128 or height < 72:
        return {"captureTested": False, "status": "display_too_small"}
    root = x11.XRootWindow(display, screen)
    frames, varied = 0, 0
    started = time.monotonic()
    while time.monotonic() - started < 2:
        image = x11.XGetImage(display, root, (width - 128) // 2, (height - 72) // 2,
                             128, 72, ctypes.c_ulong(-1).value, 2)
        if not image:
            return {"captureTested": False, "status": "xgetimage_failed"}
        try:
            first = x11.XGetPixel(image, 0, 0)
            if any(x11.XGetPixel(image, x, y) != first
                   for x in range(0, 128, 8) for y in range(0, 72, 8)):
                varied += 1
            frames += 1
        finally:
            x11.XDestroyImage(image)
        time.sleep(0.2)
    return {"captureTested": frames > 0, "captureApi": "XGetImage",
            "captureRegion": [128, 72], "frames": frames, "nonUniformFrames": varied,
            "status": "region_capture_ok_not_certified"}


def check_pointer(x11, display, session, display_name):
    """Ensayo explícito en X11 del propio usuario: movimiento acotado, sin clics ni teclas."""
    report = {"pointerTested": False, "moveObserved": False, "restoreObserved": False,
              "requestedDistancePixels": 8, "keyboardTested": False}
    if (session.get("Type") != "x11" or session.get("State") != "active"
            or session.get("LockedHint") != "no" or session.get("User") != str(os.getuid())
            or session.get("Display") != display_name):
        return {**report, "status": "active_own_unlocked_x11_required"}
    xtst = ctypes.CDLL(ctypes.util.find_library("Xtst") or "libXtst.so.6")
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeMotionEvent.restype = ctypes.c_int
    x11.XDefaultScreen.argtypes = [ctypes.c_void_p]
    x11.XDefaultScreen.restype = ctypes.c_int
    x11.XRootWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XRootWindow.restype = ctypes.c_ulong
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayWidth.restype = ctypes.c_int
    x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong,
                                 ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
                                 *([ctypes.POINTER(ctypes.c_int)] * 4), ctypes.POINTER(ctypes.c_uint)]
    x11.XQueryPointer.restype = ctypes.c_int
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    screen = x11.XDefaultScreen(display)
    root = x11.XRootWindow(display, screen)
    def query():
        root_return, child = ctypes.c_ulong(), ctypes.c_ulong()
        x, y, child_x, child_y, mask = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_uint()
        if not x11.XQueryPointer(display, root, ctypes.byref(root_return), ctypes.byref(child),
                                ctypes.byref(x), ctypes.byref(y), ctypes.byref(child_x),
                                ctypes.byref(child_y), ctypes.byref(mask)):
            raise RuntimeError("pointer_position_unavailable")
        return x.value, y.value, mask.value
    x, y, mask = query()
    if mask & 0x1F00:
        return {**report, "status": "pressed_mouse_button_prevents_probe"}
    width = x11.XDisplayWidth(display, screen)
    if width < 20 or not 0 <= x < width:
        return {**report, "status": "pointer_outside_display"}
    target_x = x + 8 if x + 8 < width else x - 8
    try:
        report["pointerTested"] = bool(xtst.XTestFakeMotionEvent(display, screen, target_x, y, 0))
        x11.XSync(display, False)
        time.sleep(0.2)
        observed_x, observed_y, _ = query()
        report["moveObserved"] = (observed_x, observed_y) == (target_x, y)
    finally:
        xtst.XTestFakeMotionEvent(display, screen, x, y, 0)
        x11.XSync(display, False)
    time.sleep(0.2)
    restored_x, restored_y, _ = query()
    report["restoreObserved"] = (restored_x, restored_y) == (x, y)
    report["status"] = ("pointer_ok_not_certified" if report["pointerTested"] and report["moveObserved"]
                        and report["restoreObserved"] else "pointer_not_verified")
    return report


def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def properties(text):
    return dict(line.split("=", 1) for line in (text or "").splitlines() if "=" in line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--display", help="Display X11 que se va a comprobar, por ejemplo :0")
    parser.add_argument("--authority", help="Fichero Xauthority del usuario; nunca se muestra su contenido")
    parser.add_argument("--capture", action="store_true", help="Cuenta imágenes durante dos segundos sin guardarlas")
    parser.add_argument("--pointer", action="store_true", help="Mueve ocho píxeles y restaura el puntero, sin clics ni teclas")
    args = parser.parse_args()
    if args.authority:
        os.environ["XAUTHORITY"] = args.authority
    distribution = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            if key in {"ID", "VERSION_ID", "PRETTY_NAME"}:
                tokens = shlex.split(value)
                distribution[key] = tokens[0] if tokens else ""
    seat = properties(command("loginctl", "show-seat", "seat0", "-p", "ActiveSession"))
    session_id = seat.get("ActiveSession")
    session = {}
    if session_id:
        session = properties(command(
            "loginctl", "show-session", session_id, "-p", "Type", "-p", "Desktop",
            "-p", "State", "-p", "LockedHint", "-p", "Display", "-p", "User"))
    manager = properties(command(
        "systemctl", "show", "display-manager", "-p", "Id", "-p", "ActiveState"))
    display_name = args.display or os.environ.get("DISPLAY") or session.get("Display")
    report = {
        "schema": 2, "platform": "linux", "architecture": platform.machine(),
        "distribution": distribution, "session": session, "displayManager": manager,
        "processUid": os.getuid(), "x11Connected": False,
        "xtestAvailable": False, "captureTested": False, "inputTested": False,
        "pointerRequested": args.pointer, "keyboardTested": False,
        "preLoginTested": False, "readyForUnattended": False,
        "status": "probe_only_not_certified",
    }
    # XOpenDisplay solo autentica una conexión local existente; no cambia el control de acceso.
    if display_name:
        try:
            x11 = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
            x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
            x11.XOpenDisplay.restype = ctypes.c_void_p
            x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
            x11.XQueryExtension.argtypes = [ctypes.c_void_p, ctypes.c_char_p,
                                          ctypes.POINTER(ctypes.c_int),
                                          ctypes.POINTER(ctypes.c_int),
                                          ctypes.POINTER(ctypes.c_int)]
            display = x11.XOpenDisplay(display_name.encode())
            if display:
                try:
                    opcode, event, error = ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
                    report["x11Connected"] = True
                    report["xtestAvailable"] = bool(x11.XQueryExtension(
                        display, b"XTEST", ctypes.byref(opcode), ctypes.byref(event),
                        ctypes.byref(error)))
                    if args.capture:
                        report.update(capture_region(x11, display))
                    if args.pointer and report["xtestAvailable"]:
                        report["pointer"] = check_pointer(x11, display, session, display_name)
                        report["inputTested"] = report["pointer"]["pointerTested"]
                        report["inputScope"] = "pointer_movement_only"
                finally:
                    x11.XCloseDisplay(display)
        except OSError:
            report["status"] = "missing_x11_library"
        except RuntimeError as error:
            report["status"] = str(error)
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
