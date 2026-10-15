#!/bin/sh
# Prueba de la inyección de entrada en macOS (tarea 4.6 de add-remote-desktop), con Node 22:
#
#   prototypes/remote-desktop/input-check/test-mac.sh
#
# Instala koffi, Electron y esbuild solo en esta carpeta, compila la prueba con el módulo real
# (src/main/remote/input), la ejecuta y deja el resultado en ~/Downloads/absor-input-check-macos.json
# y en el portapapeles. Antes de lanzarlo:
#   - Accesibilidad (Ajustes del Sistema > Privacidad y seguridad) para la app desde la que se lanza
#     (Terminal, iTerm…). La primera vez macOS lo pide: se concede y se vuelve a lanzar.
#   - Para comprobar la Ñ, la distribución activa debe ser Español (o Español - ISO).
#   - Con un monitor externo conectado, la prueba recorre también esa pantalla.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
cd "$here"

if [ "$(uname)" != Darwin ]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Falta Node 22 (npm)." >&2
  exit 1
fi

echo "==> Instalando koffi, Electron y esbuild en $here"
npm install --no-audit --no-fund --loglevel=error

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
out="$HOME/Downloads/absor-input-check-macos.json"
rm -f "$out"

echo
echo "==> Distribución: ${layout:-desconocida} · desplazamiento natural: $natural · macOS $macos"
echo "==> La prueba tapa las pantallas unos 20 s: suelta el ratón y el teclado."
sleep 3

set +e
node_modules/.bin/electron . "--semicolon=$semicolon" "--layout=$layout" \
  "--natural-scroll=$natural" "--macos=$macos" "--out=$out" 2>"$here/out/electron.log"
status=$?
set -e

if [ ! -f "$out" ]; then
  echo "No se ha generado $out. El error está en $here/out/electron.log" >&2
  exit 1
fi
pbcopy <"$out"
echo
echo "==> Resultado en $out (también está en el portapapeles, para pegarlo en el chat)."
exit $status
