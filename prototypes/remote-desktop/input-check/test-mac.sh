#!/bin/sh
# Pruebas manuales de add-remote-desktop en macOS, con Node 22 o posterior:
#
#   prototypes/remote-desktop/input-check/test-mac.sh                    # entrada (tarea 4.6)
#   prototypes/remote-desktop/input-check/test-mac.sh support            # permisos y estado (4.7)
#   prototypes/remote-desktop/input-check/test-mac.sh background         # segundo plano y actualizaciones (4.1 y 4.2)
#   prototypes/remote-desktop/input-check/test-mac.sh background-login   # tras cerrar y abrir sesión (4.1)
#
# Deja el resultado en ~/Downloads/absor-<prueba>-check-macos.json y en el portapapeles.
#   - input y support instalan koffi, Electron y esbuild solo en esta carpeta y compilan la prueba
#     con los módulos reales (src/main/remote).
#   - background empaqueta la app de verdad como AbsorCheck.app (dist/check), con otro nombre, appId
#     y carpeta de datos, y versión 0.0.1 para que la última release cuente como versión nueva; no
#     toca Absor Connect si está instalado. Usa node_modules del repo (npm ci la primera vez).
# Antes de lanzarlas:
#   - Accesibilidad (Ajustes del Sistema > Privacidad y seguridad) para la app desde la que se lanza
#     (Terminal, iTerm…). La primera vez macOS lo pide: se concede y se vuelve a lanzar. background
#     pide además permiso para que Terminal controle System Events.
#   - Para comprobar la Ñ, la distribución activa debe ser Español (o Español - ISO).
#   - Con un monitor externo conectado, la prueba de entrada recorre también esa pantalla.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)
cd "$here"

mode=${1:-input}
case "$mode" in
  input | support | background | background-login) ;;
  *)
    echo "Uso: $0 [input|support|background|background-login]" >&2
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
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  *) arch=x64 ;;
esac

# El postinstall de Electron no sirve con Node 26: extract-zip (yauzl 2.10) se corta tras la
# primera carpeta del zip y sale con código 0, sin path.txt. Si falta el binario en el node_modules
# de la carpeta actual, se descarga la misma release, se comprueba con el checksums.json del
# paquete y se extrae con ditto, que conserva los enlaces y las firmas del .app
electron_ok() {
  node -e "process.exit(require('fs').existsSync(require('electron')) ? 0 : 1)" >/dev/null 2>&1
}
ensure_electron() {
  if electron_ok; then
    return
  fi
  version=$(node -p "require('./node_modules/electron/package.json').version")
  zip="electron-v$version-darwin-$arch.zip"
  sum=$(node -p "require('./node_modules/electron/checksums.json')['$zip']")
  # El que dejó a medias el postinstall, si está en la caché de Electron
  cached=$(find "$HOME/Library/Caches/electron" -name "$zip" 2>/dev/null | head -n 1)
  tmp=$(mktemp -d)
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
    rm -rf "$tmp"
    exit 1
  fi
  rm -rf node_modules/electron/dist
  ditto -x -k "$tmp/$zip" node_modules/electron/dist
  printf 'Electron.app/Contents/MacOS/Electron' >node_modules/electron/path.txt
  rm -rf "$tmp"
  if ! electron_ok; then
    echo "Electron sigue sin su binario: borra $(pwd)/node_modules y vuelve a lanzar el script." >&2
    exit 1
  fi
}

macos=$(sw_vers -productVersion)
out="$HOME/Downloads/absor-$mode-check-macos.json"
rm -f "$out"
mkdir -p "$here/out"
log="$here/out/$mode.log"

case "$mode" in
  input | support)
    echo "==> Instalando koffi, Electron y esbuild en $here"
    npm install --no-audit --no-fund --loglevel=error
    ensure_electron
    # koffi carga su binario del paquete @koromix/koffi-<sistema>: no necesita su script
    if ! node -e "require('koffi')" >/dev/null 2>&1; then
      echo "koffi no carga: borra $here/node_modules y vuelve a lanzar el script." >&2
      exit 1
    fi

    echo "==> Compilando la prueba con src/main/remote"
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
      "--natural-scroll=$natural" "--macos=$macos" "--out=$out" 2>"$log"
    status=$?
    set -e
    ;;

  background | background-login)
    if [ "$mode" = background ]; then
      cd "$root"
      if [ ! -d node_modules ]; then
        echo "==> Instalando las dependencias del repo (npm ci, sin scripts)"
        npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
      fi
      ensure_electron
      echo "==> Compilando la app"
      npx electron-vite build >"$log" 2>&1 || {
        tail -n 20 "$log" >&2
        exit 1
      }
      echo "==> Empaquetando AbsorCheck.app (versión 0.0.1)"
      rm -rf dist/check
      npx electron-builder --mac dir "--$arch" --publish never \
        -c.appId=com.absor.connect.check -c.productName=AbsorCheck \
        -c.extraMetadata.name=absor-connect-check -c.extraMetadata.version=0.0.1 \
        -c.electronDist=node_modules/electron/dist -c.directories.output=dist/check >>"$log" 2>&1 || {
        tail -n 20 "$log" >&2
        exit 1
      }
      cd "$here"
    fi
    app=$(find "$root/dist/check" -maxdepth 2 -name AbsorCheck.app 2>/dev/null | head -n 1)
    if [ -z "$app" ]; then
      echo "No está AbsorCheck.app: lanza antes «$0 background»." >&2
      exit 1
    fi

    echo
    echo "==> macOS $macos · $app"
    echo "==> La prueba abre y cierra AbsorCheck y su menú de la barra de menús: no toques el ratón"
    echo "    mientras tanto, y responde a las preguntas que irán saliendo."
    phase=main
    if [ "$mode" = background-login ]; then
      phase=login
    fi
    set +e
    node background-check.mjs "--app=$app" "--phase=$phase" "--macos=$macos" "--out=$out" \
      "--log=$here/out/absorcheck-app.log" 2>"$log"
    status=$?
    set -e
    ;;
esac

if [ ! -f "$out" ]; then
  echo "No se ha generado $out. Final de $log:" >&2
  tail -n 20 "$log" >&2
  exit 1
fi
pbcopy <"$out"
echo
echo "==> Resultado en $out (también está en el portapapeles, para pegarlo en el chat)."
exit $status
