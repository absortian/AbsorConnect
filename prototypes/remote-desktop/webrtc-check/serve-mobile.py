#!/usr/bin/env python3
"""Señalización local y acotada para el controlador Flutter de laboratorio.

Solo acepta tres casos fijos contra el ejecutable artificial identificado. No
ejecuta órdenes del cliente, no captura pantallas y no inyecta entrada.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time

parser = argparse.ArgumentParser()
parser.add_argument('lab', type=Path)
parser.add_argument('--port', type=int, default=8793)
parser.add_argument('--turn-config', type=Path)
args = parser.parse_args()
os.umask(0o077)
lab = args.lab.resolve(strict=True)
binary = lab / 'webrtc-native/src/out/AbsorProbe/video_channel_check'
build = json.loads((lab / 'webrtc-probe-results.json').read_text())
binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
if binary_hash != build['videoEndpoint']['sha256']:
    raise SystemExit('El binario no coincide con su informe de compilación')
work = Path(tempfile.mkdtemp(prefix='mobile-interop-', dir=lab))
os.chmod(work, 0o700)
cases = {}
names = {'correct', 'wrong-proof', 'fingerprint-mismatch'}
ice = {'iceServers': [], 'relayController': False}
native_ice = None
if args.turn_config:
    metadata = args.turn_config.lstat()
    if (args.turn_config.is_symlink() or not args.turn_config.is_file()
            or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_size > 16384):
        raise SystemExit('La configuración TURN debe ser un archivo privado del usuario, de hasta 16 KiB')
    value = json.loads(args.turn_config.read_text())
    if not isinstance(value, dict) or set(value) != {'iceServers'} or not isinstance(value['iceServers'], list) or not 1 <= len(value['iceServers']) <= 8:
        raise SystemExit('Configuración TURN inválida')
    for item in value['iceServers']:
        if (not isinstance(item, dict) or set(item) != {'urls', 'username', 'credential'}
                or not isinstance(item['urls'], list) or not 1 <= len(item['urls']) <= 8
                or any(not isinstance(url, str) or not url.startswith(('turn:', 'turns:', 'stun:')) or len(url) > 512 or any(c.isspace() for c in url) for url in item['urls'])
                or any(not isinstance(item[key], str) or not 1 <= len(item[key]) <= 1024 for key in ('username', 'credential'))):
            raise SystemExit('Usar únicamente servidores TURN y credenciales temporales')
    if not any(url.startswith(('turn:', 'turns:')) for item in value['iceServers'] for url in item['urls']):
        raise SystemExit('Falta servidor TURN')
    ice = {**value, 'relayController': True}
    native_ice = work / 'native-ice.json'
    with native_ice.open('x') as file:
        json.dump({**value, 'iceTransportPolicy': 'all'}, file)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Ni SDP ni mensajes de autenticación en el registro HTTP.

    def reply(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == '/config':
            self.reply(200, ice)
        else:
            self.reply(404, {'error': 'not_found'})

    def do_POST(self):
        try:
            self.handle_post()
        except (ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
            self.reply(400, {'error': 'invalid_lab_request'})
        except Exception:
            self.reply(500, {'error': 'lab_failure'})

    def handle_post(self):
        self.connection.settimeout(10)
        parts = self.path.strip('/').split('/')
        length = int(self.headers.get('Content-Length', '0'))
        if len(parts) != 2 or parts[0] not in {'offer', 'result'} or parts[1] not in names or not 0 < length <= 262144:
            self.reply(400, {'error': 'invalid_lab_request'})
            return
        operation, name = parts
        body = json.loads(self.rfile.read(length))
        if operation == 'offer':
            if name in cases or set(body) != {'sdp'} or not isinstance(body['sdp'], str) or not body['sdp'].startswith('v=0'):
                raise ValueError('Oferta inválida')
            directory = work / name
            directory.mkdir(mode=0o700)
            offer, answer = directory / 'offer.sdp', directory / 'answer.sdp'
            with offer.open('x') as file:
                os.chmod(offer, 0o600)
                file.write(body['sdp'])
            log = (directory / 'native-stderr.txt').open('xb')
            process = subprocess.Popen([str(binary), str(offer), str(answer), *([str(native_ice)] if native_ice else [])], stdout=subprocess.PIPE, stderr=log)
            cases[name] = (process, log)
            deadline = time.monotonic() + 25
            while not answer.exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    process.terminate()
                    raise ValueError('Sin respuesta nativa')
                time.sleep(.05)
            self.reply(200, {'sdp': answer.read_text()})
        else:
            process, log = cases[name]
            stdout, _ = process.communicate(timeout=25)
            log.close()
            native = json.loads(stdout)
            expected = name == 'correct'
            frames = body.get('decodedFrames')
            ok = (process.returncode == 0 and native.get('dtlsConnected') is True
                  and native.get('authenticated') is expected and body.get('authenticated') is expected
                  and native.get('captureStarted') is False and native.get('inputEnabled') is False
                  and isinstance(frames, int) and (frames >= 2 if expected else frames == 0)
                  and (native.get('syntheticVideoFrames', 0) > 0 if expected else native.get('syntheticVideoFrames') == 0))
            candidates = body.get('candidates', {})
            ok = (ok and candidates.get('local') == ('relay' if native_ice else 'host')
                  and (native_ice is not None or candidates.get('remote') == 'host'))
            result = {'name': name, 'ok': ok, 'native': native, 'controller': body,
                      'binarySha256': binary_hash, 'physicalDeviceTested': False,
                      'relayController': native_ice is not None}
            report = work / f'{name}.json'
            with report.open('x') as file:
                os.chmod(report, 0o600)
                json.dump(result, file, indent=2)
            self.reply(200 if ok else 409, result)


server = http.server.HTTPServer(('127.0.0.1', args.port), Handler)
def stop(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
timer = threading.Timer(1800, server.shutdown)
timer.daemon = True
timer.start()
print(json.dumps({'listen': f'http://127.0.0.1:{args.port}', 'reports': str(work)}), flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    timer.cancel()
    server.server_close()
    if native_ice:
        native_ice.unlink(missing_ok=True)
    for process, log in cases.values():
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        log.close()
