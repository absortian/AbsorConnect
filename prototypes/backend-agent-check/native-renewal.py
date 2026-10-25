#!/usr/bin/env python3
"""API local → renovación Rust → cierre de un hijo propio. Retira sus cuentas."""
import concurrent.futures
import http.server
import json
from pathlib import Path
import secrets
import selectors
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid

BASE = 'http://127.0.0.1:8020'
ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT/'agent/target/debug/examples/api-smoke'


def request(method, path, body=None, token=None, key=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer '+token
    if key:
        headers['X-Device-Key'] = key
    req = urllib.request.Request(BASE+path, data=None if body is None else json.dumps(body).encode(),
                                 headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=6)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(9*1024*1024)
        return response.status, json.loads(raw) if raw else {}


def phase(process, timeout):
    with selectors.DefaultSelector() as select:
        select.register(process.stdout, selectors.EVENT_READ)
        if not select.select(timeout):
            raise RuntimeError('native_probe_phase_timeout')
        return json.loads(process.stdout.readline())


def run_case(case):
    password = secrets.token_urlsafe(32)
    status, account = request('POST', '/api/auth/register', {
        'email': 'native-renewal-'+uuid.uuid4().hex+'@example.invalid',
        'password': password, 'deviceName': 'Laboratorio temporal'})
    assert status == 201, 'temporary_registration_failed'
    owner = account['token']
    process = server = server_thread = None
    worker_pid = None
    cut = threading.Event()
    result = {'case': case, 'productionTested': False}
    try:
        device, key = str(uuid.uuid4()), secrets.token_urlsafe(32)
        path = '/api/devices/'+device
        info = {'name': 'Laboratorio nativo temporal', 'platform': 'linux', 'appVersion': '0.1.0',
                'remote': {'state': 'available', 'features': {'clipboard': False, 'files': False, 'audio': False}}}
        assert request('PUT', path, info, owner, key)[0] == 200
        status, enrollment = request('POST', path+'/agent-enrollments', {}, owner, key)
        assert status == 201
        status, agent = request('POST', '/api/host-agent/enroll', {
            'enrollmentToken': enrollment['enrollmentToken'], 'agentVersion': '0.1.0', 'capabilities': {}})
        assert status == 201

        class Proxy(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                if self.path != '/api/host-agent/remote-requests':
                    self.send_error(404)
                    return
                if cut.is_set():
                    self.close_connection = True
                    return
                # Solo esta ruta y este backend fijo. No imprime ni conserva cabeceras.
                req = urllib.request.Request(BASE+self.path, headers={
                    'Authorization': self.headers.get('Authorization', ''), 'Accept': 'application/json'})
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

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        origin = 'http://127.0.0.1:'+str(server.server_address[1])
        process = subprocess.Popen([str(BINARY), origin, case], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        process.stdin.write(agent['token']+'\n')
        process.stdin.close()
        process.stdin = None
        started = phase(process, 12)
        assert started['phase'] == 'worker_started' and started['realAuthenticationTested'] is False
        worker_pid = int(started['workerPid'])
        before = time.monotonic()
        if case == 'revocation':
            assert request('DELETE', path+'/agent', {}, owner)[0] == 204
        else:
            cut.set()
        stdout, stderr = process.communicate(timeout=40)
        elapsed = time.monotonic()-before
        assert process.returncode == 0, 'native_probe_failed'
        completed = json.loads(stdout)
        assert completed['phase'] == 'complete' and completed['ownWorkerTerminated']
        assert completed['operationAfterCutDenied']
        assert elapsed < (8 if case == 'revocation' else 30.5), 'cut_deadline_exceeded'
        result.update(completed)
        result['elapsedMillisecondsAfterFault'] = round(elapsed*1000)
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        # La cuenta se retira aunque falle el cierre del servidor. El ejemplo
        # recoge su hijo antes de salir correctamente; en fallo tiene límite propio.
        try:
            assert request('DELETE', '/api/me', {'password': password}, owner)[0] == 204, 'temporary_account_cleanup_failed'
            result['temporaryAccountRemoved'] = True
        finally:
            if server is not None:
                server.shutdown()
                server.server_close()
                server_thread.join(timeout=2)
    return result


def main():
    assert BINARY.is_file(), 'compile_api_smoke_with_lab_http_first'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run_case, ['revocation', 'network-cut']))
    print(json.dumps({'schema': 1, 'cases': results, 'credentialArgumentsUsed': False,
                      'osCaptureOrInputTested': False, 'productionTested': False}, indent=2))


if __name__ == '__main__':
    main()
