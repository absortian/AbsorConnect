#!/bin/bash
set -euo pipefail

# Trabajo temporal del usuario: no instala un daemon ni modifica los permisos TCC.
if [[ $# -ne 2 ]]; then
  echo 'Uso: bash mac/launchd-check.sh <AbsorUnattendedProbe.app> <carpeta-nueva-de-resultados>' >&2
  exit 64
fi
probe_app="$1"
output_dir="$2"
if [[ ! -x "$probe_app/Contents/MacOS/AbsorUnattendedProbe" || -e "$output_dir" ]]; then
  echo 'Se necesita el prototipo compilado y una carpeta de resultados que no exista.' >&2
  exit 1
fi
codesign --verify --strict "$probe_app"
umask 077
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
probe_app="$(cd "$probe_app" && pwd)"
probe_uid="$(id -u)"
probe_label='com.absor.unattended.probe.check'
registered=0
cleanup() {
  if [[ "$registered" -eq 1 ]]; then
    launchctl bootout "gui/$probe_uid/$probe_label" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
python3 - "$probe_app" "$output_dir" "$probe_label" <<'PY'
import pathlib, plistlib, sys
app, output, label = sys.argv[1:]
configuration = {
    'Label': label,
    'ProgramArguments': [app + '/Contents/MacOS/AbsorUnattendedProbe', '--capture'],
    'RunAtLoad': True,
    'KeepAlive': False,
    'ProcessType': 'Background',
    'LimitLoadToSessionType': 'Aqua',
    'StandardOutPath': output + '/report.json',
    'StandardErrorPath': output + '/stderr.txt',
}
with (pathlib.Path(output) / 'check.plist').open('wb') as handle:
    plistlib.dump(configuration, handle)
PY
launchctl bootstrap "gui/$probe_uid" "$output_dir/check.plist"
registered=1
for ((attempt=0; attempt<150; attempt++)); do
  if [[ -s "$output_dir/report.json" ]]; then
    python3 - "$output_dir/report.json" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    report = json.load(handle)
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(0 if report['status'] == 'capture_ok_not_certified' else 2)
PY
    exit $?
  fi
  sleep 0.1
done
echo 'No se recibió el diagnóstico en 15 segundos; se retira el trabajo temporal.' >&2
exit 3
