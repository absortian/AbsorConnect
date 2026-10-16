# Electron en macOS para las pruebas manuales (lo usan input-check/test-mac.sh y lan-check/lan-test.sh).
# Se carga con `. lib/mac-electron.sh` con $arch definido (arm64 o x64), desde la carpeta cuyo
# node_modules tiene Electron.
#
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
