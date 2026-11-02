#!/usr/bin/env python3
"""Matriz real SYSTEM del runner efímero Windows; no emplea el Mac ni sus VM."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from windows_ssh_system import owned_ci_common

REPO=Path(__file__).resolve().parents[2]


def main():
    owned_ci_common()
    root=Path(os.environ['RUNNER_TEMP'])/'absorconnect-vault-owned-ci'
    root.mkdir()
    artifact=root/'artifact';artifact.mkdir()
    binary='absor-win-vault-check-lab.exe'
    shutil.copyfile(REPO/'agent/target/release'/binary,artifact/binary)
    commit=subprocess.run(['git','rev-parse','HEAD'],cwd=REPO,capture_output=True,text=True,check=True).stdout.strip()
    (artifact/'build.json').write_text(json.dumps({'schema':1,'commit':commit,'files':{binary:hashlib.sha256((artifact/binary).read_bytes()).hexdigest()}}))
    completed=subprocess.run(['python','-B',str(REPO/'prototypes/backend-agent-check/windows-vault-check.py'),str(root),str(artifact),'--local-ci'],cwd=REPO,timeout=600)
    return completed.returncode


if __name__=='__main__':raise SystemExit(main())
