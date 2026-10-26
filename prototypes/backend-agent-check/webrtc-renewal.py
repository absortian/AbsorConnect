#!/usr/bin/env python3
"""API local → Rust/DTLS/vídeo artificial → corte, con cuentas efímeras propias."""
import argparse
import http.server
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
BASE = 'http://127.0.0.1:8020'
NAMES = ['correct', 'wrong-proof', 'fingerprint-mismatch', 'api-revoked', 'api-cut']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('lab', type=Path)
    parser.add_argument('--node', default='node')
    parser.add_argument('--api-base', default=BASE)
    parser.add_argument('--x11-worker-vm', type=Path)
    parser.add_argument('--linux-webrtc-vm', type=Path)
    parser.add_argument('--linux-broker', action='store_true')
    args = parser.parse_args()
    assert not args.linux_broker or args.linux_webrtc_vm, 'broker_requires_linux_vm'
    assert not (args.x11_worker_vm and args.linux_webrtc_vm), 'choose_separate_or_joined_worker'
    uri = urlsplit(args.api_base)
    assert uri.scheme == 'http' and uri.hostname == '127.0.0.1' and uri.port and 1024 <= uri.port <= 65535 and not (uri.username or uri.password or uri.query or uri.fragment) and uri.path in ['', '/'], 'api_must_be_local_loopback'
    lab = args.lab.resolve()
    spec = importlib.util.spec_from_file_location('native_renewal', Path(__file__).with_name('native-renewal.py'))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    native.BASE = args.api_base
    request = native.request
    owned = {}
    server = thread = None
    work = None
    signals = {}
    log_path = lab/('rust-linux-webrtc-renewal.log' if args.linux_webrtc_vm else 'rust-webrtc-renewal.log')
    try:
        for name in NAMES:
            password = secrets.token_urlsafe(32)
            status, account = request('POST', '/api/auth/register', {
                'email': 'webrtc-renewal-'+uuid.uuid4().hex+'@example.invalid',
                'password': password, 'deviceName': 'Laboratorio efímero WebRTC'})
            assert status == 201, 'temporary_registration_failed'
            owned[name] = item = {'owner': account['token'], 'password': password, 'cut': threading.Event()}
            item['path'] = '/api/devices/'+str(uuid.uuid4())
            key = secrets.token_urlsafe(32)
            info = {'name': 'Host artificial temporal', 'platform': 'linux', 'appVersion': '0.1.0',
                    'remote': {'state': 'available', 'features': {'clipboard': False, 'files': False, 'audio': False}}}
            assert request('PUT', item['path'], info, item['owner'], key)[0] == 200
            status, enrollment = request('POST', item['path']+'/agent-enrollments', {}, item['owner'], key)
            assert status == 201
            status, agent = request('POST', '/api/host-agent/enroll', {
                'enrollmentToken': enrollment['enrollmentToken'], 'agentVersion': '0.1.0', 'capabilities': {}})
            assert status == 201
            item['credential'] = agent['token']

        class Proxy(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def item(self):
                header = self.headers.get('Authorization', '')
                return next((v for v in owned.values() if header == 'Bearer '+v['credential']), None)

            def do_GET(self):
                name = self.path.removeprefix('/signal/')
                if self.path == '/signal/'+name and name in signals:
                    item = owned[name]
                    status, body = request('GET', '/api/remote-requests/'+signals[name]['id'], token=item['owner'])
                    self.reply(status, body)
                    return
                item = self.item()
                if self.path not in ['/api/host-agent/remote-requests', '/api/host-agent/ice-servers'] or item is None:
                    self.send_error(404)
                    return
                if item['cut'].is_set():
                    self.close_connection = True
                    return
                status, body = request('GET', self.path, token=item['credential'])
                if self.path == '/api/host-agent/remote-requests' and status == 200:
                    item['lastPoll'] = time.monotonic()
                self.reply(status, body)

            def do_PUT(self):
                item = self.item()
                if item is None or not re.fullmatch(r'/api/host-agent/remote-requests/[0-9a-f-]{36}/answer', self.path):
                    self.send_error(404)
                    return
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 400000:
                    self.send_error(400)
                    return
                body = json.loads(self.rfile.read(size))
                status, result = request('PUT', self.path, body, item['credential'])
                if status == 204:
                    self.send_response(204)
                    self.end_headers()
                else:
                    self.reply(status, result)

            def do_POST(self):
                if self.path == '/fault/native-worker-cut':
                    owned['correct']['cut'].set()
                    self.send_response(204)
                    self.end_headers()
                    return
                if self.path == '/signal/correct/busy':
                    item = owned['correct']
                    assert not item.get('busyVerified'), 'duplicate_busy_probe'
                    status, pending = request('POST', item['path']+'/remote-requests', {'offer': signals['correct']['offer']}, item['owner'])
                    assert status == 201
                    deadline = time.monotonic()+10
                    while time.monotonic() < deadline:
                        status, result = request('GET', '/api/remote-requests/'+pending['id'], token=item['owner'])
                        if status == 200 and result.get('status') == 'rejected':
                            assert result['rejection']['reason'] == 'busy'
                            item['busyVerified'] = True
                            self.send_response(204)
                            self.end_headers()
                            return
                        time.sleep(0.1)
                    self.send_error(504)
                    return
                name = self.path.removeprefix('/signal/')
                if self.path == '/signal/'+name and name in owned and name not in signals:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 400000:
                        self.send_error(400)
                        return
                    body = json.loads(self.rfile.read(size))
                    if set(body) != {'offer'} or not isinstance(body['offer'], str) or not 0 < len(body['offer'].encode()) <= 65536:
                        self.send_error(400)
                        return
                    item = owned[name]
                    deadline = time.monotonic()+(30 if args.linux_webrtc_vm else 5)
                    while time.monotonic()-item.get('lastPoll', 0) > 1:
                        if time.monotonic() > deadline:
                            self.send_error(504)
                            return
                        time.sleep(0.02)
                    status, result = request('POST', item['path']+'/remote-requests', body, item['owner'])
                    if status == 201:
                        signals[name] = {'id': result['id'], 'offer':body['offer']}
                    self.reply(status, {'created': status == 201})
                    return
                name = self.path.removeprefix('/fault/')
                if self.path != '/fault/'+name or name not in ['api-revoked', 'api-cut']:
                    self.send_error(404)
                    return
                item = owned[name]
                if name == 'api-revoked':
                    assert request('DELETE', item['path']+'/agent', {}, item['owner'])[0] == 204
                else:
                    item['cut'].set()
                self.send_response(204)
                self.end_headers()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = 'http://127.0.0.1:'+str(server.server_address[1])
        if args.linux_webrtc_vm:
            owned['linux-locked'] = owned['correct']
        for name in ([] if args.linux_webrtc_vm else ['worker-stall', 'worker-crash', 'supervisor-stall', 'supervisor-crash']):
            owned[name] = owned['correct']
        manifest = {name: {'origin': origin, 'credential': item['credential'], 'faultUrl': origin+'/fault/'+name, 'signalUrl': origin+'/signal/'+name, 'apiSignaling': True}
                    for name, item in owned.items()}
        manifest_path = lab/('rust-agent-manifest-'+uuid.uuid4().hex+'.json')
        descriptor = os.open(manifest_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump(manifest, file)
        try:
            child = subprocess.Popen([args.node, str(ROOT/'prototypes/remote-desktop/webrtc-check/run-interop.cjs'),
                                      str(lab), '--agent-config', str(manifest_path)]
                                     + (['--linux-vm', str(args.linux_webrtc_vm)] if args.linux_webrtc_vm else ['--supervised'])
                                     + (['--linux-broker'] if args.linux_broker else []), cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                stdout, stderr = child.communicate(timeout=170)
            except subprocess.TimeoutExpired:
                # Grupo creado exclusivamente para este ensayo: retirar también
                # Electron y trabajadores si el lanzador deja de responder.
                os.killpg(child.pid, signal.SIGKILL)
                stdout, stderr = child.communicate(timeout=10)
            run = subprocess.CompletedProcess(child.args, child.returncode, stdout, stderr)
            log_path.write_text(run.stdout+run.stderr)
            os.chmod(log_path, 0o600)
            paths = re.findall(r'^Informe local: (.+)$', run.stdout, re.M)
            assert paths, 'interop_report_missing'
            report_path = Path(paths[-1]).resolve()
            assert report_path.parent.parent == lab and report_path.parent.name.startswith('interop-'), 'report_outside_lab'
            work = report_path.parent
            assert run.returncode == 0, 'interop_failed_inspect_private_log'
            result = json.loads(report_path.read_text())
            assert result['ok'] and result['rustAuthenticationTested'] and result['apiRenewalTested'] and result['rendererCredentialsDenied']
            assert len(result['cases']) == (6 if args.linux_webrtc_vm else 9)
            assert result['nativeWorkerConnected'] if args.linux_webrtc_vm else result['supervisorTested']
            assert owned['correct'].get('busyVerified'), 'second_controller_not_rejected'
            assert all(c['native']['apiSignaling'] for c in result['cases'] if 'native' in c)
            assert not list(work.glob('**/*.sdp')), 'sdp_files_written_in_api_mode'
            # Rechazo ANTES de crear PeerConnection: token revocado y API inaccesible.
            binary = lab/'webrtc-native/src/out/AbsorProbe/rust_video_channel_check'
            for name in ([] if args.linux_webrtc_vm else ['api-revoked', 'api-cut']):
                directory = work/name
                answer = directory/'no-peer-answer.sdp'
                check = subprocess.run([str(binary), str(directory/'offer.sdp'), str(answer),
                                        str(directory/'agent-config.json')], capture_output=True, timeout=12)
                assert check.returncode == 67 and not answer.exists() and not check.stdout, 'peer_started_without_api'
            result.update({'apiRejectedBeforePeerCreation': not bool(args.linux_webrtc_vm), 'productionTested': False,
                           'osCaptureOrInputTested': bool(args.linux_webrtc_vm), 'temporaryAccountsRemoved': False,
                           'apiSignalingTested': True, 'sdpFilesWritten': False, 'secondControllerBusyRejected': True})
            if args.x11_worker_vm:
                worker_spec = importlib.util.spec_from_file_location('native_x11_worker', Path(__file__).with_name('native-x11-worker.py'))
                worker = importlib.util.module_from_spec(worker_spec)
                worker_spec.loader.exec_module(worker)
                result['linuxNativeWorker'] = worker.run(args.x11_worker_vm, origin, owned['correct']['credential'])
                # Nueva validación de API, sin reutilizar trabajador/transporte.
                owned['correct']['cut'].clear()
                result['linuxNativeLockedGuard'] = worker.run(args.x11_worker_vm, origin, owned['correct']['credential'], expect_locked=True)
        finally:
            manifest_path.unlink(missing_ok=True)
    finally:
        errors = 0
        for name, item in owned.items():
            if name not in NAMES:
                continue
            try:
                assert request('DELETE', '/api/me', {'password': item['password']}, item['owner'])[0] == 204
            except Exception:
                errors += 1
        if server is not None:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        # Retirar las copias de credenciales incluso si falla una comprobación posterior.
        if work is not None:
            (work/'agent-manifest.json').unlink(missing_ok=True)
            for name in owned:
                (work/name/'agent-config.json').unlink(missing_ok=True)
        assert errors == 0, 'temporary_account_cleanup_failed'
    result['temporaryAccountsRemoved'] = True
    destination = lab/('rust-linux-webrtc-renewal-results.json' if args.linux_webrtc_vm else 'rust-webrtc-renewal-results.json')
    destination.write_text(json.dumps(result, indent=2)+'\n')
    os.chmod(destination, 0o600)
    print(json.dumps({'ok': True, 'cases': len(result['cases']), 'accountsRemoved': len(NAMES),
                      'apiRejectedBeforePeerCreation': not bool(args.linux_webrtc_vm), 'productionTested': False, 'report': str(destination)}))


if __name__ == '__main__':
    main()
