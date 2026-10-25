#!/usr/bin/env python3
"""Solicitud fija de polkit, con captura de contadores y autenticación manual en Mint."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


DEPENDENCIES = {
    "linux-owned-input-check.py": "948e62402572c0a517ab1a16b5d2a1f7af9ddc76dd81ac57ada3d4e4379a16ce",
    "linux-probe.py": "5c6dc1a14a6a0c8d4e2fc0eaf8816bfed9be3caae19733aa11ad5002a79b7d5e",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request-polkit", action="store_true", required=True,
                        help="Solicita ejecutar exclusivamente /usr/bin/true; la contraseña se introduce en polkit.")
    parser.parse_args()
    requester, journal = None, None
    root = Path(__file__).absolute().parent
    report = {"schema": 1, "platform": "linux", "status": "polkit_not_verified",
              "captureTested": False, "inputTested": False, "polkitTested": False,
              "noOpCompleted": False, "readyForUnattended": False}
    def event(name, **details):
        line = json.dumps({"event": name, **details}, ensure_ascii=False)
        journal.write(line + "\n")
        journal.flush()
        print(line, flush=True)
    def interrupted(_signal, _frame):
        raise RuntimeError("probe_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if os.getuid() == 0:
            raise RuntimeError("unprivileged_user_required")
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError("private_user_lab_directory_required")
        for name, digest in DEPENDENCIES.items():
            path = root / name
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                    or info.st_mode & 0o022 or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
                raise RuntimeError("pinned_dependency_required")
        for path in (Path("/usr/bin/pkexec"), Path("/usr/bin/true")):
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise RuntimeError("system_owned_fixed_executable_required")
        # Evita iniciar otra solicitud pkexec mientras hay una anterior, sin leer argumentos.
        for process in Path("/proc").iterdir():
            if process.name.isdigit():
                try:
                    if (process / "comm").read_text().strip() == "pkexec":
                        raise RuntimeError("another_pkexec_is_running")
                except OSError:
                    pass
        authority = Path.home() / ".Xauthority"
        info = authority.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError("private_user_authority_required")
        os.environ.update(DISPLAY=":0", XAUTHORITY=str(authority),
                          DBUS_SESSION_BUS_ADDRESS=f"unix:path=/run/user/{os.getuid()}/bus")
        spec = importlib.util.spec_from_file_location("absor_lab_context", root / "linux-owned-input-check.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        initial = helper.context()
        # CreateNew: una repetición requiere una carpeta nueva, sin sobrescribir evidencias.
        journal = os.fdopen(os.open(root / "polkit-events.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w")
        event("starting_fixed_polkit_request", credentialsHandledBy="system_graphical_agent")
        print("No autentiques todavía. Espera a CAPTURA_COMPLETADA.", flush=True)
        requester = subprocess.Popen(["/usr/bin/pkexec", "--disable-internal-agent", "/usr/bin/true"],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # No usa agente de texto, contraseñas por stdin ni un ejecutable del laboratorio como root.
        time.sleep(0.5)
        if requester.poll() is not None:
            raise RuntimeError("request_ended_before_capture")
        capture = subprocess.run(["/usr/bin/python3", "-I", str(root / "linux-probe.py"),
                                  "--display", ":0", "--authority", str(authority), "--capture"],
                                 capture_output=True, text=True, timeout=12, check=False)
        if capture.returncode or requester.poll() is not None:
            raise RuntimeError("capture_during_pending_request_not_verified")
        value = json.loads(capture.stdout)
        if (not value.get("captureTested") or value.get("inputTested")
                or value.get("frames", 0) < 1 or value.get("nonUniformFrames", 0) < 1
                or helper.context() != initial):
            raise RuntimeError("invalid_capture_or_session_changed")
        report["captureTested"] = True
        report["capture"] = {key: value[key] for key in ("captureApi", "captureRegion", "frames", "nonUniformFrames")}
        event("capture_complete_waiting_for_owner", capture=report["capture"])
        print("CAPTURA_COMPLETADA: introduce tu contraseña solo en el aviso de polkit, o cancela allí.", flush=True)
        deadline = time.monotonic() + 120
        while requester.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if requester.poll() is None:
            raise RuntimeError("manual_authorization_timeout")
        report["requesterExitCode"] = requester.returncode
        report["noOpCompleted"] = requester.returncode == 0
        report["manualCancellationObserved"] = requester.returncode == 126
        if helper.context() != initial:
            raise RuntimeError("session_changed_after_authorization")
        report["status"] = ("polkit_noop_completed_not_certified" if requester.returncode == 0
                            else "manual_polkit_request_not_approved")
        # Ver el diálogo y haber usado contraseña exige confirmación del propietario por separado.
        event("request_finished", requesterExitCode=requester.returncode)
    except (RuntimeError, OSError, ValueError, ImportError, subprocess.TimeoutExpired) as error:
        report["reason"] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        if requester is not None and requester.poll() is None:
            requester.terminate()
            try:
                requester.wait(timeout=5)
            except subprocess.TimeoutExpired:
                requester.kill()
                requester.wait(timeout=5)
        if requester is not None:
            report["requesterExited"] = requester.poll() is not None
            report.setdefault("requesterExitCode", requester.returncode)
        if journal is not None:
            journal.close()
    # Solo escribe si se verificó el directorio privado y se pudo crear el registro exclusivo.
    if journal is not None:
        with os.fdopen(os.open(root / "polkit-results.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if report["status"] == "polkit_noop_completed_not_certified" and "reason" not in report else 3


if __name__ == "__main__":
    sys.exit(main())
