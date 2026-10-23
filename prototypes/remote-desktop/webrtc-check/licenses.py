#!/usr/bin/env python3
"""Genera avisos del target real con la herramienta oficial de la revisión fijada."""
import argparse
import hashlib
import importlib.util
import json
import logging
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    parser.add_argument('output', type=Path, help='Carpeta nueva fuera del repositorio')
    args = parser.parse_args()
    workspace = args.workspace.resolve(strict=True)
    checkout = workspace / 'webrtc-native/src'
    source = Path(__file__).resolve().parent
    dependencies = json.loads((source / 'dependencies.json').read_text())
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=checkout, text=True).strip()
    if revision != dependencies['webrtc']['revision']:
        raise RuntimeError('La revisión WebRTC no coincide con la fijada')
    args.output.mkdir(mode=0o700)
    environment = dict(os.environ)
    environment['PATH'] = str(workspace / 'depot_tools') + os.pathsep + environment['PATH']
    environment['DEPOT_TOOLS_UPDATE'] = '0'
    environment['DEPOT_TOOLS_COLLECT_METRICS'] = '0'
    tool = checkout / 'tools_webrtc/libs/generate_licenses.py'
    spec = importlib.util.spec_from_file_location('pinned_webrtc_licenses', tool)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    targets = ['//absor_connect_probe:channel_check', '//absor_connect_probe:video_channel_check']

    def run_gn(buildfile, target):
        # El laboratorio usa root-target propio: el wrapper solo añade ese argumento.
        # El inventario, la selección de licencias y el rechazo de desconocidas son oficiales.
        return subprocess.check_output([
            str(workspace / 'depot_tools/gn'), 'desc', str(buildfile), target,
            '--all', '--format=json', '--root-target=//absor_connect_probe:all',
        ], cwd=checkout, env=environment, text=True)

    module.LicenseBuilder._run_gn = staticmethod(run_gn)
    logging.basicConfig(level=logging.INFO)
    builder = module.LicenseBuilder([str(checkout / 'out/AbsorProbe')], targets)
    builder.generate_license_text(str(args.output))
    notice = args.output / 'LICENSE.md'
    report = {'schema': 1, 'webrtcRevision': revision, 'targets': targets,
              'generatorSha256': hashlib.sha256(tool.read_bytes()).hexdigest(),
              'licenseSha256': hashlib.sha256(notice.read_bytes()).hexdigest(),
              'licenseBytes': notice.stat().st_size, 'unknownLibrariesAccepted': False,
              'distributionAuditComplete': False}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
