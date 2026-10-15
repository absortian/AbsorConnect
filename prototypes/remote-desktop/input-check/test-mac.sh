#!/bin/sh
# Pruebas manuales de add-remote-desktop en macOS, con Node 22 o posterior:
#
#   prototypes/remote-desktop/input-check/test-mac.sh           # entrada (tarea 4.6)
#   prototypes/remote-desktop/input-check/test-mac.sh support   # permisos y estado (tarea 4.7)
#
# Instala koffi, Electron y esbuild solo en esta carpeta, compila la prueba con los módulos reales
# (src/main/remote), la ejecuta y deja el resultado en ~/Downloads/absor-<prueba>-check-macos.json
# y en el portapapeles. Antes de lanzar la de entrada:
#   - Accesibilidad (Ajustes del Sistema > Privacidad y seguridad) para la app desde la que se lanza
#     (Terminal, iTerm…). La primera vez macOS lo pide: se concede y se vuelve a lanzar.
#   - Para comprobar la Ñ, la distribución activa debe ser Español (o Español - ISO).
#   - Con un monitor externo conectado, la prueba recorre también esa pantalla.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
cd "$here"

mode=${1:-input}
case "$mode" in
  input | support) ;;
  *)
    echo "Uso: $0 [input|support]" >&2
    exit 1
    ;;
esac

if [ "$(uname)" != Darwin ]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
# Con sudo, node_modules queda a nombre de root y la prueba correría como otro usuario
if [ "$(id -u)" = 0 ]; then
  echo "Lánzalo sin sudo." >&2
  exit 1
fi
if [ -n "$(find "$here" ! -user "$(id -u)" -print 2>/dev/null | head -n 1)" ]; then
  echo "Hay ficheros de otro usuario (¿una ejecución con sudo?). Bórralos y vuelve a lanzarlo:" >&2
  echo "  sudo rm -rf '$here/node_modules' '$here/out'" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node 22 (npm)." >&2
  exit 1
fi

echo "==> Instalando koffi, Electron y esbuild en $here"
npm install --no-audit --no-fund --loglevel=error

# El postinstall de Electron no sirve con Node 26: extract-zip (yauzl 2.10) se corta tras la
# primera carpeta del zip y sale con código 0, sin path.txt. Si falta el binario, se descarga la
# misma release, se comprueba con el checksums.json del paquete y se extrae con ditto, que
# conserva los enlaces y las firmas del .app
electron_ok() {
  node -e "process.exit(require('fs').existsSync(require('electron')) ? 0 : 1)" >/dev/null 2>&1
}
if ! electron_ok; then
  version=$(node -p "require('./node_modules/electron/package.json').version")
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    *) arch=x64 ;;
  esac
  zip="electron-v$version-darwin-$arch.zip"
  sum=$(node -p "require('./node_modules/electron/checksums.json')['$zip']")
  # El que dejó a medias el postinstall, si está en la caché de Electron
  cached=$(find "$HOME/Library/Caches/electron" -name "$zip" 2>/dev/null | head -n 1)
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  if [ -n "$cached" ] && echo "$sum  $cached" | shasum -a 256 -c - >/dev/null 2>&1; then
    echo "==> Usando $zip de la caché de Electron"
    cp "$cached" "$tmp/$zip"
  else
    echo "==> Descargando $zip"
    curl -fL --progress-bar -o "$tmp/$zip" \
      "https://github.com/electron/electron/releases/download/v$version/$zip"
  fi
  if ! echo "$sum  $tmp/$zip" | shasum -a 256 -c - >/dev/null 2>&1; then
    echo "La suma SHA-256 de $zip no coincide con la de checksums.json." >&2
    exit 1
  fi
  rm -rf node_modules/electron/dist
  ditto -x -k "$tmp/$zip" node_modules/electron/dist
  printf 'Electron.app/Contents/MacOS/Electron' >node_modules/electron/path.txt
fi
if ! electron_ok; then
  echo "Electron sigue sin su binario: borra $here/node_modules y vuelve a lanzar el script." >&2
  exit 1
fi
# koffi carga su binario del paquete @koromix/koffi-<sistema>: no necesita su script
if ! node -e "require('koffi')" >/dev/null 2>&1; then
  echo "koffi no carga: borra $here/node_modules y vuelve a lanzar el script." >&2
  exit 1
fi

echo "==> Compilando la prueba con src/main/remote/input"
node_modules/.bin/esbuild main.ts --bundle --platform=node --format=cjs --target=node22 \
  --external:electron --external:koffi --outfile=out/main.cjs --log-level=warning

# La tecla a la derecha de la L da "ñ" en español y ";" en inglés
layout=$(defaults read com.apple.HIToolbox AppleSelectedInputSources 2>/dev/null |
  awk -F' = ' '/"KeyboardLayout Name"/ { gsub(/[";]/, "", $2); print $2; exit }')
case "$layout" in
  *Spanish* | *Español*) semicolon='ñ' ;;
  U.S. | ABC | 'ABC - Extended' | 'U.S. International - PC' | British | 'British - PC') semicolon=';' ;;
  *)
    semicolon='ñ'
    echo "Aviso: distribución \"$layout\". Para comprobar la Ñ, cambia a Español y vuelve a lanzarlo."
    ;;
esac
# Desplazamiento natural (activado por defecto): por si invierte la rueda inyectada
natural=$(defaults read -g com.apple.swipescrolldirection 2>/dev/null || echo 1)
macos=$(sw_vers -productVersion)
out="$HOME/Downloads/absor-$mode-check-macos.json"
rm -f "$out"

echo
echo "==> Distribución: ${layout:-desconocida} · desplazamiento natural: $natural · macOS $macos"
if [ "$mode" = input ]; then
  echo "==> La prueba tapa las pantallas unos 20 s: suelta el ratón y el teclado."
  sleep 3
else
  echo "==> Responde a las preguntas que irán saliendo. Se abrirán dos paneles de Ajustes del Sistema."
fi

set +e
node_modules/.bin/electron . "--mode=$mode" "--semicolon=$semicolon" "--layout=$layout" \
  "--natural-scroll=$natural" "--macos=$macos" "--out=$out" 2>"$here/out/electron.log"
status=$?
set -e

if [ ! -f "$out" ]; then
  echo "No se ha generado $out. Final de $here/out/electron.log:" >&2
  tail -n 20 "$here/out/electron.log" >&2
  exit 1
fi
pbcopy <"$out"
echo
echo "==> Resultado en $out (también está en el portapapeles, para pegarlo en el chat)."
exit $status
