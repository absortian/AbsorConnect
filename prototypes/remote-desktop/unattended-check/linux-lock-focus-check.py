#!/usr/bin/env python3
"""Observa bloqueo/desbloqueo de Mint y metadatos iniciales de foco, sin enviar entrada."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import time
import types


DEPENDENCIES = {
    "linux-owned-input-check.py": "948e62402572c0a517ab1a16b5d2a1f7af9ddc76dd81ac57ada3d4e4379a16ce",
    "linux-polkit-focus-check.py": "5e698b3110a4bb433b1cc05fca4a186c1fd31c127ae4b5da9fb7f1d23d843e86",
}


def load_helpers():
    if os.getuid() == 0:
        raise RuntimeError("unprivileged_observer_required")
    directory = Path(__file__).absolute().parent
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("private_user_lab_directory_required")
    modules = []
    for name, digest in DEPENDENCIES.items():
        path = directory / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise RuntimeError("owned_helper_required")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError("pinned_helper_required")
        module = types.ModuleType("absor_lock_" + str(len(modules)))
        module.__file__ = str(path)
        exec(compile(data, str(path), "exec"), module.__dict__)
        modules.append(module)
    return directory, modules


def observe(report, event, helper, focus, inventory_only=False):
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi, Gio, GLib
    Atspi.set_timeout(500, 1500)
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(destination, path, interface, method, parameters, result_type):
        return bus.call_sync(destination, path, interface, method, parameters,
                             GLib.VariantType.new(result_type), Gio.DBusCallFlags.NONE, 2000, None).unpack()[0]

    def active():
        return call("org.cinnamon.ScreenSaver", "/org/cinnamon/ScreenSaver",
                    "org.cinnamon.ScreenSaver", "GetActive", None, "(b)")

    def session():
        identifier = helper.properties("/usr/bin/loginctl", "show-seat", "seat0", "-p", "ActiveSession").get("ActiveSession")
        if not identifier:
            raise RuntimeError("active_session_required")
        value = helper.properties("/usr/bin/loginctl", "show-session", identifier, "-p", "User", "-p", "Type",
                                  "-p", "Class", "-p", "State", "-p", "Display")
        if (value.get("User") != str(os.getuid()) or value.get("Type") != "x11" or value.get("Class") != "user"
                or value.get("State") != "active" or value.get("Display") != ":0"):
            raise RuntimeError("own_active_x11_session_required")
        return identifier, value

    def snapshot():
        name = GLib.Variant("(s)", ("org.cinnamon.ScreenSaver",))
        pid = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                   "GetConnectionUnixProcessID", name, "(u)")
        uid = call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                   "GetConnectionUnixUser", name, "(u)")
        if uid != os.getuid() or (Path("/proc") / str(pid)).stat().st_uid != uid:
            raise RuntimeError("screensaver_bus_owner_mismatch")
        desktop = Atspi.get_desktop(0)
        size = desktop.get_child_count()
        if size > 64:
            raise RuntimeError("accessible_application_limit")
        applications = []
        for index in range(size):
            app = desktop.get_child_at_index(index)
            try:
                if app.get_process_id() == pid:
                    applications.append(app)
            except GLib.Error:
                # Un proxy ajeno puede desaparecer; no se consulta su contenido.
                continue
        if len(applications) > 1:
            raise RuntimeError("unique_screensaver_application_required")
        value = {"busOwnerVerified": True, "accessibleApplicationCount": len(applications),
                 "showingPasswordFields": 0, "focusedPasswordFields": 0, "focusedRoleCounts": {}}
        if not applications:
            return value
        app = applications[0]
        app.clear_cache()
        # Reutiliza solo las consultas limitadas de metadatos del auxiliar fijado.
        reader = focus.FocusObserver.__new__(focus.FocusObserver)
        reader.api, reader.application = Atspi, app
        passwords = reader.matches(app, [Atspi.StateType.SHOWING], [Atspi.Role.PASSWORD_TEXT])
        focused = reader.matches(app, [Atspi.StateType.FOCUSED, Atspi.StateType.SHOWING], [])
        value["showingPasswordFields"] = len(passwords)
        for node in focused:
            role = node.get_role()
            key = str(int(role))
            value["focusedRoleCounts"][key] = value["focusedRoleCounts"].get(key, 0) + 1
            value["focusedPasswordFields"] += int(role == Atspi.Role.PASSWORD_TEXT)
        return value

    initial = session()
    if active():
        raise RuntimeError("initial_unlocked_desktop_required")
    report["beforeLock"] = snapshot()
    if inventory_only:
        report["status"] = "lock_focus_inventory_only"
        return
    event("waiting_for_owner_lock")
    deadline = time.monotonic() + 180
    locked = False
    while time.monotonic() < deadline:
        state = active()
        if state and not locked:
            if session() != initial:
                raise RuntimeError("original_user_session_required")
            locked = True
            report["lockedStateObserved"] = True
            event("screensaver_active")
        if state and locked and "lockedFocus" not in report:
            value = snapshot()
            report.setdefault("firstLockedSnapshot", value)
            if value["focusedPasswordFields"] == 1:
                report["lockedFocus"] = value
                event("locked_password_focus_observed")
                # Desde aquí solo consulta GetActive hasta desbloquear: nada de foco al escribir.
        if locked and not state:
            if session() != initial:
                raise RuntimeError("original_user_session_required")
            report["unlockedStateObserved"] = True
            report["afterUnlock"] = snapshot()
            report["status"] = ("lock_focus_metadata_observed_not_certified" if "lockedFocus" in report
                                else "lock_transition_observed_focus_unavailable")
            return
        time.sleep(0.25)
    raise RuntimeError("owner_lock_transition_timeout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observe-lock", action="store_true", required=True)
    parser.add_argument("--inventory-only", action="store_true",
                        help="Solo comprueba el contexto inicial, sin esperar bloqueo ni guardar archivos.")
    args = parser.parse_args()
    report = {"schema": 1, "platform": "linux", "status": "lock_focus_not_observed",
              "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "inputTested": False, "captureTested": False, "readyForUnattended": False}
    output, journal = None, None

    def interrupted(_signal, _frame):
        raise RuntimeError("observation_interrupted_or_timeout")

    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    signal.alarm(195)
    try:
        directory, (helper, focus) = load_helpers()
        os.environ.update(DISPLAY=":0", DBUS_SESSION_BUS_ADDRESS=f"unix:path=/run/user/{os.getuid()}/bus")
        if not args.inventory_only:
            output = os.fdopen(os.open(directory / "lock-focus-results.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")
            journal = os.fdopen(os.open(directory / "lock-focus-events.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")

        def event(name):
            value = json.dumps({"event": name})
            if journal is not None:
                journal.write(value + "\n")
                journal.flush()
            print(value, flush=True)

        observe(report, event, helper, focus, args.inventory_only)
    except Exception as error:
        report["reason"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        signal.alarm(0)
        if output is not None:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.close()
        if journal is not None:
            journal.close()
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["status"] in ("lock_focus_metadata_observed_not_certified", "lock_focus_inventory_only") and "reason" not in report else 3


if __name__ == "__main__":
    sys.exit(main())
