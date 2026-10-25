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
import subprocess
import threading
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
    args = parser.parse_args()
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
    log_path = lab/'rust-webrtc-renewal.log'
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

            def do_GET(self):
                header = self.headers.get('Authorization', '')
                item = next((v for v in owned.values() if header == 'Bearer '+v['credential']), None)
                if self.path != '/api/host-agent/remote-requests' or item is None:
                    self.send_error(404)
                    return
                if item['cut'].is_set():
                    self.close_connection = True
                    return
                req = urllib.request.Request(args.api_base+self.path, headers={'Authorization': header, 'Accept': 'application/json'})
                try:
                    response = urllib.request.urlopen(req, timeout=4)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    data = response.read(9*1024*1024)
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)

            def do_POST(self):
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
        manifest = {name: {'origin': origin, 'credential': item['credential'], 'faultUrl': origin+'/fault/'+name}
                    for name, item in owned.items()}
        manifest_path = lab/('rust-agent-manifest-'+uuid.uuid4().hex+'.json')
        descriptor = os.open(manifest_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump(manifest, file)
        try:
            run = subprocess.run([args.node, str(ROOT/'prototypes/remote-desktop/webrtc-check/run-interop.cjs'),
                                  str(lab), '--agent-config', str(manifest_path)], cwd=ROOT,
                                 capture_output=True, text=True, timeout=100)
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
            assert len(result['cases']) == 5
            # Rechazo ANTES de crear PeerConnection: token revocado y API inaccesible.
            binary = lab/'webrtc-native/src/out/AbsorProbe/rust_video_channel_check'
            for name in ['api-revoked', 'api-cut']:
                directory = work/name
                answer = directory/'no-peer-answer.sdp'
                check = subprocess.run([str(binary), str(directory/'offer.sdp'), str(answer),
                                        str(directory/'agent-config.json')], capture_output=True, timeout=12)
                assert check.returncode == 67 and not answer.exists() and not check.stdout, 'peer_started_without_api'
            result.update({'apiRejectedBeforePeerCreation': True, 'productionTested': False,
                           'osCaptureOrInputTested': False, 'temporaryAccountsRemoved': False})
        finally:
            manifest_path.unlink(missing_ok=True)
    finally:
        errors = 0
        for item in owned.values():
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
            for name in NAMES:
                (work/name/'agent-config.json').unlink(missing_ok=True)
        assert errors == 0, 'temporary_account_cleanup_failed'
    result['temporaryAccountsRemoved'] = True
    destination = lab/'rust-webrtc-renewal-results.json'
    destination.write_text(json.dumps(result, indent=2)+'\n')
    os.chmod(destination, 0o600)
    print(json.dumps({'ok': True, 'cases': len(result['cases']), 'accountsRemoved': len(owned),
                      'apiRejectedBeforePeerCreation': True, 'productionTested': False, 'report': str(destination)}))


if __name__ == '__main__':
    main()
