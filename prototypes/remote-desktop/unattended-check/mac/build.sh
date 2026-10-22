#!/bin/bash
set -euo pipefail

# Firma ad-hoc por defecto; la identidad de desarrollo es opcional y nunca se exporta su clave.
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'Uso: bash mac/build.sh <carpeta-nueva-de-salida> [identidad-de-firma]' >&2
  exit 64
fi
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$1"
signing_identity="${2:--}"
if [[ -e "$output_dir" ]]; then
  echo 'La carpeta de salida ya existe; elige otra para conservar el artefacto anterior.' >&2
  exit 1
fi
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
probe_app="$output_dir/AbsorUnattendedProbe.app"
mkdir -p "$probe_app/Contents/MacOS" "$output_dir/module-cache"
cp "$source_dir/Info.plist" "$probe_app/Contents/Info.plist"
xcrun swiftc -parse-as-library -swift-version 5 \
  -module-cache-path "$output_dir/module-cache" \
  -target "$(uname -m)-apple-macosx13.0" \
  "$source_dir/Probe.swift" \
  -o "$probe_app/Contents/MacOS/AbsorUnattendedProbe"
codesign --force --sign "$signing_identity" "$probe_app"
codesign --verify --strict "$probe_app"
shasum -a 256 "$probe_app/Contents/MacOS/AbsorUnattendedProbe"
echo "Prototipo creado: $probe_app"
