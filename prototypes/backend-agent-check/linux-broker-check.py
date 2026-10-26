#!/usr/bin/env python3
"""Ciclo de vida de systemd en VM propia con trabajador ARTIFICIAL, sin pantalla/entrada."""
import argparse
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import tarfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
UNIT = 'absorconnect-broker-lab.service'
STAGING = '/home/absorlab/AbsorConnectLab/broker-staging'
STATE = '/var/lib/absorconnect-broker-lab'
RUNTIME = '/run/absorconnect-broker-lab'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lab', type=Path)
    parser.add_argument('vm', type=Path)
    args = parser.parse_args()
    assert args.vm.stat().st_mode & 0o077 == 0 and args.vm.stat().st_uid == os.getuid()
    spec = importlib.util.spec_from_file_location('owned_vm', args.vm/'vm-control.py')
    vm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vm)
    assert vm.SSH[-1] == 'absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1] == '22223'
    control = {'requests':[], 'revoked':False, 'polls':0}
    credential = 'acg_'+'B'*43  # Credencial pública artificial: no pertenece a ninguna cuenta.

    class API(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            assert self.path == '/api/host-agent/remote-requests'
            assert self.headers.get('Authorization') == 'Bearer '+credential
            control['polls'] += 1
            body = {'error':{'code':'agent_revoked'}} if control['revoked'] else {'authorization':{'validForSeconds':30,'authorizedUntil':'2026-10-26T00:00:00Z'}, 'requests':control['requests'][:]}
            raw = json.dumps(body).encode()
            self.send_response(401 if control['revoked'] else 200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), API)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    tunnel = None
    marker = False
    installed = False
    logged_out = False

    def wait(predicate, seconds=15):
        end = time.monotonic()+seconds
        while True:
            value = predicate()
            if value:
                return value
            assert time.monotonic() < end, 'owned_vm_condition_timeout'
            time.sleep(0.1)

    def show():
        return dict(line.split('=',1) for line in vm.remote('systemctl show '+UNIT+' -p MainPID -p ActiveState -p NRestarts -p ExecMainStatus').decode().splitlines())

    def processes():
        script = 'import pathlib,json; p=pathlib.Path("/sys/fs/cgroup/system.slice/'+UNIT+'/cgroup.procs"); print(json.dumps([int(n) for n in p.read_text().split()] if p.exists() else []))'
        return json.loads(vm.remote("python3 -c '"+script+"'"))

    def request():
        control['requests'] = [{'id':str(uuid.uuid4()),'controllerName':'Artificial worker only', 'offer':'artificial','createdAt':'2026-10-26T00:00:00Z'}]
        return wait(lambda: (p if len(p := processes()) >= 3 else None))

    def connect():
        port = int(vm.remote("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'"))
        process = subprocess.Popen(vm.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes','-R',f'127.0.0.1:{port}:127.0.0.1:{server.server_address[1]}',vm.SSH[-1]], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.3)
        assert process.poll() is None
        return process, port

    try:
        vm.remote('sudo -n test ! -e /run/absorconnect-owned-vm-lab')
        vm.remote('sudo -n install -m 0444 /dev/stdin /run/absorconnect-owned-vm-lab', b'absorconnect-native-window-fixture-v1\n')
        marker = True
        checkout = args.lab/'webrtc-native/src'
        files = {'absor-linux-broker-lab':(checkout/'absor_connect_probe/absor-linux-broker-lab-linux').read_bytes(),
                 'absor_connect_probe/absor-lab-supervisor':(checkout/'absor_connect_probe/absor-lab-supervisor-linux').read_bytes(),
                 'absor_connect_probe/libabsor_agent_webrtc_lab.so':(checkout/'absor_connect_probe/libabsor_agent_webrtc_lab.so').read_bytes(),
                 'out/AbsorLinuxProbe/rust_video_channel_check':vm.remote('cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/absor-lab-worker-fixture'),
                 'absorconnect-broker-lab.service':(ROOT/'agent/linux-lab/absorconnect-broker-lab.service').read_bytes(),
                 'linux-broker-install.py':Path(__file__).with_name('linux-broker-install.py').read_bytes()}
        build = json.loads((args.vm/'linux-webrtc-build.json').read_text())
        for name, local in [('absor-linux-broker-lab','absor-linux-broker-lab'),('absor-lab-supervisor','absor_connect_probe/absor-lab-supervisor'),('libabsor_agent_webrtc_lab.so','absor_connect_probe/libabsor_agent_webrtc_lab.so')]:
            assert hashlib.sha256(files[local]).hexdigest() == build['libraries'][name]
        packed = io.BytesIO()
        with tarfile.open(fileobj=packed, mode='w') as archive:
            for name, raw in files.items():
                item = tarfile.TarInfo(name)
                item.size = len(raw)
                item.mode = 0o700
                archive.addfile(item, io.BytesIO(raw))
        vm.remote('umask 077 && mkdir -p '+STAGING+' && tar -xf - -C '+STAGING, packed.getvalue())
        tunnel, port = connect()
        payload = {'configuration':{'origin':f'http://127.0.0.1:{port}', 'credential':credential},
                   'artifacts':{name:hashlib.sha256(raw).hexdigest() for name,raw in files.items() if name != 'linux-broker-install.py'}}
        vm.remote('sudo -n python3 -I '+STAGING+'/linux-broker-install.py install', json.dumps(payload).encode())
        installed = True
        original = int(show()['MainPID'])
        assert original > 0
        wait(lambda: control['polls'] > 0)
        for path in ['/etc/absorconnect-broker-lab/agent.json','/run/credentials/'+UNIT+'/agent.json',STATE+'/rust-agent-state/attempts.json']:
            assert vm.remote('sudo -n -u nobody test ! -r '+path+' && echo denied').strip() == b'denied'
        assert vm.remote('sudo -n -u nobody test ! -w /opt/absorconnect-broker-lab/absor-linux-broker-lab && echo denied').strip() == b'denied'
        status = vm.remote('cat /proc/'+str(original)+'/status').decode()
        assert 'Uid:\t1000\t1000\t1000\t1000' in status and 'CapEff:\t0000000000000000' in status and 'NoNewPrivs:\t1' in status
        for serial in [1,2]:
            pids = request()
            vm.remote('touch '+RUNTIME+'/session-'+str(serial)+'/finish-artificial-session')
            wait(lambda: json.loads(vm.remote('cat '+RUNTIME+'/status.json'))['completedSessions'] == serial)
            assert json.loads(vm.remote('cat '+STATE+'/last-session.json'))['result']['fixtureOnly']
            assert int(show()['MainPID']) == original
            time.sleep(0.5)
            assert len(processes()) == 1, 'same_pending_request_restarted'
        control['requests'] = []
        journal = b'{"schema":1,"failures":[],"locked_until":null,"last_seen":123}'
        vm.remote('cat > '+STATE+'/rust-agent-state/attempts.json', journal)
        crashed_pids = request()
        # Matar el supervisor propio deja al nieto vivo momentáneamente: el
        # broker debe terminar y systemd limpiar el cgroup antes de recuperarlo.
        vm.remote('kill -KILL '+str(sorted(crashed_pids)[1]))
        wait(lambda: show()['ActiveState'] == 'active' and int(show()['MainPID']) not in [0, original])
        assert set(crashed_pids).isdisjoint(processes())
        assert vm.remote('cat '+STATE+'/rust-agent-state/attempts.json') == journal
        recovered = int(show()['MainPID'])
        stalled_pids = request()
        control['requests'] = []
        start = time.monotonic()
        vm.remote('kill -STOP '+str(recovered))
        wait(lambda: len(processes()) == 1, 4)
        cut_ms = round((time.monotonic()-start)*1000)
        assert cut_ms < 3500
        wait(lambda: show()['ActiveState'] == 'active' and int(show()['MainPID']) not in [0,recovered], 12)
        assert set(stalled_pids).isdisjoint(processes())
        vm.remote('sudo -n systemctl stop '+UNIT)
        restarts = show()['NRestarts']
        time.sleep(1.5)
        assert show()['ActiveState'] == 'inactive' and show()['NRestarts'] == restarts
        assert vm.remote('test ! -e '+RUNTIME+' && echo gone').strip() == b'gone'
        if vm.context().get('Class') == 'user':
            vm.logout()
        logged_out = True
        assert vm.context().get('Class') == 'greeter'
        # Las tres activaciones de fallo anteriores agotan deliberadamente
        # StartLimitBurst. La recuperación administrativa debe ser explícita.
        limited = subprocess.run(vm.SSH+['sudo -n systemctl start '+UNIT], capture_output=True, timeout=15)
        assert limited.returncode != 0 and show()['ActiveState'] == 'failed'
        vm.remote('sudo -n systemctl reset-failed '+UNIT)
        vm.remote('sudo -n systemctl start '+UNIT)
        polls = control['polls']
        wait(lambda: control['polls'] > polls)
        assert len(processes()) == 1 and show()['ActiveState'] == 'active'
        # Arranque real de la VM: no depende del escritorio ni de Electron.
        boot = vm.remote('cat /proc/sys/kernel/random/boot_id')
        # La prueba de reinicio en caliente se quedó en shim/UEFI con HVF.
        # Verificar arranque en frío con apagado limpio, sin restaurar snapshots.
        launch_path = args.vm/'launch.json'
        launch_meta = launch_path.lstat()
        assert launch_path.is_file() and not launch_path.is_symlink() and launch_meta.st_uid == os.getuid() and launch_meta.st_mode & 0o077 == 0
        launch = json.loads(launch_path.read_text())
        assert launch['args'][0] == '/opt/homebrew/bin/qemu-system-aarch64'
        assert 'user,model=virtio-net-pci,ipv6=off,hostfwd=tcp:127.0.0.1:22223-:22' in launch['args']
        subprocess.run(vm.SSH+['sudo -n systemctl poweroff'], capture_output=True, timeout=10)
        def powered_off():
            try:
                with vm.Qmp() as qmp:
                    return qmp.call('query-status')['status'] == 'shutdown'
            except (OSError, ValueError):
                return True
        wait(powered_off, 120)
        try:
            with vm.Qmp() as qmp:
                qmp.call('quit')
        except (OSError, ValueError):
            pass
        tunnel.terminate()
        tunnel.wait(timeout=5)
        with (args.vm/'broker-qemu-cold-boot.log').open('ab') as log:
            process = subprocess.Popen(launch['args'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        launch['pid'] = process.pid
        launch_path.write_text(json.dumps(launch, indent=2)+'\n')
        def rebooted():
            try:
                return vm.remote('cat /proc/sys/kernel/random/boot_id') != boot
            except (OSError, subprocess.SubprocessError):
                return False
        wait(rebooted, 75)
        vm.wait_for('greeter')
        assert vm.context().get('Class') == 'greeter'
        wait(lambda: show()['ActiveState'] == 'active')
        assert len(processes()) == 1
        assert vm.remote('cat '+STATE+'/rust-agent-state/attempts.json') == journal
        # /run es volátil: restaurar SOLO el marcador público del laboratorio.
        vm.remote('sudo -n install -m 0444 /dev/stdin /run/absorconnect-owned-vm-lab', b'absorconnect-native-window-fixture-v1\n')
        control['revoked'] = True
        # El origen protegido conserva el puerto anterior. Reconectar ese puerto.
        tunnel = subprocess.Popen(vm.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes','-R',f'127.0.0.1:{port}:127.0.0.1:{server.server_address[1]}',vm.SSH[-1]], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait(lambda: show()['ActiveState'] == 'inactive', 15)
        assert show()['ExecMainStatus'] == '77'
        before = control['polls']
        # Type=notify rechaza arrancar una identidad terminal antes de READY.
        subprocess.run(vm.SSH+['sudo -n systemctl start '+UNIT], capture_output=True, timeout=15)
        wait(lambda: show()['ActiveState'] in ['inactive','failed'])
        time.sleep(1.5)
        assert show()['ExecMainStatus'] == '77' and show()['ActiveState'] in ['inactive','failed'] and control['polls'] == before
        audit = json.loads(vm.remote('cat '+STATE+'/audit.json'))
        events = [row['event'] for row in audit['records']]
        assert events.count('worker_started') == 4 and events.count('worker_failed') == 1 and events.count('worker_denied') == 2
        assert events[-1] == 'authorization_denied'
        result = {'auditEvents':events,'schema':1,'ok':True,'fixtureOnly':True,'osCaptureOrInputTested':False,
                  'sequentialArtificialSessions':2,'sameBrokerProcess':True,'duplicatePendingNotRestarted':True,
                  'systemUnit':True,'systemdCredential':True,'foreignUidDenied':True,'uid':1000,'effectiveCapabilities':0,
                  'noNewPrivileges':True,'supervisorCrashAndCgroupRecovery':True,'journalSurvivedRestartAndBoot':True,
                  'brokerStallWorkerCutMilliseconds':cut_ms,'watchdogRecovery':True,'startLimitObserved':True,'explicitStopNotRestarted':True,
                  'greeterIdleStartup':True,'vmColdBootStartup':True,'vmWarmRebootTested':False,'warmRebootNotCovered':True,'revocationSurvivedManualRestart':True,
                  'electronRequired':False,'readyForUnattended':False,'productionTested':False}
    finally:
        try:
            if installed:
                vm.remote('test -e /run/absorconnect-owned-vm-lab || sudo -n install -m 0444 /dev/stdin /run/absorconnect-owned-vm-lab', b'absorconnect-native-window-fixture-v1\n')
            if installed or vm.remote('test -f /opt/absorconnect-broker-lab/.absor-broker-lab && echo yes || true').strip() == b'yes':
                vm.remote('sudo -n python3 -I '+STAGING+'/linux-broker-install.py remove')
                installed = False
        finally:
            if tunnel is not None and tunnel.poll() is None:
                tunnel.terminate()
                tunnel.wait(timeout=5)
            if marker:
                vm.remote('sudo -n rm -- /run/absorconnect-owned-vm-lab')
            if logged_out and vm.context().get('Class') == 'greeter':
                vm.login()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    result['serviceAndSecretsRemoved'] = True
    path = args.lab/'linux-broker-service-results.json'
    path.write_text(json.dumps(result, indent=2)+'\n')
    path.chmod(0o600)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
