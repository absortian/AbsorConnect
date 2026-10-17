#!/bin/bash
# El lado de este Linux para package-check/test-mac.sh (add-remote-desktop 8.1): controla los dos
# .app que el Mac va arrancando como PC.
#   1. El primero (el de la arquitectura del Mac), con el controlador de escritorio de lan-check.
#   2. El segundo (x64 con Rosetta), desde el móvil: la prueba de mobile-check en el emulador
#      (contenedor absor-emulator), contra la sonda del Mac en la red local.
# Se lanza antes o a la vez que el script del Mac y espera hasta 3 horas a cada PC:
#
#   prototypes/remote-desktop/package-check/control-mac.sh
#
# Deja controller.json y la carpeta del móvil (report.json y capturas) en package-check/out.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
api=${API:-http://127.0.0.1:8020}
serial=${ANDROID_SERIAL:-emulator-5556}
out="$here/out"
mkdir -p "$out"
cd "$root"

if ! docker ps --format '{{.Names}}' | grep -qx absor-emulator; then
  echo "No está en marcha el contenedor absor-emulator (ver prototypes/remote-desktop/README.md)." >&2
  exit 1
fi
docker compose exec -T database psql -U app -d app -qc "delete from cache_items" >/dev/null
bin/dev sh -c 'cd prototypes/remote-desktop/lan-check && for r in controller wait-pc; do npx esbuild $r.ts --bundle --platform=node --format=cjs --target=node22 --external:electron --outfile=out/$r.cjs --log-level=warning; done'

echo "==> 1. Esperando al primer .app del Mac para el controlador de escritorio"
work=$(mktemp -d)
node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/controller.cjs "--api=$api" \
  "--work=$work/controller" "--out=$out/controller.json" --wait=180 >"$out/controller.log" 2>&1 || true
grep -E "^(OK|FALLO)" "$out/controller.log" | cut -c1-160 || true

echo "==> 2. Esperando al segundo .app del Mac para el móvil"
docker compose exec -T database psql -U app -d app -qc "delete from cache_items" >/dev/null
probe=$(ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/wait-pc.cjs \
  "--api=$api" --prefix="PC de prueba macOS" --minutes=180)
echo "    sonda del Mac: $probe"
docker exec -e ANDROID_SERIAL="$serial" -e PROBE_URL="$probe" -e PC_FILTER="PC de prueba macOS" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" absor-emulator \
  bash /repo/prototypes/remote-desktop/mobile-check/drive.sh /repo/prototypes/remote-desktop/package-check/out/mobile || true
curl -s -X POST "$probe/done" >/dev/null || true
python3 -c "
import json; r=json.load(open('$out/mobile/report.json'))
ok=sum(1 for c in r['checks'] if c['ok']); print(f'\n{ok}/{len(r[\"checks\"])} comprobaciones del móvil bien.')"
