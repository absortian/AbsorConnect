#!/bin/sh
# Prototipos de add-remote-desktop en macOS (tareas 1.1 a 1.4), con Node 22 instalado:
#
#   ./test-mac.sh           # batería completa: ratón, PBKDF2 y 60 s de captura con sonido
#   ./test-mac.sh capture   # captura de 5 minutos sin sonido (tarea 1.1)
#
# La primera vez genera el DMG (paquete real, tarea 1.3). Cada vez monta el DMG y abre la app
# desde dentro, espera a que se cierre y lo desmonta. Los resultados quedan en
# ~/Downloads/absor-remote-prototype-darwin-<arquitectura>-<prueba>.json.
set -eu
cd "$(dirname "$0")"

if ! ls dist/*.dmg >/dev/null 2>&1; then
  npm install --no-audit --no-fund
  npx --yes electron-builder@26.15.3 --mac dmg --publish never
fi

dmg=$(ls dist/*.dmg | head -n 1)
mount=$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F '\t' '/\/Volumes\// { print $NF }')
app="$mount/Absor Remote Prototype.app"
trap 'hdiutil detach "$mount" -quiet || true' EXIT

case "${1:-suite}" in
  suite) open -W "$app" ;;
  capture) open -W "$app" --args --mode=capture --seconds=300 --audio=none ;;
  *) echo "Uso: $0 [capture]" >&2; exit 1 ;;
esac
ls -1 "$HOME"/Downloads/absor-remote-prototype-darwin-*.json
