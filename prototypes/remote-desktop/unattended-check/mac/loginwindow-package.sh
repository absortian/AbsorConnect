#!/bin/bash
set -euo pipefail

# Solo construye un paquete de prueba. No lo instala ni cierra la sesión del Mac.
if [[ $# -ne 2 ]]; then
  echo 'Uso: bash mac/loginwindow-package.sh <AbsorUnattendedProbe.app> <carpeta-nueva>' >&2
  exit 64
fi
probe_app="$1"
output_dir="$2"
if [[ ! -x "$probe_app/Contents/MacOS/AbsorUnattendedProbe" || -e "$output_dir" ]]; then
  echo 'Se necesita el prototipo compilado y una carpeta de salida nueva.' >&2
  exit 1
fi
codesign --verify --strict "$probe_app"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$probe_app/Contents/Info.plist")
if [[ "$bundle_id" != 'com.absor.unattended.probe' ]]; then
  echo 'El bundle no corresponde al prototipo de esta prueba.' >&2
  exit 1
fi
umask 022
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
payload="$output_dir/payload"
install_dir='/Library/Application Support/AbsorConnectLab'
log_dir='/Library/Logs/AbsorConnectLab'
label='com.absor.unattended.probe.loginwindow'
mkdir -p "$payload$install_dir" "$payload/Library/LaunchAgents" "$payload$log_dir"
chmod 700 "$payload$log_dir"
ditto --noextattr --noacl --norsrc "$probe_app" "$payload$install_dir/AbsorUnattendedProbe.app"
codesign --verify --strict "$payload$install_dir/AbsorUnattendedProbe.app"
python3 - "$payload" "$install_dir" "$log_dir" "$label" <<'PY'
import pathlib, plistlib, sys
payload, install, logs, label = sys.argv[1:]
configuration = {
    'Label': label,
    'ProgramArguments': [install + '/AbsorUnattendedProbe.app/Contents/MacOS/AbsorUnattendedProbe', '--capture-owned-input-loginwindow'],
    'LimitLoadToSessionType': 'LoginWindow',
    'RunAtLoad': True,
    'KeepAlive': False,
    'LaunchOnlyOnce': True,
    'ProcessType': 'Background',
    'StandardOutPath': logs + '/loginwindow-report-v10.json',
    'StandardErrorPath': logs + '/loginwindow-stderr-v10.txt',
    'Umask': 0o077,
}
with (pathlib.Path(payload) / 'Library/LaunchAgents' / (label + '.plist')).open('wb') as handle:
    plistlib.dump(configuration, handle)
PY
chmod 644 "$payload/Library/LaunchAgents/$label.plist"
pkgbuild --root "$payload" --identifier 'com.absor.unattended.probe.loginwindow' \
  --version '0.10.0' --install-location / --ownership recommended \
  "$output_dir/AbsorLoginWindowProbe.pkg"
pkgutil --payload-files "$output_dir/AbsorLoginWindowProbe.pkg" > "$output_dir/payload-files.txt"
pkgutil --expand-full "$output_dir/AbsorLoginWindowProbe.pkg" "$output_dir/inspection"
codesign --verify --strict "$output_dir/inspection/Payload$install_dir/AbsorUnattendedProbe.app"
python3 - "$payload" "$output_dir/inspection" <<'PY'
import hashlib, pathlib, plistlib, subprocess, sys, xml.etree.ElementTree as ET
source, expanded = map(pathlib.Path, sys.argv[1:])
metadata = ET.parse(expanded / 'PackageInfo').getroot()
assert metadata.attrib['identifier'] == 'com.absor.unattended.probe.loginwindow'
assert metadata.attrib['install-location'] == '/' and metadata.attrib['relocatable'] == 'false'
assert metadata.find('scripts') is None
actual = expanded / 'Payload'
files = {str(p.relative_to(actual)) for p in actual.rglob('*') if p.is_file()}
expected = {str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
assert files == expected and len(files) == 4
assert not any(p.is_symlink() for p in actual.rglob('*'))
for name in files:
    assert hashlib.sha256((source / name).read_bytes()).digest() == hashlib.sha256((actual / name).read_bytes()).digest()
for line in subprocess.check_output(['lsbom', str(expanded / 'Bom')], text=True).splitlines():
    fields = line.split('\t')
    assert fields[2] == '0/0' and int(fields[1], 8) & 0o022 == 0
with (actual / 'Library/LaunchAgents/com.absor.unattended.probe.loginwindow.plist').open('rb') as handle:
    job = plistlib.load(handle)
assert job['LimitLoadToSessionType'] == 'LoginWindow'
assert job['KeepAlive'] is False and job['LaunchOnlyOnce'] is True
assert job['ProgramArguments'][-1] == '--capture-owned-input-loginwindow'
assert job['StandardOutPath'].endswith('/loginwindow-report-v10.json')
print('Payload verificado: cuatro archivos iguales al staging, sin scripts/enlaces, propiedad root y sin escritura de grupo/otros.')
PY
shasum -a 256 "$probe_app/Contents/MacOS/AbsorUnattendedProbe" "$output_dir/AbsorLoginWindowProbe.pkg"
echo "Paquete de laboratorio preparado: $output_dir/AbsorLoginWindowProbe.pkg"
