#!/bin/sh
# Paquetes de macOS (add-remote-desktop 8.1), con el backend de desarrollo de otro equipo, que es
# también el que controla este Mac (package-check/control-mac.sh):
#
#   prototypes/remote-desktop/package-check/test-mac.sh http://<ip del otro equipo>:8020 [x64]
#
# Con «x64» solo repite la fase 4 con los paquetes que ya están en dist (por ejemplo, después de
# instalar Rosetta con «softwareupdate --install-rosetta --agree-to-license»).
#
# 1. Empaqueta como la CI (release.yml): npm ci, el binario de koffi de la otra arquitectura sin
#    guardarlo y npm run build:mac, que hace el .dmg y el .zip de arm64 y de x64.
# 2. Mira los dos .app: su binario de koffi desempaquetado y de su arquitectura, la clave
#    NSAudioCaptureUsageDescription, los iconos de la bandeja y la firma ad-hoc.
# 3. El .app de la arquitectura de este Mac hace de PC controlado (lan-check/pc.ts con --app) y lo
#    controla el otro equipo con el controlador de escritorio, como en «lan-test.sh … pc»: ratón,
#    teclado, aviso, bandeja, ficheros, portapapeles, sonido… A mitad sale la pregunta de control
#    remoto dos veces: la primera NO se responde (se rechaza sola a los 30 s) y la segunda se
#    responde con «Permitir». La ventana de la prueba lo va diciendo.
# 4. El otro .app (x64 con Rosetta en un Mac con Apple Silicon) hace de PC y lo controla el móvil
#    del otro equipo (el emulador de Android). Aquí no hay que hacer nada.
#
# Deja el resultado en ~/Downloads/absor-package-check-macos.json y en el portapapeles.
# Antes de lanzarla:
#   - Grabación de pantalla y Accesibilidad para Terminal (o la app desde la que se lanza), como en
#     lan-test.sh: el .app lo arranca la prueba desde Terminal y usa sus permisos.
#   - Si el cortafuegos de macOS pregunta si la app acepta conexiones entrantes: Permitir.
#   - No toques el ratón ni el teclado mientras dura (unos 25 min), salvo para «Permitir».
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
lan="$root/prototypes/remote-desktop/lan-check"

api=${1:-}
only=${2:-}
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
if [ "$(id -u)" = 0 ]; then
  echo "Lánzalo sin sudo." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node 22 (npm)." >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64 other=x64 ;;
  *) arch=x64 other=arm64 ;;
esac
echo "==> Comprobando el backend en $api"
if ! curl -fsS --max-time 5 "$api/api/health" >/dev/null; then
  echo "No llego al backend en $api: ¿el otro equipo está encendido, con el backend en marcha y en la misma red?" >&2
  exit 1
fi

cd "$root"
out="$here/out"
log="$out/test-mac.log"
# electron-builder deja el de x64 en dist/mac y el de arm64 en dist/mac-arm64
app_of() {
  if [ "$1" = arm64 ]; then echo "$root/dist/mac-arm64/Absor Connect.app"; else echo "$root/dist/mac/Absor Connect.app"; fi
}
if [ "$only" = x64 ]; then
  if [ ! -d "$(app_of x64)" ] || [ ! -f "$out/pc.cjs" ]; then
    echo "Faltan los paquetes de una ejecución completa: lánzalo antes sin «x64»." >&2
    exit 1
  fi
else
  rm -rf "$out"
fi
mkdir -p "$out"
electron="$root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ "$only" != x64 ]; then

echo "==> 1. Paquetes como en CI (npm ci y npm run build:mac; unos 5 minutos)"
npm ci --no-audit --no-fund --loglevel=error >>"$log" 2>&1
# El mismo paso que release.yml, para la arquitectura que no es la de este Mac
version=$(node -p "require('./node_modules/koffi/package.json').version")
npm install --no-save --force --ignore-scripts --no-audit --no-fund --loglevel=error "@koromix/koffi-darwin-$other@$version" >>"$log" 2>&1
. "$root/prototypes/remote-desktop/lib/mac-electron.sh"
ensure_electron
if ! MAIN_VITE_API_URL=https://absorconnect.absor.top npm run build:mac >>"$log" 2>&1; then
  tail -n 30 "$log" >&2
  exit 1
fi

echo "==> 2. Lo que llevan los dos .app"
for a in arm64 x64; do
  app=$(app_of "$a")
  unpacked="$app/Contents/Resources/app.asar.unpacked"
  machine=$([ "$a" = x64 ] && echo x86_64 || echo arm64)
  {
    echo "app=$([ -d "$app" ] && echo si || echo no)"
    echo "exe=$(lipo -archs "$app/Contents/MacOS/Absor Connect" 2>/dev/null || echo falta)"
    echo "koffi=$(lipo -archs "$unpacked/node_modules/@koromix/koffi-darwin-$a/darwin_$a/koffi.node" 2>/dev/null || echo falta)"
    echo "koffiOtros=$(ls "$unpacked/node_modules/@koromix" 2>/dev/null | tr '\n' ' ')"
    echo "audio=$(plutil -extract NSAudioCaptureUsageDescription raw "$app/Contents/Info.plist" 2>/dev/null || echo falta)"
    echo "bandeja=$([ -f "$unpacked/resources/trayTemplate.png" ] && [ -f "$unpacked/resources/trayTemplate@2x.png" ] && echo si || echo no)"
    echo "firma=$(codesign --verify --deep --strict "$app" >/dev/null 2>&1 && echo valida || echo invalida)"
    echo "esperado=$machine"
  } >"$out/bundle-$a.txt"
done
ls "$root/dist" | grep -E '\.(dmg|zip)$' >"$out/artifacts.txt" || true

node_modules/.bin/esbuild "$lan/pc.ts" --bundle --platform=node --format=cjs --target=node22 \
  --external:electron --outfile="$out/pc.cjs" --log-level=warning

echo
echo "==> 3. El .app de $arch es el PC; lo controla el escritorio del otro equipo."
echo "    Una ventana tapa la pantalla. No toques nada salvo lo que diga esa ventana (pulsar"
echo "    «Permitir» en la pregunta de control remoto la segunda vez que salga)."
"$electron" "$out/pc.cjs" "--api=$api" "--work=$out/work-$arch" "--out=$out/pc-$arch.json" --minutes=40 \
  "--app=$(app_of "$arch")/Contents/MacOS/Absor Connect" 2>>"$log" || true
fi

set +e

echo
if [ "$other" = x64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  echo "==> 4. Sin Rosetta no se puede abrir el .app de x64: se salta (softwareupdate --install-rosetta)."
  echo '{"skipped":"sin Rosetta"}' >"$out/pc-$other.json"
else
  echo "==> 4. El .app de $other es el PC; lo controla el móvil del otro equipo. No toques nada."
  "$electron" "$out/pc.cjs" "--api=$api" "--work=$out/work-$other" "--out=$out/pc-$other.json" --minutes=40 \
    "--app=$(app_of "$other")/Contents/MacOS/Absor Connect" 2>>"$log"
fi
set -e

result="$HOME/Downloads/absor-package-check-macos.json"
node -e '
const fs = require("fs")
const path = require("path")
const [dir, macos, arch] = process.argv.slice(1)
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) } catch (e) { return { error: "sin resultado: " + e.message } } }
const kv = (f) => Object.fromEntries(fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
const summary = (r) => r.checks ? { ok: r.checks.filter((c) => c.ok).length, total: r.checks.length, failed: r.checks.filter((c) => !c.ok) } : r
const result = {
  macos, arch,
  artifacts: fs.readFileSync(path.join(dir, "artifacts.txt"), "utf8").trim().split("\n").filter(Boolean),
  bundles: { arm64: kv("bundle-arm64.txt"), x64: kv("bundle-x64.txt") },
  pc: { arm64: summary(read("pc-arm64.json")), x64: summary(read("pc-x64.json")) }
}
console.log(JSON.stringify(result, null, 2))
' "$out" "$(sw_vers -productVersion)" "$arch" >"$result"
pbcopy <"$result"
cat "$result"
echo
echo "==> Resultado en $result (también en el portapapeles). Registro: $log"
