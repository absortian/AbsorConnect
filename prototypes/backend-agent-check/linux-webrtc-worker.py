#!/usr/bin/env python3
"""Lanzador SSH fijo de nuestra VM, usado por el main de Electron de laboratorio."""
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def main():
    assert len(sys.argv) == 3
    directory = Path(sys.argv[1]).resolve()
    controller = directory/'vm-control.py'
    assert directory.stat().st_uid == os.getuid() and directory.stat().st_mode & 0o077 == 0
    assert controller.is_file() and not controller.is_symlink() and controller.stat().st_uid == os.getuid() and controller.stat().st_mode & 0o022 == 0
    path = Path(sys.argv[2])
    meta = path.lstat()
    assert path.is_file() and not path.is_symlink() and meta.st_uid == os.getuid() and meta.st_mode & 0o077 == 0 and meta.st_size <= 4096
    config = json.loads(path.read_text())
    uri = urlsplit(config['origin'])
    assert uri.scheme == 'http' and uri.hostname == '127.0.0.1' and uri.port and not (uri.username or uri.password or uri.query or uri.fragment) and uri.path in ['', '/']
    assert re.fullmatch(r'acg_[A-Za-z0-9_-]{43}', config['credential']) and config['apiSignaling'] is True
    spec = importlib.util.spec_from_file_location('owned_vm', controller)
    vm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vm)
    assert vm.SSH[-1] == 'absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1] == '22223'
    helper_spec = importlib.util.spec_from_file_location('fixture_helper', Path(__file__).with_name('native-x11-worker.py'))
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    if vm.context().get('Class') == 'greeter':
        vm.login()
    if helper.screen_state(vm) == '(true,)':
        vm.logout()
        vm.login()
    assert helper.screen_state(vm) == '(false,)' and vm.context().get('Class') == 'user'
    print('LINUX_VM_CONTEXT_READY', file=sys.stderr, flush=True)
    broker = config.get('brokerFixture') is True
    marker = '/run/absorconnect-owned-vm-lab'
    job = uuid.uuid4().hex
    child = None
    created = False
    locked_by_test = False
    def interrupted(*_):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        vm.remote('sudo -n test ! -e '+marker)
        vm.remote('sudo -n install -m 0444 /dev/stdin '+marker, b'absorconnect-native-window-fixture-v1\n')
        created = True
        lab = directory.parent
        build = json.loads((directory/'linux-webrtc-build.json').read_text())
        assert build['webrtcRevision'] == json.loads((ROOT/'prototypes/remote-desktop/webrtc-check/dependencies.json').read_text())['webrtc']['revision']
        archive = io.BytesIO()
        files = [(lab/'webrtc-native/src/out/AbsorLinuxProbe/rust_video_channel_check', 'out/AbsorLinuxProbe/rust_video_channel_check'),
                                   (lab/'webrtc-native/src/absor_connect_probe/libabsor_agent_webrtc_lab.so', 'absor_connect_probe/libabsor_agent_webrtc_lab.so'),
                                   (lab/'webrtc-native/src/absor_connect_probe/absor-lab-supervisor-linux', 'absor_connect_probe/absor-lab-supervisor'),
                                   (ROOT/'prototypes/backend-agent-check/linux-service-worker.py', 'linux-service-worker.py')]
        if broker:
            files += [(lab/'webrtc-native/src/absor_connect_probe/absor-linux-broker-lab-linux', 'absor-linux-broker-lab'),
                      (ROOT/'agent/linux-lab/absorconnect-broker-lab.service', 'absorconnect-broker-lab.service'),
                      (ROOT/'prototypes/backend-agent-check/linux-broker-install.py', 'linux-broker-install.py'),
                      (ROOT/'prototypes/backend-agent-check/linux-broker-service-worker.py', 'linux-broker-service-worker.py')]
        with tarfile.open(fileobj=archive, mode='w') as output:
            for source, target in files:
                output.add(source, arcname=target, recursive=False)
        remote_base = '/home/absorlab/AbsorConnectLab/'+('broker-staging' if broker else 'linux-webrtc-runtime')
        subprocess.run(vm.SSH+['umask 077 && mkdir -p '+remote_base+' && tar -xf - -C '+remote_base+' && chmod 700 '+remote_base+'/out/AbsorLinuxProbe/rust_video_channel_check'], input=archive.getvalue(), capture_output=True, check=True, timeout=30)
        if config.get('lockedFixture') is True:
            vm.remote('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver --method org.cinnamon.ScreenSaver.SetActive true')
            locked_by_test = True
            assert helper.screen_state(vm) == '(true,)'
        port = int(vm.remote("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'"))
        assert 1024 <= port <= 65535
        payload = {'job':job, 'configuration':{'origin':f'http://127.0.0.1:{port}', 'credential':config['credential'], 'apiSignaling':True, 'nativeFixture':True},
                   'artifacts':{'binary':build['binarySha256'], 'library':build['libraries']['libabsor_agent_webrtc_lab.so'], 'supervisor':build['libraries']['absor-lab-supervisor']}}
        if broker:
            import hashlib
            payload = {'configuration':{'origin':f'http://127.0.0.1:{port}', 'credential':config['credential']},
                       'artifacts':{target:hashlib.sha256(source.read_bytes()).hexdigest() for source, target in files
                                    if target not in ['linux-service-worker.py','linux-broker-install.py','linux-broker-service-worker.py']}}
        command = vm.SSH[:-1]+['-o', 'ExitOnForwardFailure=yes', '-R', f'127.0.0.1:{port}:127.0.0.1:{uri.port}', vm.SSH[-1],
                              'ulimit -c 0 && exec env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus python3 -I '+remote_base+('/linux-broker-service-worker.py' if broker else '/linux-service-worker.py')]
        child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        print('LINUX_SERVICE_START', file=sys.stderr, flush=True)
        stdout, stderr = child.communicate(json.dumps(payload).encode(), timeout=85)
        assert len(stdout) <= 16384 and len(stderr) <= 65536
        if child.returncode:
            sys.stderr.buffer.write(stderr)
        assert child.returncode == 0, 'remote_linux_service_failed'
        result = json.loads(stdout)
        assert result['nativeFixture'] and result['systemd']['runtimeRemoved']
        print(json.dumps(result))
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        try:
            if broker and vm.remote('test -f /opt/absorconnect-broker-lab/.absor-broker-lab && echo yes || true').strip() == b'yes':
                vm.remote('sudo -n python3 -I /home/absorlab/AbsorConnectLab/broker-staging/linux-broker-install.py remove')
            vm.remote('XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user stop absor-webrtc-fixture-'+job+'.service || true')
        finally:
            if created:
                vm.remote('sudo -n rm -- '+marker)
            if locked_by_test:
                vm.logout()
                vm.login()
                assert helper.screen_state(vm) == '(false,)'


if __name__ == '__main__':
    main()
