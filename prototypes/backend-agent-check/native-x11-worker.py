#!/usr/bin/env python3
"""Trabajador Rust X11 en la VM propia, con credencial efímera y API por túnel local."""
import importlib.util
import json
import os
from pathlib import Path
import selectors
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit


def screen_state(vm):
    deadline = time.monotonic()+10
    while True:
        try:
            result = vm.remote('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus /usr/bin/timeout 2s /usr/bin/gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver --method org.cinnamon.ScreenSaver.GetActive').decode().strip()
            if result in ['(true,)', '(false,)']:
                return result
        except subprocess.CalledProcessError:
            pass
        assert time.monotonic() < deadline, 'screensaver_state_unavailable'
        time.sleep(0.1)


def run(vm_directory, origin, credential, expect_locked=False):
    directory = Path(vm_directory).resolve()
    meta = directory.stat()
    controller = directory/'vm-control.py'
    code_meta = controller.lstat()
    assert meta.st_uid == os.getuid() and meta.st_mode & 0o077 == 0, 'private_vm_directory_required'
    assert controller.is_file() and not controller.is_symlink() and code_meta.st_uid == os.getuid() and code_meta.st_mode & 0o022 == 0, 'private_vm_controller_required'
    spec = importlib.util.spec_from_file_location('owned_vm', directory/'vm-control.py')
    vm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vm)
    assert vm.SSH[-1] == 'absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1] == '22223', 'owned_loopback_vm_required'
    uri = urlsplit(origin)
    assert uri.scheme == 'http' and uri.hostname == '127.0.0.1' and uri.port and not (uri.username or uri.password or uri.query or uri.fragment) and uri.path in ['', '/'], 'loopback_proxy_required'
    state = vm.context()
    if state.get('Class') == 'greeter':
        vm.login()
        state = vm.context()
    assert state.get('Class') == 'user' and state.get('Type') == 'x11' and state.get('State') == 'active', 'own_vm_desktop_required'
    locked = screen_state(vm)
    if locked == '(true,)':
        # Solo la VM efímera del laboratorio, con su credencial generada privada.
        # Una sesión nueva evita modificar bloqueo, contraseña o políticas.
        vm.logout()
        vm.login()
        locked = screen_state(vm)
    assert locked == '(false,)', 'own_vm_must_be_unlocked'
    # Consultar un puerto libre dentro de la VM; no publicar nada en LAN/router.
    port = int(vm.remote("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'"))
    assert 1024 <= port <= 65535
    marker = '/run/absorconnect-owned-vm-lab'
    binary = '/home/absorlab/AbsorConnectLab/api-workers/agent/target/release/examples/x11-worker-smoke'
    child = None
    created = False
    locked_by_test = False
    try:
        vm.remote('sudo -n test ! -e '+marker)
        vm.remote('sudo -n install -m 0444 /dev/stdin '+marker, b'absorconnect-native-window-fixture-v1\n')
        created = True
        if expect_locked:
            vm.remote('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver --method org.cinnamon.ScreenSaver.SetActive true')
            locked_by_test = True
            assert screen_state(vm) == '(true,)', 'vm_lock_not_observed'
        args = vm.SSH[:-1]+['-o', 'ExitOnForwardFailure=yes', '-R', f'127.0.0.1:{port}:127.0.0.1:{uri.port}', vm.SSH[-1],
                           'ulimit -c 0 && exec env DISPLAY=:0 XAUTHORITY=/home/absorlab/.Xauthority /usr/bin/timeout 55s '+binary]
        child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        child.stdin.write(json.dumps({'origin': f'http://127.0.0.1:{port}', 'credential': credential, 'expectLocked': expect_locked}).encode())
        child.stdin.close()
        child.stdin = None
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ)
        deadline = time.monotonic()+60
        report = None
        cut = False
        total = 0
        while time.monotonic() < deadline:
            ready = selector.select(timeout=0.5)
            if not ready:
                if child.poll() is not None:
                    break
                continue
            line = child.stdout.readline(8193)
            total += len(line)
            assert total <= 16384 and len(line) <= 8192, 'worker_output_oversized'
            if not line:
                break
            if line == b'READY_TO_CUT_NATIVE_WORKER_API\n':
                assert not cut, 'duplicate_cut_request'
                with urllib.request.urlopen(urllib.request.Request(origin+'/fault/native-worker-cut', method='POST'), timeout=5) as response:
                    assert response.status == 204
                cut = True
            else:
                report = json.loads(line)
        selector.close()
        code = child.wait(timeout=5)
        error = child.stderr.read(8192)
        log = directory/'native-x11-worker-stderr.log'
        log.write_bytes(error)
        log.chmod(0o600)
        assert code == 0, 'native_worker_failed_inspect_private_log'
        if expect_locked:
            assert not cut and report and report['status'] == 'locked_context_denied'
            assert report['nativeCaptureAttempts'] == 0 and report['nativeInputAttempts'] == 0 and report['workerClosed']
            return report
        assert cut and report and report['status'] == 'native_worker_ok'
        assert report['nativeAttemptsBeforeAuthentication'] == 0 and report['wrongProofRejected']
        assert report['redFrameCaptured'] and report['greenFrameCaptured']
        assert [report[k] for k in ['mouseDown', 'mouseUp', 'keyDown', 'keyUp']] == [1, 1, 1, 1]
        assert report['apiCutMilliseconds'] <= 30000 and report['captureAndInputRejectedAfterCut'] and report['workerClosed']
        return report
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        try:
            if created:
                vm.remote('sudo -n rm -- '+marker)
        finally:
            if locked_by_test:
                vm.logout()
                vm.login()
                assert screen_state(vm) == '(false,)', 'vm_desktop_not_restored'
