#!/usr/bin/env bash
# Observación sin sudo ni entrada; ejecutar desde Terminal de la sesión gráfica Mint.
set -euo pipefail
umask 077
if [ "$#" -ne 0 ]; then
  printf 'Este lanzador no admite argumentos.\n' >&2
  exit 2
fi
if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  printf 'Ejecuta como usuario normal, sin sudo.\n' >&2
  exit 3
fi
source_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$(/usr/bin/stat -c '%u:%a' "$source_directory")" != "$(/usr/bin/id -u):700" ]; then
  printf 'Se necesita una carpeta privada 0700 del usuario actual.\n' >&2
  exit 3
fi
printf '%s  %s\n' \
  '5e698b3110a4bb433b1cc05fca4a186c1fd31c127ae4b5da9fb7f1d23d843e86' "$source_directory/linux-polkit-focus-check.py" \
  '948e62402572c0a517ab1a16b5d2a1f7af9ddc76dd81ac57ada3d4e4379a16ce' "$source_directory/linux-owned-input-check.py" \
  | /usr/bin/sha256sum --check --status
report_path="$source_directory/focus-results.json"
if [ -e "$report_path" ]; then
  printf 'Ya existe el informe; no repitas la observación.\n' >&2
  exit 3
fi
printf 'No introduzcas contraseñas ni toques el aviso. Solo se observará el foco y se retirará la solicitud propia.\n'
set -o noclobber
result=0
/usr/bin/python3 -I "$source_directory/linux-polkit-focus-check.py" --observe-polkit > "$report_path" || result=$?
/usr/bin/cat "$report_path"
exit "$result"
