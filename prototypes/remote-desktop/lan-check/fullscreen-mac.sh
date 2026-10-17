#!/bin/sh
# Salir de la pantalla completa en macOS, a mano (add-remote-desktop 6.5). Este Mac controla el PC
# de prueba del otro equipo, que debe estar ya en marcha (allí: `pc.ts`), con su backend de
# desarrollo:
#
#   prototypes/remote-desktop/lan-check/fullscreen-mac.sh http://<ip del otro equipo>:8020
#
# Unos diálogos piden entrar en pantalla completa y salir de tres maneras (botón verde, botón de la
# barra del visor y Esc) y preguntan si el visor vuelve bien. Tarda unos 3 minutos.
# Deja el resultado en ~/Downloads/absor-fullscreen-check-macos.json (también en el portapapeles).
# Antes de lanzarla: Terminal (o la app desde la que se lanza) necesita permiso para controlar System
# Events, como en «input-check/test-mac.sh background».
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)

api=${1:-}
case "$api" in
  http://* | https://*) api=${api%/} ;;
  *)
    echo "Uso: $0 http://<ip del otro equipo>:8020" >&2
    exit 1
    ;;
esac
if [ "$(uname)" != Darwin ]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node 22 (npm)." >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  *) arch=x64 ;;
esac
if ! curl -sS -o /dev/null --max-time 5 "$api/" 2>/dev/null; then
  echo "No se llega a $api: ¿está levantado el backend en el otro equipo?" >&2
  exit 1
fi

cd "$root"
if [ ! -d node_modules ]; then
  echo "==> Instalando las dependencias del repo (npm ci, sin scripts)"
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
fi
. "$root/prototypes/remote-desktop/lib/mac-electron.sh"
ensure_electron

mkdir -p "$here/out"
log="$here/out/fullscreen-mac.log"
echo "==> Compilando la app y la prueba"
npx electron-vite build >"$log" 2>&1 || {
  tail -n 20 "$log" >&2
  exit 1
}
node_modules/.bin/esbuild "$here/fullscreen-mac.ts" --bundle --platform=node --format=cjs --target=node22 \
  --outfile="$here/out/fullscreen-mac.cjs" --log-level=warning

out="$HOME/Downloads/absor-fullscreen-check-macos.json"
rm -f "$out"
echo
echo "==> Se abre Absor Connect con una sesión al PC del otro equipo. Sigue los diálogos."
set +e
node "$here/out/fullscreen-mac.cjs" "--api=$api" "--work=$here/out/fullscreen-work" "--out=$out" 2>>"$log"
status=$?
set -e

if [ ! -f "$out" ]; then
  echo "No se ha generado $out. Final de $log:" >&2
  tail -n 20 "$log" >&2
  exit 1
fi
pbcopy <"$out"
echo
echo "==> Resultado en $out (también está en el portapapeles, para pegarlo en el chat)."
exit $status
