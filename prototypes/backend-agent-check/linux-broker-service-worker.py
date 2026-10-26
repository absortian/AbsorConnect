#!/usr/bin/env python3
"""Adaptador de prueba: instala el broker de sistema, espera un resultado y lo retira."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BASE = Path('/home/absorlab/AbsorConnectLab/broker-staging')
UNIT = 'absorconnect-broker-lab.service'


def main():
    assert os.geteuid() == 1000 and len(sys.argv) == 1
    raw = sys.stdin.buffer.read(8193)
    assert 0 < len(raw) <= 8192
    value = json.loads(raw)
    installed = False
    try:
        completed = subprocess.run(['sudo', '-n', 'python3', '-I', str(BASE/'linux-broker-install.py'), 'install'], input=json.dumps(value).encode(), capture_output=True, timeout=25)
        if completed.returncode:
            sys.stderr.buffer.write(completed.stderr[:8192])
        completed.check_returncode()
        installed = True
        deadline = time.monotonic()+75
        path = Path('/var/lib/absorconnect-broker-lab/last-session.json')
        while not path.exists():
            state = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'ActiveState', '--value']).strip()
            assert state in [b'active', b'activating'], 'broker_terminated_before_result'
            assert time.monotonic() < deadline, 'broker_result_timeout'
            time.sleep(0.1)
        value = json.loads(path.read_text())
        assert value['serial'] == 1 and not value['result'].get('workerFailed')
        result = value['result']
        # En revocación se detiene sin reinicio; los otros resultados vuelven al
        # bucle persistente y el proceso conserva la misma identidad.
        time.sleep(0.2)
        state = subprocess.check_output(['systemctl', 'show', UNIT, '-p', 'ActiveState', '--value']).strip()
        assert state == (b'inactive' if result['apiCutCode'] == -2 else b'active')
        audit = json.loads((path.parent/'audit.json').read_text())
        events = [row['event'] for row in audit['records']]
        expected = ('authorization_revoked' if result['apiCutCode'] == -2 else 'authorization_expired' if result['apiCutCode'] == -1 else 'worker_failed' if result['apiCutCode'] < 0 else 'worker_ended' if result['authenticated'] else 'worker_denied')
        assert events == ['broker_started','worker_started',expected]
        result['broker'] = {'persistentAfterSession':state == b'active', 'systemService':True,
                            'credentialViaSystemd':True, 'auditEvents':events, 'revocationTerminal':result['apiCutCode'] == -2}
    finally:
        if installed:
            cleanup = subprocess.run(['sudo', '-n', 'python3', '-I', str(BASE/'linux-broker-install.py'), 'remove'], capture_output=True, timeout=25)
            if cleanup.returncode:
                sys.stderr.buffer.write(cleanup.stderr[:8192])
            cleanup.check_returncode()
    result['systemd'] = {'systemService':True,'exitCode':0,'activeAfterExit':False,'runtimeRemoved':True,
                         'restart':'on-failure','privileged':False,'workerSupervised':True,'brokerWatchdog':True}
    print(json.dumps(result))


if __name__ == '__main__':
    main()
