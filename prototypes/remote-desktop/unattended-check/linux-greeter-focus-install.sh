#!/usr/bin/env bash
# Lanzar como usuario por SSH desde el Mac, manteniendo la conexión al salir de Cinnamon.
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
if [ -z "${SSH_CONNECTION:-}" ]; then
  printf 'Ejecuta este lanzador por SSH desde el Mac para que sobreviva al cierre de sesión gráfica de Mint.\n' >&2
  exit 3
fi
source_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
if [ "$(/usr/bin/stat -c '%u:%a' "$source_directory")" != "$(/usr/bin/id -u):700" ]; then
  printf 'Se necesita una carpeta privada 0700 del usuario actual.\n' >&2
  exit 3
fi
root_directory='/var/lib/AbsorConnectLab/greeter-focus-v1'
report_path="$source_directory/greeter-focus-results.json"
if [ -e "$report_path" ]; then
  printf 'Ya existe el informe; no repitas esta instalación.\n' >&2
  exit 3
fi
printf '%s  %s\n' \
  '5d04385e399a1efed230fe28e2a9a7dd46a912c4c471661d532e31b633832175' "$source_directory/linux-greeter-focus-check.py" \
  '40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275' "$source_directory/linux-session-check.py" \
  | /usr/bin/sha256sum --check --status
printf 'Se instalarán dos fuentes protegidas para probar metadatos de foco de Slick Greeter.\n'
printf 'Introduce la contraseña solo en sudo. Espera READY_TO_LOGOUT_MINT antes de cerrar sesión en Mint. Deja el campo de entrada visible veinte segundos y vuelve a iniciar sesión normalmente.\n'
# mkdir sin -p en el destino final impide sobrescribir una prueba anterior.
/usr/bin/sudo /usr/bin/mkdir -p /var/lib/AbsorConnectLab
/usr/bin/sudo /usr/bin/mkdir -m 0755 "$root_directory"
/usr/bin/sudo /usr/bin/install -o root -g root -m 0600 \
  "$source_directory/linux-greeter-focus-check.py" "$source_directory/linux-session-check.py" \
  "$root_directory/"
printf '%s  %s\n' \
  '5d04385e399a1efed230fe28e2a9a7dd46a912c4c471661d532e31b633832175' "$root_directory/linux-greeter-focus-check.py" \
  '40d222539fa05c21b9f0a95993efe40a386bc82dab4ad031b6d188e827b6e275' "$root_directory/linux-session-check.py" \
  | /usr/bin/sudo /usr/bin/sha256sum --check --status
set -o noclobber
if /usr/bin/sudo /usr/bin/python3 -I "$root_directory/linux-greeter-focus-check.py" --observe-greeter > "$report_path"; then
  /usr/bin/cat "$report_path"
else
  /usr/bin/cat "$report_path"
  exit 3
fi
