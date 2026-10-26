#!/usr/bin/env python3
"""Instalación reversible SOLO en nuestra VM ARM desechable, nunca en Mint físico."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import hashlib

BASE = Path('/opt/absorconnect-broker-lab')
STATE = Path('/var/lib/absorconnect-broker-lab')
CONFIG = Path('/etc/absorconnect-broker-lab')
UNIT = Path('/etc/systemd/system/absorconnect-broker-lab.service')
STAGING = Path('/home/absorlab/AbsorConnectLab/broker-staging')
MARKER = b'absorconnect-persistent-broker-v1\n'
FILES = ['absor-linux-broker-lab', 'out/AbsorLinuxProbe/rust_video_channel_check',
         'absor_connect_probe/absor-lab-supervisor', 'absor_connect_probe/libabsor_agent_webrtc_lab.so']


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=15).stdout


def remove():
    assert (BASE/'.absor-broker-lab').read_bytes() == MARKER
    if UNIT.exists():
        subprocess.run(['systemctl', 'disable', '--now', UNIT.name], capture_output=True, timeout=15)
        subprocess.run(['systemctl', 'reset-failed', UNIT.name], capture_output=True, timeout=15)
        UNIT.unlink()
        run('systemctl', 'daemon-reload')
    for path in [BASE, STATE, CONFIG]:
        assert not path.is_symlink()
        if path.exists():
            shutil.rmtree(path)
    assert not Path('/run/absorconnect-broker-lab').exists()


def main():
    assert os.geteuid() == 0 and Path('/run/absorconnect-owned-vm-lab').read_bytes() == b'absorconnect-native-window-fixture-v1\n'
    assert Path('/home/absorlab').stat().st_uid == 1000 and run('uname', '-m').strip() == b'aarch64'
    assert len(sys.argv) == 2 and sys.argv[1] in ['install', 'remove']
    if sys.argv[1] == 'remove':
        remove()
        print(json.dumps({'removed':True,'runtimeRemoved':True,'ownStateRemoved':True}))
        return
    raw = sys.stdin.buffer.read(8193)
    assert 0 < len(raw) <= 8192
    value = json.loads(raw)
    assert set(value) == {'configuration', 'artifacts'}
    config = value['configuration']
    assert set(config) == {'origin', 'credential'}
    assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]{4,5}', config['origin'])
    assert re.fullmatch(r'acg_[A-Za-z0-9_-]{43}', config['credential'])
    assert set(value['artifacts']) == set(FILES+['absorconnect-broker-lab.service'])
    for name, digest in value['artifacts'].items():
        path = STAGING/name
        meta = path.lstat()
        assert path.is_file() and not path.is_symlink() and meta.st_uid == 1000 and meta.st_mode & 0o022 == 0
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    assert not any(path.exists() or path.is_symlink() for path in [BASE, STATE, CONFIG, UNIT])
    BASE.mkdir(mode=0o755)
    (BASE/'.absor-broker-lab').write_bytes(MARKER)
    try:
        for name in FILES:
            destination = BASE/name
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            shutil.copyfile(STAGING/name, destination)
            destination.chmod(0o644 if name.endswith('.so') else 0o755)
        shutil.copyfile(STAGING/UNIT.name, UNIT)
        UNIT.chmod(0o644)
        CONFIG.mkdir(mode=0o700)
        descriptor = os.open(CONFIG/'agent.json', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(config, stream)
        run('systemd-analyze', 'verify', str(UNIT))
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', UNIT.name)
        run('systemctl', 'start', UNIT.name)
        assert run('systemctl', 'is-active', UNIT.name).strip() == b'active'
    except BaseException:
        remove()
        raise
    print(json.dumps({'installed':True,'systemService':True,'rootBroker':False,'enabled':True}))


if __name__ == '__main__':
    main()
