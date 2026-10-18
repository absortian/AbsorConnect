#!/bin/bash
# Contraseña local del PC (add-remote-desktop 9.3, spec remote-access-host): en un solo Linux, con
# el PC empaquetado y el móvil en el emulador (como mobile-check), la contraseña no aparece en claro
# en la carpeta de datos del PC, ni en la base de datos del servicio, ni en el tráfico con la API.
#
#   APP=dist/absor-connect-<versión>.AppImage prototypes/remote-desktop/password-check/check.sh
#
#   1. Un proxy anota el tráfico de los dos equipos con la API (proxy.py, en el 8021).
#   2. La propia app crea la contraseña y activa el control remoto, como desde Ajustes
#      (pc.ts --password-in-app=1), y el móvil se conecta: las 17 comprobaciones de mobile-check.
#   3. Se vuelca la base de datos y se buscan la contraseña y K (analyze.py).
# Deja report.json en password-check/out. Necesita el contenedor absor-emulator en marcha.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
app=$(cd "$root" && realpath "${APP:?APP=<AppImage o ejecutable empaquetado>}")
out="$here/out"
rm -rf "$out"
mkdir -p "$out"
cd "$root"

python3 -I "$here/proxy.py" 8021 http://127.0.0.1:8020 "$out/traffic.jsonl" &
proxy=$!
trap 'kill $proxy 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:8021/api/health && break; sleep 0.5; done

WORK="$out/work" APP="$app" API=http://127.0.0.1:8021 MOBILE_API=http://10.0.2.2:8021 PC_ARGS=--password-in-app=1 \
  prototypes/remote-desktop/mobile-check/run.sh || true

docker compose exec -T database pg_dump -U app -d app --data-only >"$out/db.sql"
password=$(sed -n "s/^export const PC_PASSWORD = '\(.*\)'$/\1/p" prototypes/remote-desktop/lan-check/common.ts)
python3 -I "$here/analyze.py" "$out" "$password" >"$out/report.json"
cat "$out/report.json"
