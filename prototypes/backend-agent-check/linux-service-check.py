#!/usr/bin/env python3
"""VM propia: recuperación acotada, parada explícita y eliminación de descendientes."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

BASE = Path('/home/absorlab/AbsorConnectLab/linux-webrtc-runtime')


def fixture(directory):
    assert directory.parent == BASE/'service-checks' and re.fullmatch(r'[0-9a-f]{32}', directory.name)
    count = directory/'count'
    attempt = int(count.read_text())+1 if count.exists() else 1
    count.write_text(str(attempt))
    if attempt == 1:
        raise SystemExit(71)
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(300)'])
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    report = {'workerPid':os.getpid(), 'childPid':child.pid, 'uid':os.geteuid(),
              'noNewPrivileges':status['NoNewPrivs'].strip() == '1',
              'effectiveCapabilities':status['CapEff'].strip()}
    (directory/'processes.json').write_text(json.dumps(report))
    while True:
        time.sleep(1)


def main():
    assert os.geteuid() == 1000
    assert Path(__file__).resolve() == BASE/'linux-service-check.py'
    if len(sys.argv) == 3 and sys.argv[1] == '--fixture':
        fixture(Path(sys.argv[2]))
        return
    assert len(sys.argv) == 1
    parent = BASE/'service-checks'
    parent.mkdir(mode=0o700, exist_ok=True)
    directory = parent/uuid.uuid4().hex
    directory.mkdir(mode=0o700)
    name = 'absor-service-check-'+directory.name
    unit = name+'.service'
    runtime = Path('/run/user/1000')/name
    env = dict(os.environ, XDG_RUNTIME_DIR='/run/user/1000', DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/1000/bus')
    def manager(*args):
        return subprocess.run(['systemctl', '--user', *args], env=env, capture_output=True, timeout=10)
    try:
        args = ['systemd-run', '--user', '--quiet', '--unit='+unit]
        for prop in ['Type=exec', 'Restart=on-failure', 'RestartSec=100ms',
                     'StartLimitIntervalSec=60s', 'StartLimitBurst=3', 'NoNewPrivileges=yes',
                     'KillMode=control-group', 'TimeoutStopSec=3s', 'RuntimeMaxSec=30s',
                     'UMask=0077', 'LimitCORE=0', 'MemoryMax=128M', 'TasksMax=16',
                     'RuntimeDirectory='+name, 'RuntimeDirectoryMode=0700']:
            args.append('--property='+prop)
        args += [sys.executable, str(Path(__file__).resolve()), '--fixture', str(directory)]
        subprocess.run(args, env=env, capture_output=True, check=True, timeout=15)
        deadline = time.monotonic()+12
        while not (directory/'processes.json').exists():
            assert time.monotonic() < deadline, 'service_did_not_recover'
            time.sleep(0.1)
        report = json.loads((directory/'processes.json').read_text())
        state = manager('show', unit, '--property=NRestarts', '--property=ActiveState', '--property=NoNewPrivileges', '--property=KillMode').stdout.decode()
        assert int((directory/'count').read_text()) == 2 and 'NRestarts=1' in state and 'ActiveState=active' in state
        assert report['uid'] == 1000 and report['noNewPrivileges'] and int(report['effectiveCapabilities'], 16) == 0
        assert runtime.is_dir() and runtime.stat().st_mode & 0o077 == 0
        manager('stop', unit).check_returncode()
        deadline = time.monotonic()+3
        while any(Path('/proc/'+str(report[key])).exists() for key in ['workerPid', 'childPid']):
            assert time.monotonic() < deadline, 'descendant_survived_stop'
            time.sleep(0.05)
        time.sleep(1)
        state = manager('show', unit, '--property=ActiveState', '--property=NRestarts').stdout.decode()
        assert 'ActiveState=inactive' in state and not runtime.exists() and int((directory/'count').read_text()) == 2
        print(json.dumps({'status':'systemd_lifecycle_ok', 'userService':True,
                          'restartedAfterCrash':True, 'restartCount':1,
                          'stopKilledWorkerAndChild':True, 'explicitStopStayedStopped':True,
                          'runtimeRemoved':True, 'noNewPrivileges':True,
                          'effectiveCapabilitiesZero':True, 'readyForUnattended':False}))
    finally:
        manager('stop', unit)
        manager('reset-failed', unit)
        shutil.rmtree(directory)


if __name__ == '__main__':
    main()
