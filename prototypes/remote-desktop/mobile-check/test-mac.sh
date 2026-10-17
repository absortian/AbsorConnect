#!/bin/sh
# App móvil en macOS (add-remote-desktop 7.1 y 7.2): lo que no se puede comprobar desde Linux.
#
#   prototypes/remote-desktop/mobile-check/test-mac.sh
#
# 1. Pruebas de Dart del control remoto (test/remote_protocol_test.dart). En macOS, PBKDF2 va por
#    CommonCrypto (FFI), la misma ruta que en el iPhone: comprueba que da la K del vector del
#    escritorio y cuánto tarda en este Mac.
# 2. Compila la IPA sin firmar, como la CI (flutter build ios --release --no-codesign), y anota los
#    textos de permisos (UsageDescription) que lleva.
# 3. Si hay un iPhone o un Android conectados por cable, mide PBKDF2 en cada uno
#    (integration_test/pbkdf2_test.dart). En el iPhone hace falta que Xcode pueda firmar para él:
#    abre mobile/ios/Runner.xcworkspace, elige tu equipo en Signing & Capabilities y no subas ese
#    cambio. En Android, la depuración USB activada.
#
# Deja el resultado en ~/Downloads/absor-mobile-check-macos.json (también en el portapapeles).
# Necesita Xcode y Flutter (la CI usa 3.47.7). Tarda unos 5–10 minutos la primera vez.
set -u
here=$(cd "$(dirname "$0")" && pwd -P)
root=$(cd "$here/../../.." && pwd -P)

if [ "$(uname)" != Darwin ]; then
  echo "Este script es para macOS." >&2
  exit 1
fi
for tool in flutter xcodebuild python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Falta $tool (Flutter: https://docs.flutter.dev/get-started/install/macos; Xcode: App Store)." >&2
    exit 1
  fi
done

out="$here/out"
mkdir -p "$out"
cd "$root/mobile"

# Sin `timeout` en macOS: perl corta lo que se quede colgado
limit() {
  seconds=$1
  shift
  perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
}

flutter --version --machine >"$out/mac-flutter.json" 2>/dev/null
xcodebuild -version >"$out/mac-xcode.txt" 2>&1

echo "==> Dependencias (flutter pub get)"
flutter pub get >"$out/mac-pub.log" 2>&1

echo "==> Pruebas del protocolo (PBKDF2 por CommonCrypto)"
limit 600 flutter test test/remote_protocol_test.dart >"$out/mac-test.log" 2>&1
echo $? >"$out/mac-test.rc"

echo "==> IPA sin firmar, como la CI"
start=$(date +%s)
limit 1800 flutter build ios --release --no-codesign >"$out/mac-ipa.log" 2>&1
echo $? >"$out/mac-ipa.rc"
echo $(($(date +%s) - start)) >"$out/mac-ipa.seconds"
rm -f "$out/mac-plist.json"
if [ -f build/ios/iphoneos/Runner.app/Info.plist ]; then
  plutil -convert json -o "$out/mac-plist.json" build/ios/iphoneos/Runner.app/Info.plist
fi

# Teléfonos conectados por cable (no simuladores ni emuladores)
flutter devices --machine >"$out/mac-devices.json" 2>/dev/null
python3 - "$out/mac-devices.json" >"$out/mac-phones.txt" <<'EOF'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))
except Exception:
    devices = []
for d in devices:
    platform = d.get('targetPlatform', '')
    if not d.get('emulator') and (platform.startswith('ios') or platform.startswith('android')):
        print(f"{d['id']}\t{platform}\t{d.get('name', '')}")
EOF
rm -f "$out"/mac-phone-*.log
i=0
while IFS="$(printf '\t')" read -r id platform name; do
  [ -n "$id" ] || continue
  i=$((i + 1))
  echo "==> PBKDF2 en $name ($platform)"
  limit 900 flutter test integration_test/pbkdf2_test.dart -d "$id" </dev/null >"$out/mac-phone-$i.log" 2>&1
  echo $? >"$out/mac-phone-$i.rc"
  printf '%s\t%s\t%s\n' "$id" "$platform" "$name" >"$out/mac-phone-$i.id"
done <"$out/mac-phones.txt"

result="$HOME/Downloads/absor-mobile-check-macos.json"
python3 - "$out" >"$result" <<'EOF'
import glob, json, os, re, sys

out = sys.argv[1]

def read(name, default=''):
    try:
        return open(os.path.join(out, name), encoding='utf-8', errors='replace').read()
    except OSError:
        return default

def tail(name, lines=25):
    return read(name).strip().splitlines()[-lines:]

try:
    flutter = json.loads(read('mac-flutter.json') or '{}')
except ValueError:
    flutter = {}
test_log = read('mac-test.log')
test_ok = read('mac-test.rc').strip() == '0'
pbkdf2 = re.search(r'PBKDF2 600000 iteraciones \(macos\): (\d+) ms', test_log)
ipa_ok = read('mac-ipa.rc').strip() == '0'
try:
    plist = json.loads(read('mac-plist.json') or '{}')
except ValueError:
    plist = {}

phones = []
for rc in sorted(glob.glob(os.path.join(out, 'mac-phone-*.rc'))):
    n = re.search(r'mac-phone-(\d+)\.rc', rc).group(1)
    device_id, platform, name = (read(f'mac-phone-{n}.id').strip().split('\t') + ['', '', ''])[:3]
    log = read(f'mac-phone-{n}.log')
    measured = re.search(r'PBKDF2 (\{.*\})', log)
    phone = {'name': name, 'platform': platform, 'ok': open(rc).read().strip() == '0'}
    if measured:
        phone['pbkdf2'] = json.loads(measured.group(1))
    if not phone['ok']:
        phone['log'] = tail(f'mac-phone-{n}.log')
    phones.append(phone)

report = {
    'flutter': flutter.get('frameworkVersion'),
    'xcode': read('mac-xcode.txt').strip().splitlines()[:2],
    'protocolTests': {
        'ok': test_ok,
        'summary': (re.findall(r'^\d+:\d+ \+\d+.*$', test_log, re.M) or [''])[-1],
        'pbkdf2MacMs': int(pbkdf2.group(1)) if pbkdf2 else None,
    },
    'ipa': {
        'ok': ipa_ok,
        'seconds': int(read('mac-ipa.seconds', '0').strip() or 0),
        'usageDescriptions': {k: v for k, v in plist.items() if k.endswith('UsageDescription')},
    },
    'phones': phones or 'ninguno conectado',
}
if not test_ok:
    report['protocolTests']['log'] = tail('mac-test.log')
if not ipa_ok:
    report['ipa']['log'] = tail('mac-ipa.log', 40)
print(json.dumps(report, ensure_ascii=False, indent=2))
EOF
pbcopy <"$result"
cat "$result"
echo
echo "==> Resultado en $result (también en el portapapeles)."
