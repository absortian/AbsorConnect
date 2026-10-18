"""Busca la contraseña del PC y K en el disco, la base de datos y el tráfico con la API (9.3).

    python3 -I analyze.py <carpeta out de check.sh> <contraseña del PC>

K = PBKDF2-HMAC-SHA256(contraseña en NFC, sal, iteraciones) se calcula con la sal y las
iteraciones que el PC guarda en remote-access.json (la sal sola no permite comprobar nada).
"""
import base64
import glob
import hashlib
import json
import os
import sys
import unicodedata

out, password = sys.argv[1], sys.argv[2]
nfc, nfd = unicodedata.normalize('NFC', password), unicodedata.normalize('NFD', password)


needles = {}
for name, value in (('contraseña NFC', nfc), ('contraseña NFD', nfd)):
    needles[f'{name} (UTF-8)'] = value.encode('utf-8')
    needles[f'{name} (UTF-16LE)'] = value.encode('utf-16-le')
    needles[f'{name} (base64)'] = base64.b64encode(value.encode('utf-8'))
# La parte ASCII también se encuentra aunque la ñ vaya escapada en un JSON (\u00f1)
ascii_tail = nfc.split('ñ')[-1]
if len(ascii_tail) >= 8:
    needles['contraseña (parte ASCII)'] = ascii_tail.encode()

store_files = glob.glob(os.path.join(out, 'work', '**', 'remote-access.json'), recursive=True)
store = json.load(open(store_files[0])) if store_files else {}
stored = store.get('password') or {}
key_prefix = (stored.get('key') or '')[:3]
if stored:
    k = hashlib.pbkdf2_hmac('sha256', nfc.encode(), base64.b64decode(stored['salt']), stored['iterations'], 32)
    needles['K (base64)'] = base64.b64encode(k)
    needles['K (base64url)'] = base64.urlsafe_b64encode(k).rstrip(b'=')
    needles['K (hex)'] = k.hex().encode()


def search(paths):
    found = {}
    for path in paths:
        try:
            data = open(path, 'rb').read()
        except OSError:
            continue
        for label, needle in needles.items():
            if needle in data:
                found.setdefault(label, []).append(os.path.relpath(path, out))
    return found


disk = [p for p in glob.glob(os.path.join(out, 'work', '**', '*'), recursive=True) if os.path.isfile(p)]
traffic_file = os.path.join(out, 'traffic.jsonl')
requests = [json.loads(line) for line in open(traffic_file, encoding='utf-8')] if os.path.exists(traffic_file) else []
remote_paths = sorted({r['method'] + ' ' + r['path'].split('?')[0] for r in requests if '/remote' in r['path'] or '/devices' in r['path']})

report = {
    'store': {
        'file': os.path.relpath(store_files[0], out) if store_files else None,
        'fields': sorted(store.keys()),
        'password': sorted(stored.keys()),
        'iterations': stored.get('iterations'),
        # v1: cifrada con safeStorage; p1: sin cifrar (sistema sin almacén seguro)
        'keyBox': {'v1:': 'safeStorage', 'p1:': 'sin cifrar'}.get(key_prefix, key_prefix or None),
    },
    'searched': sorted(needles),
    'disk': {'files': len(disk), 'found': search(disk)},
    'database': {'found': search([os.path.join(out, 'db.sql')])},
    'traffic': {'requests': len(requests), 'remoteEndpoints': remote_paths, 'found': search([traffic_file])},
}
print(json.dumps(report, ensure_ascii=False, indent=2))
