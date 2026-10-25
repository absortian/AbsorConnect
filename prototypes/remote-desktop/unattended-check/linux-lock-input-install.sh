#!/usr/bin/env bash
# Lanzar como usuario desde una carpeta privada nueva en Mint. No instala servicios.
set -euo pipefail
umask 077
if [ "$#" -ne 0 ]; then
  printf 'Este lanzador no admite argumentos.\n' >&2
  exit 2
fi
if [ "$(/usr/bin/id -u)" -eq 0 ]; then
  printf 'Ejecuta el lanzador como usuario normal, sin anteponer sudo.\n' >&2
  exit 3
fi
source_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$(/usr/bin/stat -c '%u:%a' "$source_directory")" != "$(/usr/bin/id -u):700" ]; then
  printf 'Se necesita una carpeta privada 0700 del usuario actual.\n' >&2
  exit 3
fi
root_directory='/var/lib/AbsorConnectLab/lock-input-v1'
report_path="$source_directory/lock-input-results.json"
if [ -e "$report_path" ]; then
  printf 'Ya existe el informe; no repitas esta instalación.\n' >&2
  exit 3
fi
printf '%s  %s\n' \
  '843b094bd06494bf2a22cf60570967c405c1f5e41defffc2d9d5e2c730db5e54' "$source_directory/linux-lock-input-check.py" \
  '40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275' "$source_directory/linux-session-check.py" \
  '5e698b3110a4bb433b1cc05fca4a186c1fd31c127ae4b5da9fb7f1d23d843e86' "$source_directory/linux-polkit-focus-check.py" \
  | /usr/bin/sha256sum --check --status
printf 'Se instalarán tres fuentes protegidas para probar Tab y Mayús+Tab en el bloqueo de Mint.\n'
printf 'Introduce la contraseña solo en sudo. Espera READY_TO_LOCK_MINT antes de bloquear Mint. Después muestra el campo, espera veinte segundos y desbloquea normalmente.\n'
# mkdir sin -p en el destino final impide sobrescribir una prueba anterior.
/usr/bin/sudo /usr/bin/mkdir -p /var/lib/AbsorConnectLab
/usr/bin/sudo /usr/bin/mkdir -m 0755 "$root_directory"
/usr/bin/sudo /usr/bin/install -o root -g root -m 0600 \
  "$source_directory/linux-lock-input-check.py" "$source_directory/linux-session-check.py" \
  "$source_directory/linux-polkit-focus-check.py" "$root_directory/"
printf '%s  %s\n' \
  '843b094bd06494bf2a22cf60570967c405c1f5e41defffc2d9d5e2c730db5e54' "$root_directory/linux-lock-input-check.py" \
  '40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275' "$root_directory/linux-session-check.py" \
  '5e698b3110a4bb433b1cc05fca4a186c1fd31c127ae4b5da9fb7f1d23d843e86' "$root_directory/linux-polkit-focus-check.py" \
  | /usr/bin/sudo /usr/bin/sha256sum --check --status
set -o noclobber
if /usr/bin/sudo /usr/bin/python3 -I "$root_directory/linux-lock-input-check.py" --test-locked-navigation > "$report_path"; then
  /usr/bin/cat "$report_path"
else
  /usr/bin/cat "$report_path"
  exit 3
fi
