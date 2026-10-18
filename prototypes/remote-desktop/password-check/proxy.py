"""Proxy HTTP que anota todo el tráfico con la API (add-remote-desktop 9.3, "Contraseña local del PC").

Escucha en 127.0.0.1:<puerto>, reenvía al backend de desarrollo y escribe cada petición y su
respuesta, con los cuerpos, en un fichero JSON Lines. Lo lanza password-check/check.sh:

    python3 -I proxy.py 8021 http://127.0.0.1:8020 traffic.jsonl
"""
import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, UPSTREAM, LOG = int(sys.argv[1]), sys.argv[2].rstrip('/'), sys.argv[3]
lock = threading.Lock()
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length'}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _forward(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
        request = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, reply, reply_headers = response.status, response.read(), response.headers.items()
        except urllib.error.HTTPError as error:
            status, reply, reply_headers = error.code, error.read(), error.headers.items()
        with lock, open(LOG, 'a', encoding='utf-8') as log:
            log.write(json.dumps({
                'method': self.command,
                'path': self.path,
                # Sin el token ni la clave del equipo: el registro no los necesita
                'requestHeaders': {k: ('…' if k.lower() in ('authorization', 'x-device-key') else v) for k, v in headers.items()},
                'request': (body or b'').decode('utf-8', 'replace'),
                'status': status,
                'response': reply.decode('utf-8', 'replace'),
            }, ensure_ascii=False) + '\n')
        self.send_response(status)
        for key, value in reply_headers:
            if key.lower() not in HOP:
                self.send_header(key, value)
        self.send_header('Content-Length', str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _forward

    def log_message(self, *_):
        pass


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
