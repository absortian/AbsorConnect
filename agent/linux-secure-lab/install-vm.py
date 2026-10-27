#!/usr/bin/env python3
"""Instalador/retirada exclusivos de la VM propia; no modifica LightDM ni PAM."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys

NAME = 'absorconnect-secure-lab'
ACCOUNT = 'absorconnect-lab'
STAGE = Path('/home/absorlab/AbsorConnectLab/secure-ipc-staging')
OPT = Path('/opt')/NAME
CONFIG = Path('/etc')/NAME
STATE = Path('/var/lib')/NAME
UNITS = ['absorconnect-secure-lab.socket', 'absorconnect-secure-lab.service',
         'absorconnect-ipc-worker-lab.service']
BINS = ['absor-secure-broker-lab', 'absor-secret-provision-lab', 'absor-ipc-worker-lab']
MARK = b'absorconnect-owned-security-install-v1\n'


def call(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=20).stdout


def write(path, data, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def cleanup():
    assert (OPT/'owned-installation').read_bytes() == MARK, 'installation_not_owned'
    for unit in [UNITS[2], UNITS[1], UNITS[0]]:
        call('systemctl', 'stop', unit)
    for unit in UNITS:
        (Path('/etc/systemd/system')/unit).unlink()
    call('systemctl', 'daemon-reload')
    subprocess.run(['systemctl', 'reset-failed', *UNITS], capture_output=True)
    call('userdel', ACCOUNT)
    for directory in [CONFIG, STATE, Path('/run')/NAME, Path('/run/absorconnect-ipc-worker-lab'), Path('/var/lib/absorconnect-protected-worker-lab'), OPT]:
        if directory.exists():
            shutil.rmtree(directory)
    runtime=Path('/run/absorconnect-ipc-worker-lab')
    if runtime.exists(): shutil.rmtree(runtime)
    print(json.dumps({'removed': True, 'lightdmModified': False, 'accountRemoved': True}))


def install():
    if 'absor-protected-channel-lab' in BINS:
        assert not Path('/var/lib/absorconnect-protected-worker-lab').exists(), 'existing_worker_state'
    assert not any(p.exists() for p in [OPT, CONFIG, STATE]), 'existing_destination'
    for unit in UNITS:
        assert not (Path('/etc/systemd/system')/unit).exists(), 'existing_unit'
    try:
        pwd.getpwnam(ACCOUNT)
        raise AssertionError('existing_service_account')
    except KeyError:
        pass
    data = sys.stdin.buffer.read(8193)
    assert len(data) <= 8192
    config = json.loads(data)
    assert set(config) == {'hashes', 'enrollment'}
    assert set(config['hashes']) == set(UNITS+BINS)
    artifacts = {}
    for name in UNITS+BINS:
        path = STAGE/name
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as stream:
            meta = os.fstat(stream.fileno())
            assert stat.S_ISREG(meta.st_mode) and meta.st_uid == 1000 and meta.st_nlink == 1
            raw = stream.read(32*1024*1024+1)
            assert len(raw) <= 32*1024*1024
        assert hashlib.sha256(raw).hexdigest() == config['hashes'][name], 'artifact_hash_mismatch'
        artifacts[name] = raw
    OPT.mkdir(mode=0o755)
    write(OPT/'owned-installation', MARK, 0o600)
    try:
        call('useradd', '--system', '--user-group', '--no-create-home', '--home-dir',
             '/nonexistent', '--shell', '/usr/sbin/nologin', ACCOUNT)
        account = pwd.getpwnam(ACCOUNT)
        assert account.pw_uid not in (0, 1000)
        for name in BINS:
            write(OPT/name, artifacts[name], 0o755)
        if 'absor-protected-channel-lab' in BINS:
            worker_state=Path('/var/lib/absorconnect-protected-worker-lab');worker_state.mkdir(mode=0o700);os.chown(worker_state,1000,1000)
            write(worker_state/'result.json',b'',0o600);os.chown(worker_state/'result.json',1000,1000)
            write(OPT/'worker.json',b'{"protectedIpc":true,"apiSignaling":true,"nativeFixture":true}',0o644)
        result = subprocess.run([str(OPT/BINS[1])], input=json.dumps(config['enrollment']).encode(),
                                capture_output=True, timeout=15)
        assert result.returncode == 0, 'native_enrollment_or_seal_failed'
        assert json.loads(result.stdout)['plaintextBundleWritten'] is False
        STATE.mkdir(mode=0o700)
        os.chown(STATE, account.pw_uid, account.pw_gid)
        write(STATE/'attempts.json', b'{"schema":1,"failures":[],"locked_until":null,"last_seen":0}', 0o600)
        os.chown(STATE/'attempts.json', account.pw_uid, account.pw_gid)
        for unit in UNITS:
            write(Path('/etc/systemd/system')/unit, artifacts[unit], 0o644)
        call('systemd-analyze', 'verify', *(str(Path('/etc/systemd/system')/u) for u in UNITS))
        call('systemctl', 'daemon-reload')
        call('systemctl', 'start', UNITS[0], UNITS[2])
        print(json.dumps({'installed': True, 'brokerUid': account.pw_uid, 'workerUid': 1000,
                          'plaintextBundleWritten': False, 'lightdmModified': False}))
    except BaseException:
        # La retirada completa exige unidades instaladas. Antes se retiran solo recursos propios.
        for unit in [UNITS[2], UNITS[1], UNITS[0]]:
            subprocess.run(['systemctl', 'stop', unit], capture_output=True)
            (Path('/etc/systemd/system')/unit).unlink(missing_ok=True)
        subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
        subprocess.run(['userdel', ACCOUNT], capture_output=True)
        for directory in [CONFIG, STATE, Path('/run')/NAME, Path('/run/absorconnect-ipc-worker-lab'), Path('/var/lib/absorconnect-protected-worker-lab'), OPT]:
            if directory.exists():
                shutil.rmtree(directory)
        raise


def main():
    global UNITS, BINS
    assert os.getuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ('install', 'remove', 'install-native', 'remove-native')
    native=sys.argv[1].endswith('-native')
    if native:
        UNITS=[UNITS[0],UNITS[1],'absorconnect-protected-worker-lab.service']
        BINS=['absor-secure-broker-lab','absor-secret-provision-lab','absor-protected-channel-lab','libabsor_agent_webrtc_lab.so']
    marker=Path('/run/absorconnect-owned-vm-lab');meta=marker.lstat()
    assert stat.S_ISREG(meta.st_mode) and meta.st_uid==0 and stat.S_IMODE(meta.st_mode)==0o444
    assert marker.read_bytes() == b'absorconnect-native-window-fixture-v1\n'
    assert pwd.getpwnam('absorlab').pw_uid == 1000
    if sys.argv[1].startswith('install'):
        install()
    else:
        cleanup()


if __name__ == '__main__':
    main()
