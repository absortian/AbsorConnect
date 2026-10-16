#!/bin/sh
# Prueba de control remoto entre este Mac y otro equipo de la misma red (add-remote-desktop 4.8 y
# 6.5), con el backend de desarrollo del otro equipo:
#
#   prototypes/remote-desktop/lan-check/lan-test.sh http://<ip del otro equipo>:8020 [pc|controlador]
#
# Sin el segundo argumento hace las dos fases; con `pc` o `controlador`, solo esa.
#
#   1. Este Mac hace de PC controlado: el otro equipo lo controla (ratón, teclado, rueda, aviso,
#      bandeja, ficheros, portapapeles, una sesión a la vez, mantener despierto, cortes desde el PC
#      y confirmación local). Los ficheros de prueba que llegan a Descargas/Absor Connect se borran
#      al terminar.
#      A mitad de la prueba sale la pregunta de control remoto dos veces: la primera NO se responde
#      (se rechaza sola a los 30 s) y la segunda se responde con «Permitir». La ventana de la prueba
#      lo va diciendo.
#   2. Este Mac controla el otro equipo: también envía y descarga ficheros y prueba el portapapeles
#      (escribe textos e imágenes de prueba en el portapapeles del Mac). Si el Mac está conectado
#      por Wi-Fi, la corta 10 s para probar la reconexión.
#
# Deja el resultado en ~/Downloads/absor-lan-check-macos.json y en el portapapeles.
# Antes de lanzarla:
#   - Grabación de pantalla y Accesibilidad concedidas a Terminal (o a la app desde la que se lanza),
#     como en «test-mac.sh support».
#   - Si el cortafuegos de macOS pregunta si «Electron» acepta conexiones entrantes: Permitir.
#   - No toques el ratón ni el teclado mientras dura (unos 10 min), salvo para «Permitir».
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)

api=${1:-}
phases=${2:-ambas}
case "$api" in
  http://* | https://*) api=${api%/} ;;
  *)
    echo "Uso: $0 http://<ip del otro equipo>:8020 [pc|controlador]" >&2
    exit 1
    ;;
esac
case "$phases" in
  ambas | pc | controlador) ;;
  *)
    echo "La fase es «pc» o «controlador» (sin ella, las dos)." >&2
    exit 1
    ;;
esac
if [ "$(uname)" != Darwin ]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
if [ "$(id -u)" = 0 ]; then
  echo "Lánzalo sin sudo." >&2
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

echo "==> Comprobando el backend en $api"
if ! curl -fsS --max-time 5 "$api/api/health" >/dev/null; then
  echo "No llego al backend en $api: ¿el otro equipo está encendido, con el backend en marcha y en la misma red?" >&2
  exit 1
fi

cd "$root"
mkdir -p "$here/out"
log="$here/out/lan-test.log"
: >"$log"
if [ ! -d node_modules ]; then
  echo "==> Instalando las dependencias del repo (npm ci, sin scripts)"
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
fi
. "$root/prototypes/remote-desktop/lib/mac-electron.sh"
ensure_electron
if ! node -e "require('koffi')" >/dev/null 2>&1; then
  echo "koffi no carga en node_modules: borra node_modules y vuelve a lanzar el script." >&2
  exit 1
fi

echo "==> Compilando la app y la prueba"
npx electron-vite build >>"$log" 2>&1 || {
  tail -n 20 "$log" >&2
  exit 1
}
for role in pc controller; do
  node_modules/.bin/esbuild "$here/$role.ts" --bundle --platform=node --format=cjs --target=node22 \
    --external:electron --outfile="$here/out/$role.cjs" --log-level=warning
done

electron="$root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
work="$here/out/work"
pc_out="$here/out/pc-macos.json"
controller_out="$here/out/controller-macos.json"
out="$HOME/Downloads/absor-lan-check-macos.json"
rm -rf "$work" "$pc_out" "$controller_out" "$out"

# Corte de la red en la fase 2: solo si se sale a la red por la Wi-Fi
wifi=$(networksetup -listallhardwareports 2>/dev/null | awk '/Hardware Port: (Wi-Fi|AirPort)/ { getline; print $2; exit }')
route=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')
cut=""
if [ -n "$wifi" ] && [ "$wifi" = "$route" ]; then
  cut="--cut-network=$wifi"
fi

set +e
pc_status=0
controller_status=0
if [ "$phases" != controlador ]; then
  echo
  echo "==> Fase 1: este Mac es el PC controlado (macOS $(sw_vers -productVersion))."
  echo "    Una ventana tapa la pantalla. No toques nada salvo lo que diga esa ventana (pulsar"
  echo "    «Permitir» en la pregunta de control remoto la segunda vez que salga)."
  "$electron" "$here/out/pc.cjs" "--api=$api" "--work=$work/pc" "--out=$pc_out" --minutes=30 2>>"$log"
  pc_status=$?
fi

if [ "$phases" != pc ]; then
  echo
  echo "==> Fase 2: este Mac controla el otro equipo."
  if [ -n "$cut" ]; then
    echo "    Al final corta la Wi-Fi ($wifi) 10 s y la vuelve a activar."
  else
    echo "    No sale a la red por Wi-Fi: la prueba de cortar la red se salta."
  fi
  "$electron" "$here/out/controller.cjs" "--api=$api" "--work=$work/controller" \
    "--out=$controller_out" --wait=30 $cut 2>>"$log"
  controller_status=$?
  # Por si la prueba se cortó a mitad del corte de la red
  if [ -n "$cut" ]; then
    networksetup -setairportpower "$wifi" on >/dev/null 2>&1
  fi
fi
set -e

node -e '
const fs = require("fs")
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) { return { error: "sin resultado: " + e.message } } }
const [pc, controller, out, macos, phases] = process.argv.slice(1)
const result = { macos, phases }
if (phases !== "controlador") result.pc = read(pc)
if (phases !== "pc") result.controller = read(controller)
fs.writeFileSync(out, JSON.stringify(result, null, 2))
' "$pc_out" "$controller_out" "$out" "$(sw_vers -productVersion)" "$phases"
pbcopy <"$out"
echo
echo "==> Resultado en $out (también está en el portapapeles, para pegarlo en el chat)."
if [ $pc_status -ne 0 ] || [ $controller_status -ne 0 ]; then
  echo "    Alguna comprobación ha fallado o no se ha podido hacer: se ve en el JSON. Registro: $log"
  exit 1
fi
