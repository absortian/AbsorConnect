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
ARTIFACT_UID = 1000
OPT = Path('/opt')/NAME
CONFIG = Path('/etc')/NAME
STATE = Path('/var/lib')/NAME
UNITS = ['absorconnect-secure-lab.socket', 'absorconnect-secure-lab.service',
         'absorconnect-ipc-worker-lab.service']
BINS = ['absor-secure-broker-lab', 'absor-secret-provision-lab', 'absor-ipc-worker-lab']
MARK = b'absorconnect-owned-security-install-v1\n'
UI = False
CONTROL = False
PREPARE = False
CONTROL_UNIT = "absorconnect-ui-control-lab.socket"
UI_UNIT = 'absorconnect-ui-status-lab.socket'
UI_DROP = Path('/etc/systemd/system/absorconnect-secure-lab.service.d')
UI_DROP_BYTES = b'[Unit]\nRequires=absorconnect-ui-status-lab.socket\nAfter=absorconnect-ui-status-lab.socket\n'



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
    for unit in [UNITS[2], UNITS[1], *[u for u in UNITS if u.endswith('.socket')]]:
        call('systemctl', 'stop', unit)
    for unit in UNITS:
        (Path('/etc/systemd/system')/unit).unlink()
    if CONTROL:
        runtime=Path('/run/absorconnect-ui-control-lab')
        if runtime.exists():runtime.rmdir()
    if UI:
        drop=UI_DROP/'20-ui-status-lab.conf'
        assert drop.read_bytes()==UI_DROP_BYTES and set(p.name for p in UI_DROP.iterdir())=={'20-ui-status-lab.conf'}
        drop.unlink();UI_DROP.rmdir()
        runtime=Path('/run/absorconnect-ui-lab')
        if runtime.exists():runtime.rmdir()
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
    if CONTROL:
        runtime=Path('/run/absorconnect-ui-control-lab')
        assert not runtime.exists() and not runtime.is_symlink(), 'existing_control_runtime'
    if UI:
        assert not UI_DROP.exists() and not UI_DROP.is_symlink(), 'existing_ui_dropin'
        assert not Path('/run/absorconnect-ui-lab').exists() and not Path('/run/absorconnect-ui-lab').is_symlink(), 'existing_ui_runtime'
    if 'absor-protected-channel-lab' in BINS:
        assert not Path('/var/lib/absorconnect-protected-worker-lab').exists(), 'existing_worker_state'
    assert not any(p.exists() for p in [OPT, CONFIG, STATE]), 'existing_destination'
    for unit in UNITS:
        target=Path('/etc/systemd/system')/unit
        assert not target.exists() and not target.is_symlink(), 'existing_unit'
        state=call('systemctl','show',unit,'-p','LoadState','--value').strip()
        assert state==b'not-found', 'existing_loaded_unit'
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
            assert stat.S_ISREG(meta.st_mode) and meta.st_uid == ARTIFACT_UID and meta.st_nlink == 1
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
        if UI:
            owner=pwd.getpwnam('absorlab');assert owner.pw_uid==1000 and owner.pw_gid==1000
            write(OPT/'ui-profile.json',json.dumps({'v':1,'brokerUid':account.pw_uid,'ownerUid':1000,'ownerGid':1000}).encode(),0o444)
            if CONTROL:write(OPT/'control-profile.json',json.dumps({'v':1,'brokerUid':account.pw_uid,'ownerUid':1000,'ownerGid':1000}).encode(),0o444)
            UI_DROP.mkdir(mode=0o755)
            write(UI_DROP/'20-ui-status-lab.conf',UI_DROP_BYTES,0o644)
        for name in BINS:
            write(OPT/name, artifacts[name], 0o755)
        if 'absor-protected-channel-lab' in BINS:
            worker_state=Path('/var/lib/absorconnect-protected-worker-lab');worker_state.mkdir(mode=0o700);os.chown(worker_state,1000,1000)
            write(worker_state/'result.json',b'',0o600);os.chown(worker_state/'result.json',1000,1000)
            write(OPT/'worker.json',b'{"protectedIpc":true,"apiSignaling":true,"nativeFixture":true}',0o644)
        result = subprocess.run([str(OPT/BINS[1]), *(['--migration-prepare'] if PREPARE else [])], input=json.dumps(config['enrollment']).encode(),
                                capture_output=True, timeout=15)
        assert result.returncode == 0, 'native_enrollment_or_seal_failed'
        assert json.loads(result.stdout)['plaintextBundleWritten'] is False
        STATE.mkdir(mode=0o700)
        os.chown(STATE, account.pw_uid, account.pw_gid)
        attempts=(CONFIG/'imported-attempts.json').read_bytes() if PREPARE else b'{"schema":1,"failures":[],"locked_until":null,"last_seen":0}'
        write(STATE/'attempts.json', attempts, 0o600)
        os.chown(STATE/'attempts.json', account.pw_uid, account.pw_gid)
        for unit in UNITS:
            write(Path('/etc/systemd/system')/unit, artifacts[unit], 0o644)
        call('systemd-analyze', 'verify', *(str(Path('/etc/systemd/system')/u) for u in UNITS))
        call('systemctl', 'daemon-reload')
        if not PREPARE: call('systemctl', 'start', UNITS[0], UNITS[2])
        print(json.dumps({'installed': True, 'prepared': PREPARE, 'brokerUid': account.pw_uid, 'workerUid': 1000,
                          'plaintextBundleWritten': False, 'lightdmModified': False}))
    except BaseException:
        # La retirada completa exige unidades instaladas. Antes se retiran solo recursos propios.
        for unit in [UNITS[2], UNITS[1], *[u for u in UNITS if u.endswith('.socket')]]:
            subprocess.run(['systemctl', 'stop', unit], capture_output=True)
            (Path('/etc/systemd/system')/unit).unlink(missing_ok=True)
        if CONTROL:
            runtime=Path('/run/absorconnect-ui-control-lab')
            if runtime.exists():runtime.rmdir()
        if UI:
            if (UI_DROP/'20-ui-status-lab.conf').exists():
                assert (UI_DROP/'20-ui-status-lab.conf').read_bytes()==UI_DROP_BYTES
                (UI_DROP/'20-ui-status-lab.conf').unlink();UI_DROP.rmdir()
            runtime=Path('/run/absorconnect-ui-lab')
            if runtime.exists():runtime.rmdir()
        subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
        subprocess.run(['userdel', ACCOUNT], capture_output=True)
        for directory in [CONFIG, STATE, Path('/run')/NAME, Path('/run/absorconnect-ipc-worker-lab'), Path('/var/lib/absorconnect-protected-worker-lab'), OPT]:
            if directory.exists():
                shutil.rmtree(directory)
        raise


def main():
    global UNITS, BINS, UI, CONTROL, UI_DROP_BYTES, PREPARE
    assert os.getuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in ('install', 'remove', 'install-native', 'remove-native','install-ui','remove-ui','install-native-ui','remove-native-ui','install-ui-control','remove-ui-control','install-native-ui-control','remove-native-ui-control','prepare-native-ui-control','prepare-ui-control')
    PREPARE=sys.argv[1].startswith('prepare-')
    native='native' in sys.argv[1].split('-')
    UI='ui' in sys.argv[1].split('-')
    CONTROL='control' in sys.argv[1].split('-')
    if CONTROL:
        assert UI
        UI_DROP_BYTES=b'[Unit]\nRequires=absorconnect-ui-status-lab.socket absorconnect-ui-control-lab.socket\nAfter=absorconnect-ui-status-lab.socket absorconnect-ui-control-lab.socket\n'
    if native:
        UNITS=[UNITS[0],UNITS[1],'absorconnect-protected-worker-lab.service']
        BINS=['absor-secure-broker-lab','absor-secret-provision-lab','absor-protected-channel-lab','libabsor_agent_webrtc_lab.so']
    if UI:
        UNITS.append(UI_UNIT)
        BINS.append('absor-agent-status-lab')
    if CONTROL:
        UNITS.append(CONTROL_UNIT)
        BINS.append('absor-agent-control-lab')
    marker=Path('/run/absorconnect-owned-vm-lab');meta=marker.lstat()
    assert stat.S_ISREG(meta.st_mode) and meta.st_uid==0 and stat.S_IMODE(meta.st_mode)==0o444
    assert marker.read_bytes() == b'absorconnect-native-window-fixture-v1\n'
    assert pwd.getpwnam('absorlab').pw_uid == 1000
    if sys.argv[1].startswith(('install','prepare')):
        install()
    else:
        cleanup()


if __name__ == '__main__':
    main()
