#!/usr/bin/env python3
"""Carreras HTTP reales contra el backend local. Crea y elimina una cuenta de prueba propia."""
import concurrent.futures
import json
import secrets
import threading
import urllib.error
import urllib.request
import uuid

BASE = 'http://127.0.0.1:8020'
INFO = {'name': 'Prueba de concurrencia', 'platform': 'linux', 'appVersion': '0.1.0',
        'remote': {'state': 'available', 'features': {'clipboard': False, 'files': False, 'audio': False}}}
NATIVE = {'agentVersion': '0.1.0', 'capabilities': {}}


def request(method, path, body=None, token=None, key=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if key:
        headers['X-Device-Key'] = key
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as failure:
        response = failure
    with response:
        data = response.read()
        return response.status, json.loads(data) if data else {}


def parallel(*operations):
    barrier = threading.Barrier(len(operations))
    def run(operation):
        barrier.wait(timeout=5)
        return operation()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(operations)) as executor:
        return list(executor.map(run, operations))


def main():
    password = secrets.token_urlsafe(32)
    email = 'agent-concurrency-' + uuid.uuid4().hex + '@example.invalid'
    status, account = request('POST', '/api/auth/register', {'email': email, 'password': password, 'deviceName': 'Prueba'})
    assert status == 201, status
    owner = account['token']
    results = []
    try:
        for case in range(3):
            device, key = str(uuid.uuid4()), secrets.token_urlsafe(32)
            path = '/api/devices/' + device
            assert request('PUT', path, INFO, owner, key)[0] == 200
            status, enrollment = request('POST', path + '/agent-enrollments', {}, owner, key)
            assert status == 201, status
            payload = {'enrollmentToken': enrollment['enrollmentToken'], **NATIVE}
            responses = parallel(lambda: request('POST', '/api/host-agent/enroll', payload),
                                 lambda: request('POST', '/api/host-agent/enroll', payload))
            assert sorted(r[0] for r in responses) == [201, 400], [r[0] for r in responses]
            agent = next(r[1]['token'] for r in responses if r[0] == 201)
            assert request('PUT', path, INFO, owner, key)[0] == 409
            assert request('GET', '/api/host-agent/ice-servers', token=agent)[0] == 200
            assert request('DELETE', path + '/agent', {}, owner)[0] == 204
            assert request('GET', '/api/host-agent/ice-servers', token=agent)[0] == 401
            assert request('DELETE', path, {}, owner, key)[0] == 204
            results.append({'case': 'double_redemption', 'iteration': case + 1, 'statuses': [r[0] for r in responses],
                            'revocationVerified': True})

        device, key = str(uuid.uuid4()), secrets.token_urlsafe(32)
        path = '/api/devices/' + device
        assert request('PUT', path, INFO, owner, key)[0] == 200
        status, enrollment = request('POST', path + '/agent-enrollments', {}, owner, key)
        assert status == 201
        payload = {'enrollmentToken': enrollment['enrollmentToken'], **NATIVE}
        responses = parallel(lambda: request('POST', '/api/host-agent/enroll', payload),
                             lambda: request('PUT', path, INFO, owner, key))
        assert responses[0][0] == 201
        assert responses[1][0] in (200, 409), responses[1][0]
        devices = request('GET', '/api/devices', token=owner)[1]['devices']
        assert len(devices) == 1 and devices[0]['remote']['mode'] == 'agent'
        results.append({'case': 'legacy_update_vs_enrollment', 'statuses': [r[0] for r in responses], 'oneAgentOwner': True})
        assert request('DELETE', path + '/agent', {}, owner)[0] == 204
        assert request('DELETE', path, {}, owner, key)[0] == 204

        # La sesión que se cierra es distinta de la que permite limpiar la cuenta.
        status, source = request('POST', '/api/auth/login', {'email': email, 'password': password, 'deviceName': 'Origen'})
        assert status == 200
        origin = source['token']
        device, key = str(uuid.uuid4()), secrets.token_urlsafe(32)
        path = '/api/devices/' + device
        assert request('PUT', path, INFO, origin, key)[0] == 200
        status, enrollment = request('POST', path + '/agent-enrollments', {}, origin, key)
        assert status == 201
        payload = {'enrollmentToken': enrollment['enrollmentToken'], **NATIVE}
        responses = parallel(lambda: request('POST', '/api/host-agent/enroll', payload),
                             lambda: request('POST', '/api/auth/logout', {}, origin))
        assert responses[0][0] in (201, 400), responses[0][0]
        assert responses[1][0] == 204
        if responses[0][0] == 201:
            assert request('GET', '/api/host-agent/ice-servers', token=responses[0][1]['token'])[0] == 401
        assert request('POST', '/api/host-agent/enroll', payload)[0] == 400
        assert request('DELETE', path, {}, owner, key)[0] == 204
        results.append({'case': 'origin_logout_vs_redemption', 'statuses': [r[0] for r in responses], 'noCredentialSurvived': True})
    finally:
        status, _ = request('DELETE', '/api/me', {'password': password}, owner)
        assert status == 204, 'No se pudo retirar la cuenta temporal'
    print(json.dumps({'schema': 1, 'cases': results, 'temporaryAccountRemoved': True,
                      'productionTested': False}, indent=2))


if __name__ == '__main__':
    main()
