#!/usr/bin/env python3
"""Ensayo coordinado Cinnamon → LightDM → Cinnamon, sin entrada ni cambios del sistema."""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


def properties(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
    if result.returncode:
        raise RuntimeError("session_query_failed")
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def context():
    seat = properties("/usr/bin/loginctl", "show-seat", "seat0", "-p", "ActiveSession")
    identifier = seat.get("ActiveSession", "")
    if not identifier:
        raise RuntimeError("active_session_unavailable")
    session = properties("/usr/bin/loginctl", "show-session", identifier, "-p", "Type",
                         "-p", "Class", "-p", "State", "-p", "User", "-p", "Display",
                         "-p", "LockedHint")
    if session.get("Type") != "x11" or session.get("State") != "active":
        raise RuntimeError("active_x11_session_required")
    return identifier, session


def authority_for(display):
    if not display.startswith(":") or not display[1:].isdigit():
        raise RuntimeError("explicit_x11_display_required")
    candidates = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if proc.stat().st_uid != 0 or (proc / "comm").read_text().strip() != "Xorg":
                continue
            args = (proc / "cmdline").read_bytes().decode().rstrip("\0").split("\0")
            if display not in args or "-auth" not in args:
                continue
            path = Path(args[args.index("-auth") + 1])
            metadata = path.lstat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o077:
                continue
            # La ruta y sus padres deben estar bajo control de root; nunca xhost ni cookies copiadas.
            if not path.is_absolute() or any(parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022
                                             for parent in path.parents):
                continue
            candidates.append(path)
        except (OSError, ValueError, UnicodeError, IndexError):
            continue
    if len(candidates) != 1:
        raise RuntimeError("unique_private_root_authority_required")
    return candidates[0]


def sample(expected):
    identifier, session = expected
    authority = authority_for(session.get("Display", ""))
    env = {"PATH": "/usr/bin:/bin", "XAUTHORITY": str(authority),
           "DISPLAY": session["Display"], "LANG": "C.UTF-8"}
    child = Path(__file__).with_name("linux-probe.py")
    result = subprocess.run([sys.executable, "-I", str(child), "--capture", "--display", session["Display"]],
                            env=env, capture_output=True, text=True, timeout=12, check=False)
    if result.returncode:
        raise RuntimeError("capture_worker_failed")
    report = json.loads(result.stdout)
    if context() != expected:
        raise RuntimeError("session_changed_during_capture")
    if not report.get("captureTested") or not report.get("x11Connected") or report.get("inputTested"):
        raise RuntimeError("capture_not_verified")
    return {"sessionClass": session.get("Class"), "sessionType": session["Type"],
            "locked": session.get("LockedHint") == "yes", "authorityRootPrivate": True,
            "captureApi": report["captureApi"], "captureRegion": report["captureRegion"],
            "frames": report["frames"], "nonUniformFrames": report["nonUniformFrames"],
            "captureTested": True, "inputTested": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture-transitions", action="store_true", required=True,
                        help="Cuenta imágenes durante dos segundos en cada contexto; exige coordinación local.")
    parser.parse_args()
    if os.getuid() != 0:
        parser.exit(4, "Se necesita root para este ensayo coordinado.\n")
    started = time.monotonic()
    stages = []
    try:
        initial = context()
        if initial[1].get("Class") != "user" or initial[1].get("LockedHint") != "no":
            raise RuntimeError("start_in_unlocked_user_session_required")
        first_user = initial[1].get("User")
        first = sample(initial)
        stages.append({"stage": "desktop", "report": first})
        print(json.dumps({"event": "desktop_captured", "report": first}), flush=True)
        expected = "greeter"
        while time.monotonic() - started < 300:
            time.sleep(0.5)
            try:
                current = context()
            except RuntimeError:
                continue
            session = current[1]
            if session.get("Class") != expected:
                continue
            if expected == "user" and (session.get("User") != first_user or session.get("LockedHint") != "no"
                                        or current[0] == initial[0]):
                continue
            try:
                report = sample(current)
            except RuntimeError:
                continue
            stage = "greeter" if expected == "greeter" else "returned_desktop"
            stages.append({"stage": stage, "report": report})
            print(json.dumps({"event": stage + "_captured", "report": report}), flush=True)
            if expected == "user":
                print(json.dumps({"schema": 1, "platform": "linux", "status": "transition_capture_ok_not_certified",
                                  "elapsedMilliseconds": round((time.monotonic() - started) * 1000),
                                  "stages": stages, "inputTested": False, "polkitTested": False,
                                  "preLoginTested": False, "readyForUnattended": False}), flush=True)
                return 0
            expected = "user"
        raise RuntimeError("transition_timeout")
    except (RuntimeError, subprocess.TimeoutExpired, OSError, ValueError, KeyError) as error:
        # No publica stderr del SDK, rutas de Xauthority, cookies ni contenido de pantalla.
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({"schema": 1, "platform": "linux", "status": "transition_not_verified",
                          "reason": reason, "stages": stages, "inputTested": False,
                          "readyForUnattended": False}), flush=True)
        return 3


if __name__ == "__main__":
    sys.exit(main())
