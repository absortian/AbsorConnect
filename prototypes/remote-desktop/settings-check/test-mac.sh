#!/bin/sh
# Ajustes en macOS (add-remote-desktop 6.2), con el backend de desarrollo de otro equipo:
#
#   prototypes/remote-desktop/settings-check/test-mac.sh http://<ip del otro equipo>:8020
#
# Abre la app de verdad, mira la sección "Control remoto de este PC" (permisos de macOS, límites y
# lo que publica en la cuenta), pregunta una vez si coincide con Ajustes del Sistema y pulsa los dos
# "Abrir Ajustes del Sistema". Tarda menos de un minuto.
#
# Deja el resultado en ~/Downloads/absor-settings-check-macos.json (también en el portapapeles) y una
# captura de la sección en ~/Downloads/absor-settings-check-macos.png.
# Antes de lanzarla: Terminal (o la app desde la que se lanza) necesita Accesibilidad y permiso para
# controlar System Events, como en «input-check/test-mac.sh background».
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
. "$here/../lib/mac-electron.sh"
ensure_electron

mkdir -p "$here/out"
log="$here/out/mac.log"
echo "==> Compilando la app y la prueba"
npx electron-vite build >"$log" 2>&1 || {
  tail -n 20 "$log" >&2
  exit 1
}
node_modules/.bin/esbuild "$here/mac.ts" --bundle --platform=node --format=cjs --target=node22 \
  --outfile="$here/out/mac.cjs" --log-level=warning

out="$HOME/Downloads/absor-settings-check-macos.json"
rm -f "$out"
echo
echo "==> La prueba abre Absor Connect y dos paneles de Ajustes del Sistema: no toques nada hasta que"
echo "    salga la pregunta, y respóndela mirando Ajustes del Sistema > Privacidad y seguridad."
set +e
node "$here/out/mac.cjs" "--api=$api" "--macos=$(sw_vers -productVersion)" "--out=$out" 2>>"$log"
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
echo "    Captura de la sección: ${out%.json}.png"
exit $status
