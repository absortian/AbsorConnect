"""Controlador móvil de VM propia. La API y sus credenciales permanecen en Python."""
import json
import time

NAMES = ['correct', 'correct-reconnect', 'wrong-proof', 'fingerprint-mismatch']
RUNTIME_NAMES = ['correct','correct-reconnect','correct-auto-reconnect']


class MobileController:
    def __init__(self, owned, signals, request, output, ice, mapping=None, runtime=False, screenshot=None, prepare=None, background=None):
        self.owned, self.signals, self.request, self.output = owned, signals, request, output
        self.ice = ice
        self.runtime = runtime
        self.screenshot = screenshot
        self.prepare = prepare
        self.background = background
        self.mapping = mapping
        self.results = []

    def get(self, handler):
        if handler.path != '/mobile/config':
            return False
        handler.reply(200, {**self.ice, 'nativeFixture': True, 'cases': ['correct','correct-reconnect'] if self.runtime else NAMES})
        return True

    def post(self, handler):
        if not handler.path.startswith('/mobile/'):
            return False
        parts = handler.path.split('/')
        assert len(parts) == 4 and parts[2] in ('offer', 'result', 'screenshot', 'prepare', 'background', 'checkpoint') and parts[3] in (RUNTIME_NAMES if self.runtime else NAMES)
        operation, name = parts[2:]
        assert name in self.owned
        item = self.owned[name]
        if operation == 'background':
            assert self.runtime and self.background and name in ('correct','correct-reconnect') and handler.body(128)=={}
            seconds = 10 if name == 'correct' else 31
            self.background(seconds);item['backgroundSeconds']=seconds
            handler.reply(200,{'ok':True,'seconds':seconds});return True
        if operation == 'prepare':
            assert self.runtime and self.prepare and handler.body(128)=={}
            self.prepare();handler.reply(200,{'ok':True});return True
        if operation == 'screenshot':
            assert self.runtime and self.screenshot and name in RUNTIME_NAMES and handler.body(128)=={}
            self.screenshot(name);handler.reply(200,{'ok':True,'nativeGreenVerified':True});return True
        if operation == 'offer':
            if name=='correct-auto-reconnect':assert self.runtime and item['autoWorkerReady'].wait(30),'recovery_worker_not_ready'
            body = handler.body(70000)
            assert set(body) == {'sdp'} and isinstance(body['sdp'], str) and 0 < len(body['sdp'].encode()) <= 65536
            assert name not in self.signals
            deadline = time.monotonic() + 30
            while time.monotonic() - item.get('lastPoll', 0) > 1:
                assert time.monotonic() < deadline
                time.sleep(.02)
            status, pending = self.request('POST', item['path'] + '/remote-requests', {'offer': body['sdp']}, item['owner'])
            assert status == 201
            self.signals[name] = {'id': pending['id'], 'offer': body['sdp']}
            while time.monotonic() < deadline:
                status, response = self.request('GET', '/api/remote-requests/' + pending['id'], token=item['owner'])
                assert status == 200
                if response.get('status') == 'answered':
                    handler.reply(200, {'sdp': response['answer']})
                    return True
                assert response.get('status') == 'pending'
                time.sleep(.05)
            raise RuntimeError('mobile_answer_timeout')
        body = handler.body(4096)
        if self.runtime:
            assert name in ('correct','correct-reconnect')
            assert set(body)=={'nativeGreenVerified','challengeId','helloCount','productionRuntime','productionScreen','authenticated','decodedFrames','width','height','inputSent','extensionNegotiated','contextImageCurrent','sensitiveFeaturesFalse','candidates','backgroundSeconds','backgroundClosed','backgroundRecovered','backgroundElapsedMicros','requestsAfterResume'}
            assert body['backgroundSeconds']==item.get('backgroundSeconds')==(10 if name=='correct' else 31)
            assert isinstance(body['backgroundElapsedMicros'],int) and body['backgroundElapsedMicros']>=body['backgroundSeconds']*1000000
            assert body['backgroundClosed'] is (name=='correct-reconnect') and body['backgroundRecovered'] is (name=='correct')
            assert body['requestsAfterResume'] in ((1,2) if name=='correct' else (1,))
            if body['requestsAfterResume']==2:
                assert 'correct-auto-reconnect' in item.get('greenCases',set())
            assert body['nativeGreenVerified'] is True and name in item.get('greenCases',set())
            import re
            assert body['helloCount']==1 and re.fullmatch('[0-9a-f]{64}',body['challengeId'])
            nonces=item.setdefault('nonces',set())
            if operation != 'checkpoint':
                assert body['challengeId'] not in nonces;nonces.add(body['challengeId'])
            assert all(body[k] is True for k in ['productionRuntime','productionScreen','authenticated','inputSent','extensionNegotiated','contextImageCurrent','sensitiveFeaturesFalse'])
        else:
            assert set(body) == {'authenticated', 'decodedFrames', 'helloCount', 'candidates', 'width', 'height', 'nonce', 'inputSent', 'preAuthInputSent', 'extensionNegotiated'}
            assert body['helloCount'] == 1 and body['preAuthInputSent'] is True
        if operation == 'checkpoint':
            assert self.runtime
            checkpoint=self.output/(name+'-lifecycle-checkpoint.json')
            checkpoint.write_text(json.dumps(body,indent=2));checkpoint.chmod(0o600)
            handler.reply(200,{'ok':True});return True
        expected = name in ('correct', 'correct-reconnect')
        native = item['nativeResult']
        assert native['authenticated'] is expected and body['authenticated'] is expected
        assert native['dtlsConnected'] and native['protectedIpc']
        assert body['extensionNegotiated'] is expected
        assert body['inputSent'] is expected
        counts = native['native']
        assert counts['hostSecretsInWorker'] is False
        assert all(counts[key] == (1 if expected else 0) for key in ('mouseDown', 'mouseUp', 'keyDown', 'keyUp'))
        assert counts['captures'] > 0 if expected else counts['captures'] == 0
        assert body['decodedFrames'] >= 2 if expected else body['decodedFrames'] == 0
        if expected:
            assert (body['width'], body['height']) == (320, 180)
            # El nonce es público, pero solo conservamos su distinción en memoria.
            if not self.runtime:
                import base64
                assert len(base64.b64decode(body['nonce'], validate=True)) == 32
                nonces = item.setdefault('nonces', set())
                assert body['nonce'] not in nonces
                nonces.add(body['nonce'])
        route = body['candidates']
        if self.ice['relayController']:
            assert route['local'] == 'relay'
        else:
            assert route['local'] in ('host', 'prflx', 'srflx') and route['remote'] in ('host', 'prflx', 'srflx')
        body = {k: v for k, v in body.items() if k not in ('nonce','challengeId')}
        result = {'name': name, 'ok': True, 'native': native, 'controller': body, 'directVmNatMapping': self.mapping is not None}
        if self.mapping:self.mapping.close()
        self.results.append(result)
        path = self.output / (name + '-mobile.json')
        path.write_text(json.dumps(result, indent=2) + '\n')
        path.chmod(0o600)
        handler.reply(200, {'ok': True})
        return True


class VmDirectMapping:
    """NAT local de la VM para el AVD: solo UDP loopback, sin relé/router/base del Mac."""
    def __init__(self, vm):
        self.vm = vm
        self.ports = {}
        self.total = 0

    def answer(self, sdp):
        import socket
        lines = sdp.splitlines()
        candidates=[]
        for line in lines:
            parts=line.split()
            if not line.startswith('a=candidate:') or len(parts)<8 or parts[2].lower()!='udp':continue
            assert parts[4]=='10.0.2.15' and parts[6:8]==['typ','host']
            port=int(parts[5]);assert 32768<=port<=65535
            candidates.append(port)
        assert candidates
        for port in candidates:
            if port in self.ports:
                continue
            for attempt in range(4):
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                    probe.bind(('127.0.0.1', 0));host = probe.getsockname()[1]
                with self.vm.Qmp() as q:
                    result = q.call('human-monitor-command', {'command-line': f'hostfwd_add udp:127.0.0.1:{host}-10.0.2.15:{port}'})
                if not result.strip():
                    self.ports[port] = host;self.total += 1;break
                if attempt == 3:
                    raise RuntimeError('vm_udp_mapping_failed')
        assert self.ports
        output = []
        for line in lines:
            parts = line.split()
            if line.startswith('a=candidate:') and len(parts) >= 8 and parts[2].lower() == 'udp':
                port = int(parts[5]);parts[4:6] = ['10.0.2.2', str(self.ports[port])];line = ' '.join(parts)
            elif line == 'c=IN IP4 10.0.2.15':
                line = 'c=IN IP4 10.0.2.2'
            elif line.startswith('m=') and len(parts) > 2 and parts[1].isdigit() and int(parts[1]) in self.ports:
                parts[1] = str(self.ports[int(parts[1])]);line = ' '.join(parts)
            output.append(line)
        answer='\r\n'.join(output)+'\r\n'
        assert [l for l in lines if l.startswith('a=fingerprint:')]==[l for l in answer.splitlines() if l.startswith('a=fingerprint:')]
        return answer

    def close(self):
        if not self.ports:
            return
        with self.vm.Qmp() as q:
            for guest,port in list(self.ports.items()):
                try:
                    response=q.call('human-monitor-command',{'command-line':f'hostfwd_remove udp:127.0.0.1:{port}'})
                    text=response.strip().lower()
                    if not text or 'removed' in text or 'not found' in text:del self.ports[guest]
                except Exception:continue
        assert not self.ports,'vm_udp_cleanup_failed'
