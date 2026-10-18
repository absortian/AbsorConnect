#!/bin/bash
# Control remoto desde el móvil contra un PC de verdad (add-remote-desktop 7.3), en un solo Linux:
#   - el PC: la app de escritorio con la prueba entre dos equipos (lan-check/pc.ts), en este X;
#   - el móvil: la app en el emulador de Android del contenedor absor-emulator (ver el README),
#     con la prueba integration_test/remote_desktop_test.dart.
# Deja las capturas y report.json en mobile-check/out.
# Con APP=<ejecutable>, el PC es ese paquete (un AppImage, linux-unpacked…) en vez de la app de
# desarrollo del repo (tarea 8.1). API y MOBILE_API cambian el backend del PC y el del emulador
# (por ejemplo, un proxy que anota el tráfico); WORK, la carpeta de datos del PC, y PC_ARGS, más
# opciones para pc.ts (como --password-in-app=1).
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
# Límites de intentos del backend de desarrollo a cero (como tool/test_env.sh)
docker compose exec -T database psql -U app -d app -qc "delete from cache_items" >/dev/null

echo "==> PC de prueba en este equipo"
bin/dev sh -c 'cd prototypes/remote-desktop/lan-check && npx esbuild pc.ts --bundle --platform=node --format=cjs --target=node22 --external:electron --outfile=out/pc.cjs --log-level=warning'
work=${WORK:-$(mktemp -d)}
node_modules/electron/dist/electron prototypes/remote-desktop/lan-check/out/pc.cjs "--api=$api" "--work=$work/pc" "--out=$out/pc.json" --minutes=20 ${APP:+"--app=$APP"} ${PC_ARGS:-} >"$out/pc.log" 2>&1 &
pc=$!
# Un AppImage lanza la app como hija: se cierra todo lo que use la carpeta de datos de la prueba
trap 'curl -s -X POST http://127.0.0.1:8790/done >/dev/null 2>&1; sleep 3; kill $pc 2>/dev/null || true; pkill -f -- "--user-data-dir=$work/pc" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:8790/state >/dev/null && break; sleep 1; done

echo "==> La app en el emulador ($serial)"
docker exec -e ANDROID_SERIAL="$serial" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e API_URL="${MOBILE_API:-http://10.0.2.2:8020}" absor-emulator \
  bash /repo/prototypes/remote-desktop/mobile-check/drive.sh /repo/prototypes/remote-desktop/mobile-check/out
python3 -c "
import json; r=json.load(open('$out/report.json'))
ok=sum(1 for c in r['checks'] if c['ok']); print(f'\n{ok}/{len(r[\"checks\"])} comprobaciones bien.')"
