#!/usr/bin/env python3
"""Observa metadatos de foco de Cinnamon durante una solicitud propia; nunca envía entrada."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import types


CONTEXT_SHA256 = "948e62402572c0a517ab1a16b5d2a1f7af9ddc76dd81ac57ada3d4e4379a16ce"


class FocusObserver:
    def __init__(self):
        if os.getuid() == 0:
            raise RuntimeError("unprivileged_observer_required")
        candidates = []
        for process in Path("/proc").iterdir():
            if not process.name.isdigit():
                continue
            try:
                if process.stat().st_uid == os.getuid() and (process / "exe").resolve() == Path("/usr/bin/cinnamon"):
                    candidates.append(int(process.name))
            except OSError:
                pass
        if len(candidates) != 1:
            raise RuntimeError("unique_user_cinnamon_process_required")
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi
        self.api = Atspi
        Atspi.set_timeout(500, 1500)
        desktop = Atspi.get_desktop(0)
        applications = []
        count = desktop.get_child_count()
        if count > 64:
            raise RuntimeError("accessible_application_limit")
        for index in range(count):
            application = desktop.get_child_at_index(index)
            # Solo se consulta el PID de otras aplicaciones, nunca su contenido.
            if application.get_process_id() == candidates[0]:
                applications.append(application)
        if len(applications) != 1:
            raise RuntimeError("unique_cinnamon_accessible_application_required")
        self.application = applications[0]

    def matches(self, node, states, roles):
        api = self.api
        collection = node.get_collection_iface()
        if collection is None:
            raise RuntimeError("accessible_collection_required")
        rule = api.MatchRule.new(api.StateSet.new(states), api.CollectionMatchType.ALL,
                                 {}, api.CollectionMatchType.ALL, roles, api.CollectionMatchType.ANY,
                                 [], api.CollectionMatchType.ALL, False)
        values = collection.get_matches(rule, api.CollectionSortOrder.CANONICAL, 16, True)
        if len(values) >= 16:
            raise RuntimeError("accessible_result_limit")
        return values

    def snapshot(self):
        api = self.api
        self.application.clear_cache()
        dialogs = self.matches(self.application, [api.StateType.SHOWING], [api.Role.DIALOG])
        focused, passwords = 0, 0
        for dialog in dialogs:
            nodes = self.matches(dialog, [api.StateType.FOCUSED, api.StateType.SHOWING], [])
            focused += len(nodes)
            passwords += sum(node.get_role() == api.Role.PASSWORD_TEXT for node in nodes)
        # Ninguna lectura de nombres, textos, valores, acciones o códigos de teclas.
        return {"showingDialogCount": len(dialogs), "focusedDescendantsWithinDialogs": focused,
                "focusedPasswordFieldsWithinDialogs": passwords}


def load_context():
    if os.getuid() == 0:
        raise RuntimeError("unprivileged_observer_required")
    directory = Path(__file__).absolute().parent
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("private_user_lab_directory_required")
    path = directory / "linux-owned-input-check.py"
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise RuntimeError("owned_context_source_required")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != CONTEXT_SHA256:
        raise RuntimeError("context_helper_hash_mismatch")
    module = types.ModuleType("absor_polkit_focus_context")
    module.__file__ = str(path)
    exec(compile(data, str(path), "exec"), module.__dict__)
    return module


def observe(report):
    helper = load_context()
    uid = os.getuid()
    authority = Path.home() / ".Xauthority"
    info = authority.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise RuntimeError("private_user_authority_required")
    os.environ.update(DISPLAY=":0", XAUTHORITY=str(authority),
                      DBUS_SESSION_BUS_ADDRESS=f"unix:path=/run/user/{uid}/bus")
    initial = helper.context()
    for path in (Path("/usr/bin/pkexec"), Path("/usr/bin/true")):
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("fixed_system_executable_required")
    for process in Path("/proc").iterdir():
        if process.name.isdigit():
            try:
                if (process / "comm").read_text().strip() == "pkexec":
                    raise RuntimeError("another_pkexec_is_running")
            except OSError:
                pass
    observer = FocusObserver()
    report["beforeRequest"] = observer.snapshot()
    if report["beforeRequest"]["showingDialogCount"]:
        raise RuntimeError("existing_cinnamon_dialog_prevents_observation")
    requester = None
    try:
        requester = subprocess.Popen(["/usr/bin/pkexec", "--disable-internal-agent", "/usr/bin/true"],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)
        report["requestPendingBeforeCleanup"] = requester.poll() is None
        if requester.poll() is not None:
            report["requesterExitCodeBeforeCleanup"] = requester.returncode
            raise RuntimeError("request_ended_before_observation")
        if helper.context() != initial:
            raise RuntimeError("original_unlocked_session_required")
        report["pendingRequest"] = observer.snapshot()
    finally:
        if requester is not None and requester.poll() is None:
            report["requesterTerminatedByProbe"] = True
            requester.terminate()
            try:
                requester.wait(timeout=2)
            except subprocess.TimeoutExpired:
                requester.kill()
                requester.wait(timeout=2)
        if requester is not None:
            report["requesterExited"] = requester.poll() is not None
            report["requesterExitCodeAfterCleanup"] = requester.returncode
    time.sleep(0.3)
    report["afterCleanup"] = observer.snapshot()
    if helper.context() != initial:
        raise RuntimeError("original_unlocked_session_required")
    if (report["pendingRequest"]["showingDialogCount"] != 1
            or report["pendingRequest"]["focusedDescendantsWithinDialogs"] < 1
            or report["afterCleanup"]["showingDialogCount"] != 0):
        raise RuntimeError("focused_own_dialog_not_observed")
    report["status"] = "polkit_focus_metadata_observed_not_certified"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observe-polkit", action="store_true", required=True)
    parser.parse_args()
    report = {"schema": 1, "platform": "linux", "status": "polkit_focus_not_observed",
              "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "inputTested": False, "readyForUnattended": False}

    def interrupted(_signal, _frame):
        raise RuntimeError("observation_interrupted_or_timeout")

    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT):
        signal.signal(number, interrupted)
    signal.alarm(25)
    try:
        observe(report)
    except Exception as error:
        report["reason"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        signal.alarm(0)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if "reason" not in report else 3


if __name__ == "__main__":
    sys.exit(main())
