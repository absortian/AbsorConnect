#!/usr/bin/env python3
"""Descarga fuentes oficiales fijadas en un laboratorio externo al repositorio."""
import json
import os
from pathlib import Path
import subprocess
import sys

SOURCE = Path(__file__).resolve().parent
REPOSITORY = SOURCE.parents[2]


def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def checkout(path, dependency):
    if not path.exists():
        path.mkdir(parents=True)
        run("git", "init", str(path))
        run("git", "remote", "add", "origin", dependency["repository"], cwd=path)
    if not (path / ".git").is_dir():
        raise RuntimeError(f"La ruta ya existe y no es el checkout esperado: {path}")
    remote = subprocess.check_output(
        ["git", "remote", "get-url", "origin"], cwd=path, text=True).strip()
    if remote != dependency["repository"]:
        raise RuntimeError("El origen del checkout no coincide; no se modifica.")
    run("git", "diff", "--exit-code", cwd=path)
    run("git", "diff", "--cached", "--exit-code", cwd=path)
    current = subprocess.run(["git", "rev-parse", "HEAD"], cwd=path,
                             text=True, capture_output=True).stdout.strip()
    if current != dependency["revision"]:
        run("git", "fetch", "--depth", "1", "origin", dependency["revision"], cwd=path)
        run("git", "checkout", "--detach", dependency["revision"], cwd=path)


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Uso: python3 sync.py <laboratorio-fuera-del-repositorio>")
    workspace = Path(sys.argv[1]).expanduser().resolve()
    if workspace == REPOSITORY or REPOSITORY in workspace.parents:
        raise RuntimeError("Las dependencias deben quedar fuera del repositorio de la app.")
    dependencies = json.loads((SOURCE / "dependencies.json").read_text())
    workspace.mkdir(parents=True, exist_ok=True)
    checkout(workspace / "depot_tools", dependencies["depotTools"])
    checkout(workspace / "webrtc-native" / "src", dependencies["webrtc"])
    client = workspace / "webrtc-native" / ".gclient"
    configuration = """solutions = [{
  'name': 'src',
  'url': 'https://webrtc.googlesource.com/src.git',
  'deps_file': 'DEPS',
  'managed': False,
  'custom_deps': {},
  'custom_vars': {},
}]
target_os = []
"""
    if client.exists() and client.read_text() != configuration:
        raise RuntimeError("Existe una configuración .gclient diferente; no se sustituye.")
    client.write_text(configuration)
    environment = dict(os.environ)
    environment["DEPOT_TOOLS_UPDATE"] = "0"
    environment["DEPOT_TOOLS_COLLECT_METRICS"] = "0"
    environment["PATH"] = str(workspace / "depot_tools") + os.pathsep + environment["PATH"]
    run(str(workspace / "depot_tools" / "ensure_bootstrap"), env=environment)
    run(str(workspace / "depot_tools" / "gclient"), "sync", "--no-history", "--nohooks",
        "--revision", "src@" + dependencies["webrtc"]["revision"], "--jobs", "4",
        cwd=client.parent, env=environment)
    run(str(workspace / "depot_tools" / "gclient"), "runhooks",
        cwd=client.parent, env=environment)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
