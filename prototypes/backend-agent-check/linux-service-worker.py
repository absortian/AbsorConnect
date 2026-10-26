#!/usr/bin/env python3
"""Solo en la VM: ejecuta el extremo fijo bajo systemd --user y retira su runtime."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BASE = Path('/home/absorlab/AbsorConnectLab/linux-webrtc-runtime')


def main():
    assert os.geteuid() == 1000 and len(sys.argv) == 1, 'owned_vm_user_required'
    raw = sys.stdin.buffer.read(8193)
    assert 0 < len(raw) <= 8192
    value = json.loads(raw)
    assert set(value) == {'job', 'configuration', 'artifacts'}
    assert re.fullmatch(r'[0-9a-f]{32}', value['job'])
    name = 'absor-webrtc-fixture-'+value['job']
    unit = name+'.service'
    parent = Path('/run/user/1000')
    meta = parent.stat()
    assert meta.st_uid == 1000 and meta.st_mode & 0o077 == 0
    runtime = parent/name
    runtime.mkdir(mode=0o700)
    command = ['systemctl', '--user']
    try:
        binaries = {'binary':BASE/'out/AbsorLinuxProbe/rust_video_channel_check',
                    'library':BASE/'absor_connect_probe/libabsor_agent_webrtc_lab.so',
                    'supervisor':BASE/'absor_connect_probe/absor-lab-supervisor'}
        assert set(value['artifacts']) == set(binaries)
        for key, path in binaries.items():
            meta = path.lstat()
            assert path.is_file() and not path.is_symlink() and meta.st_uid == 1000 and meta.st_mode & 0o022 == 0
            assert hashlib.sha256(path.read_bytes()).hexdigest() == value['artifacts'][key]
        config = value['configuration']
        assert set(config) == {'origin', 'credential', 'apiSignaling', 'nativeFixture'}
        assert config['apiSignaling'] is True and config['nativeFixture'] is True
        assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]{4,5}', config['origin'])
        assert re.fullmatch(r'acg_[A-Za-z0-9_-]{43}', config['credential'])
        state = runtime/'rust-agent-state'
        state.mkdir(mode=0o700)
        for path, body in [(state/'absor-webrtc-lab', 'synthetic-only'),
                           (state/'attempts.json', json.dumps({'schema':1, 'failures':[], 'locked_until':None, 'last_seen':0}))]:
            fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as file:
                file.write(body)
        config['stateDirectory'] = str(state)
        config_path = runtime/'agent-config.json'
        fd = os.open(config_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(config, file)
        args = ['systemd-run', '--user', '--wait', '--pipe', '--quiet', '--unit='+unit]
        for prop in ['Type=exec', 'UMask=0077', 'NoNewPrivileges=yes', 'LimitCORE=0',
                     'KillMode=control-group', 'TimeoutStopSec=3s', 'RuntimeMaxSec=65s',
                     'Restart=no', 'MemoryMax=768M', 'TasksMax=96',
                     # getifaddrs necesita NETLINK_ROUTE para descubrir la red;
                     # no concede CAP_NET_ADMIN ni modifica interfaces/rutas.
                     'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK',
                     'RuntimeDirectory='+name, 'RuntimeDirectoryMode=0700']:
            args.append('--property='+prop)
        for entry in ['DISPLAY=:0', 'XAUTHORITY=/home/absorlab/.Xauthority',
                      'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus']:
            args.append('--setenv='+entry)
        args += [str(binaries['supervisor']), str(runtime/'supervisor-events.jsonl'),
                 str(binaries['binary']), str(runtime/'unused-offer.sdp'),
                 str(runtime/'unused-answer.sdp'), str(config_path)]
        # El supervisor corta al perder su lanzador. Mantener su pipe de control
        # abierto sin enviar órdenes; DEVNULL simularía la caída del lanzador.
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        control = process.stdin
        process.stdin = None
        try:
            stdout, stderr = process.communicate(timeout=75)
            run = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
        finally:
            control.close()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
        assert len(run.stdout) <= 16384 and len(run.stderr) <= 65536, 'unit_output_oversized'
        if run.returncode:
            print('UNIT_EXIT_CODE='+str(run.returncode), file=sys.stderr)
            sys.stderr.buffer.write(run.stderr)
            diagnostic = subprocess.run(command+['show', unit, '--property=Result', '--property=ExecMainStatus', '--property=ExecStart'], capture_output=True)
            sys.stderr.buffer.write(diagnostic.stdout[:8192])
        assert run.returncode == 0, 'systemd_fixture_failed'
        result = json.loads(run.stdout)
        status = subprocess.run(command+['show', unit, '--property=ActiveState', '--property=LoadState'], capture_output=True, check=True).stdout.decode()
        assert 'ActiveState=active' not in status and not runtime.exists(), 'unit_not_cleaned'
        result['systemd'] = {'userService':True, 'exitCode':run.returncode, 'activeAfterExit':False,
                             'runtimeRemoved':True, 'restart':'no', 'privileged':False,
                             'workerSupervised':True, 'maximumRuntimeSeconds':65}
        print(json.dumps(result))
    finally:
        subprocess.run(command+['stop', unit], capture_output=True, timeout=8)
        subprocess.run(command+['reset-failed', unit], capture_output=True, timeout=8)
        # Solo el directorio adquirido con mkdir exclusivo en este lanzamiento.
        if runtime.exists():
            shutil.rmtree(runtime)


if __name__ == '__main__':
    main()
