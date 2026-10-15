#!/bin/sh
# Prototipos de add-remote-desktop en macOS (tareas 1.1 a 1.4). Ejecútalo desde esta carpeta
# con Node 22 instalado: genera el DMG (paquete real, tarea 1.3) y abre la app que contiene.
#
# La primera vez macOS pedirá Accesibilidad y Grabación de pantalla para "Absor Remote
# Prototype": concédelos en Ajustes del Sistema › Privacidad y seguridad, cierra la app y
# vuelve a ejecutar la última línea (open …). Al terminar, la app muestra los resultados y
# los guarda en Descargas/absor-remote-prototype-darwin-<arquitectura>.json.
set -eu
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npx electron-builder --mac dmg --publish never
case "$(uname -m)" in
  arm64) app_dir=dist/mac-arm64 ;;
  *) app_dir=dist/mac ;;
esac
open "$app_dir/Absor Remote Prototype.app"
