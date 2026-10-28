#!/usr/bin/env python3
"""Ejecuta la matriz con API/BD efímeras; conserva límites y datos de desarrollo."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit, urlunsplit, unquote
import uuid

ROOT = Path(__file__).resolve().parents[2]


def command(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, capture_output=True, check=True, **kwargs).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lab', type=Path)
    parser.add_argument('--node', default='node')
    parser.add_argument('--x11-worker-vm', type=Path)
    parser.add_argument('--linux-webrtc-vm', type=Path)
    parser.add_argument('--linux-broker', action='store_true')
    parser.add_argument('--secure-ipc-vm', type=Path)
    parser.add_argument('--secure-ipc-authority', action='store_true')
    parser.add_argument('--secure-ipc-dedicated', action='store_true')
    parser.add_argument('--secure-ipc-input-lease', action='store_true')
    parser.add_argument('--secure-ipc-ui-status', action='store_true')
    parser.add_argument('--protected-p2p-vm', type=Path)
    parser.add_argument('--protected-p2p-ui-status', action='store_true')
    parser.add_argument('--protected-p2p-ui-control', action='store_true')
    parser.add_argument('--secure-ipc-ui-control', action='store_true')
    parser.add_argument('--mobile-device')
    parser.add_argument('--turn-config', type=Path)
    parser.add_argument('--stun-config', type=Path)
    parser.add_argument('--android-mapped-direct', action='store_true')
    parser.add_argument('--flutter-tests', action='store_true')
    parser.add_argument('--enrollment-transactions', action='store_true')
    parser.add_argument('--mobile-runtime', action='store_true')
    args = parser.parse_args()
    assert not args.enrollment_transactions or not (args.flutter_tests or args.protected_p2p_vm or args.secure_ipc_vm or args.linux_broker or args.linux_webrtc_vm or args.x11_worker_vm), 'choose_one_matrix'
    assert not args.protected_p2p_ui_control or args.protected_p2p_vm, 'ui_control_requires_owned_p2p_vm'
    assert not args.secure_ipc_ui_control or args.secure_ipc_vm, 'ui_control_requires_owned_ipc_vm'
    assert not args.protected_p2p_ui_status or args.protected_p2p_vm, 'ui_p2p_requires_owned_vm'
    assert not args.secure_ipc_ui_status or args.secure_ipc_vm, 'ui_status_requires_owned_vm_ipc'
    assert not args.secure_ipc_authority or args.secure_ipc_vm, 'authority_requires_owned_vm_ipc'
    assert not args.secure_ipc_dedicated or args.secure_ipc_authority, 'dedicated_requires_authority'
    assert not args.secure_ipc_input_lease or args.secure_ipc_dedicated, 'input_lease_requires_dedicated_owned_vm'
    assert not (args.mobile_device or args.turn_config or args.stun_config or args.android_mapped_direct) or args.protected_p2p_vm, 'mobile_requires_protected_vm'
    assert not args.mobile_runtime or args.mobile_device, 'runtime_requires_mobile_device'
    assert not args.flutter_tests or not (args.protected_p2p_vm or args.secure_ipc_vm or args.linux_broker or args.linux_webrtc_vm or args.x11_worker_vm), 'choose_one_matrix'
    assert not args.linux_broker or args.linux_webrtc_vm, 'broker_requires_linux_vm'
    assert not args.protected_p2p_vm or not (args.secure_ipc_vm or args.linux_broker or args.linux_webrtc_vm or args.x11_worker_vm), 'choose_one_matrix'
    assert not args.secure_ipc_vm or not (args.linux_broker or args.linux_webrtc_vm or args.x11_worker_vm), 'choose_one_matrix'
    lab = args.lab.resolve()
    identifier = uuid.uuid4().hex
    database = 'absor_agent_lab_'+identifier
    name = 'absor-agent-api-lab-'+identifier
    private = lab/('isolated-api-'+identifier)
    private.mkdir(mode=0o700)
    env_file = private/'environment'
    db_created = False
    container = None
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    php = command(['docker', 'compose', 'ps', '-q', 'php']).decode().strip()
    db = command(['docker', 'compose', 'ps', '-q', 'database']).decode().strip()
    assert php and db, 'development_containers_required'
    source = json.loads(command(['docker', 'inspect', php]))[0]
    environment = dict(item.split('=', 1) for item in source['Config']['Env'] if '=' in item)
    uri = urlsplit(environment['DATABASE_URL'])
    assert uri.scheme == 'postgresql' and uri.path == '/app', 'unexpected_development_database'
    network = next(iter(source['NetworkSettings']['Networks']))
    db_user = unquote(uri.username)
    value = {'DATABASE_URL': urlunsplit(uri._replace(path='/'+database)), 'APP_ENV': 'dev',
             'APP_SECRET': secrets.token_hex(32), 'CONNECTIONS_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
             'CONNECTIONS_KEY_PREVIOUS': '', 'SERVER_NAME': ':80', 'DEFAULT_URI': 'http://127.0.0.1:'+str(port),
             'FRANKENPHP_WORKER_CONFIG': 'num 1', 'XDEBUG_MODE': 'off', 'REMOTE_ENABLED': '1',
             'STUN_URLS': 'stun:stun.example.invalid:3478' if args.flutter_tests else '', 'TURN_URLS': '', 'TURN_SECRET': ''}
    descriptor = os.open(env_file, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write(''.join(k+'='+v+'\n' for k, v in value.items()))
    try:
        command(['docker', 'exec', db, 'createdb', '-U', db_user, database])
        db_created = True
        container = command(['docker', 'run', '-d', '--rm', '--name', name,
            '--label', 'absorconnect.lab=webrtc-renewal', '--network', network,
            '--publish', '127.0.0.1:'+str(port)+':80', '--cpus', '1', '--memory', '768m',
            '--env-file', str(env_file), '--mount', 'type=bind,src='+str(ROOT/'backend')+',dst=/app,readonly',
            '--tmpfs', '/app/var:rw,nosuid,size=128m', '--tmpfs', '/data:rw,nosuid,size=16m',
            '--tmpfs', '/config:rw,nosuid,size=16m', '--entrypoint', '/bin/sh', 'absorconnect-php-dev', '-c',
            'php bin/console doctrine:migrations:migrate --no-interaction && exec frankenphp run --config /etc/frankenphp/Caddyfile']).decode().strip()
        deadline = time.monotonic()+60
        while True:
            try:
                with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/api/health', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            assert time.monotonic() < deadline, 'isolated_api_readiness_timeout'
            time.sleep(0.5)
        php_version = command(['docker', 'exec', container, 'php', '-r', 'echo PHP_VERSION;']).decode().strip()
        if args.enrollment_transactions:
            child_args=['python3','-B',str(Path(__file__).with_name('enrollment-transactions.py')),str(lab),'--api-base','http://127.0.0.1:'+str(port)]
        elif args.protected_p2p_vm:
            child_args=['python3','-B',str(Path(__file__).with_name('protected-webrtc.py')),str(lab),str(args.protected_p2p_vm),'--api-base','http://127.0.0.1:'+str(port),'--node',args.node]
            if args.protected_p2p_ui_status or args.protected_p2p_ui_control:child_args += ['--ui-status']
            if args.protected_p2p_ui_control:child_args += ['--ui-control']
            if args.mobile_device:child_args += ['--mobile-device',args.mobile_device]
            if args.mobile_runtime:child_args += ['--mobile-runtime']
            if args.turn_config:child_args += ['--turn-config',str(args.turn_config.resolve())]
            if args.stun_config:child_args += ['--stun-config',str(args.stun_config.resolve())]
            if args.android_mapped_direct:child_args += ['--android-mapped-direct']
        elif args.secure_ipc_vm:
            child_args = ['python3', '-B', str(Path(__file__).with_name('secure-ipc-check.py')),
                          str(lab), str(args.secure_ipc_vm), '--api-base', 'http://127.0.0.1:'+str(port)]
            if args.secure_ipc_authority:child_args += ['--authority-fd']
            if args.secure_ipc_ui_status or args.secure_ipc_ui_control:child_args += ['--ui-status']
            if args.secure_ipc_ui_control:child_args += ['--ui-control']
            if args.secure_ipc_dedicated:child_args += ['--dedicated-worker']
            if args.secure_ipc_input_lease:
                assert args.secure_ipc_dedicated and args.secure_ipc_authority
                child_args += ['--input-lease']
        else:
            child_args = ['python3', '-B', str(Path(__file__).with_name('webrtc-renewal.py')),
                          str(lab), '--node', args.node, '--api-base', 'http://127.0.0.1:'+str(port)]
            child_args += (['--x11-worker-vm', str(args.x11_worker_vm)] if args.x11_worker_vm else [])
            child_args += (['--linux-webrtc-vm', str(args.linux_webrtc_vm)] if args.linux_webrtc_vm else [])
            child_args += (['--linux-broker'] if args.linux_broker else [])
        if args.flutter_tests:
            # API/BD propias: no vaciar los límites compartidos de desarrollo.
            environment = dict(os.environ, API_TEST_URL='http://127.0.0.1:'+str(port))
            run = subprocess.run(['/opt/homebrew/bin/flutter', 'test'], cwd=ROOT/'mobile', env=environment, capture_output=True, timeout=600)
        else:
            run = subprocess.run(child_args, cwd=ROOT, capture_output=True, timeout=600)
        log = private/'matrix.log'
        log.write_bytes(run.stdout+run.stderr)
        os.chmod(log, 0o600)
        assert run.returncode == 0, 'matrix_failed_inspect_private_log'
    finally:
        try:
            if container:
                try:
                    logs = subprocess.run(['docker', 'logs', container], capture_output=True)
                    path = private/'api.log'
                    path.write_bytes(logs.stdout+logs.stderr)
                    os.chmod(path, 0o600)
                finally:
                    subprocess.run(['docker', 'rm', '-f', container], capture_output=True, check=True)
        finally:
            try:
                if db_created:
                    command(['docker', 'exec', db, 'dropdb', '-U', db_user, database])
            finally:
                env_file.unlink(missing_ok=True)
    summary = {'isolatedApiRemoved': True, 'isolatedDatabaseRemoved': True,
               'developmentRateLimitsNotReset': True, 'rateLimitConfigurationChanged': False,
               'productionTested': False, 'phpRuntime': php_version, 'privateLogDirectory': str(private)}
    report = private/'cleanup.json'
    report.write_text(json.dumps(summary, indent=2)+'\n')
    os.chmod(report, 0o600)
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
