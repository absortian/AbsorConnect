#!/usr/bin/env python3
"""Compilación cruzada Mac → Linux ARM; Rust se compila en nuestra VM aislada."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[2]


def main():
    assert len(sys.argv) == 3 and platform.system() == 'Darwin', 'usage_build_linux_lab_vm'
    lab = Path(sys.argv[1]).resolve()
    directory = Path(sys.argv[2]).resolve()
    assert lab != ROOT and ROOT not in lab.parents
    meta = directory.stat()
    controller = directory/'vm-control.py'
    assert meta.st_uid == os.getuid() and meta.st_mode & 0o077 == 0
    assert controller.is_file() and not controller.is_symlink() and controller.stat().st_uid == os.getuid() and controller.stat().st_mode & 0o022 == 0
    spec = importlib.util.spec_from_file_location('owned_vm', controller)
    vm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vm)
    assert vm.SSH[-1] == 'absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1] == '22223'
    checkout = lab/'webrtc-native/src'
    dependencies = json.loads((SOURCE/'dependencies.json').read_text())
    for path, revision in [(checkout, dependencies['webrtc']['revision']), (lab/'depot_tools', dependencies['depotTools']['revision']), (checkout/'third_party/boringssl/src', dependencies['boringSslRevisionFromDeps'])]:
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=path, text=True).strip() == revision
    target = checkout/'absor_connect_probe'
    assert target.is_dir() and not target.is_symlink() and (target/'.absor-check').is_file()
    archive = io.BytesIO()
    source_hashes = {}
    with tarfile.open(fileobj=archive, mode='w') as output:
        for path in (ROOT/'agent').rglob('*'):
            relative = path.relative_to(ROOT)
            if path.is_file() and not path.is_symlink() and 'target' not in relative.parts:
                output.add(path, arcname=str(relative), recursive=False)
                if path.suffix in ['.rs', '.toml', '.lock', '.h']:
                    source_hashes[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
        output.add(ROOT/'src/shared/remote/auth-vectors.json', arcname='src/shared/remote/auth-vectors.json')
        output.add(ROOT/'src/shared/remote/agent-protocol-vectors.json', arcname='src/shared/remote/agent-protocol-vectors.json')
    subprocess.run(vm.SSH+['tar -xf - -C /home/absorlab/AbsorConnectLab/api-workers'], input=archive.getvalue(), capture_output=True, check=True, timeout=30)
    # El mismo sysroot oficial verificado por install-sysroot.py. Evita enlazar
    # Rust contra glibc de Ubuntu y C++ contra otra base sin relajar el linker.
    sysroot = checkout/'build/linux/debian_bullseye_arm64-sysroot'
    assert sysroot.is_dir() and not sysroot.is_symlink()
    packed = subprocess.Popen(['tar', '-czf', '-', '-C', str(sysroot), '.'], stdout=subprocess.PIPE)
    try:
        subprocess.run(vm.SSH+['mkdir -p /home/absorlab/AbsorConnectLab/bullseye-arm64-sysroot && tar -xzf - -C /home/absorlab/AbsorConnectLab/bullseye-arm64-sysroot'], stdin=packed.stdout, capture_output=True, check=True, timeout=180)
    finally:
        packed.stdout.close()
        packed.wait(timeout=10)
    assert packed.returncode == 0
    base = '/home/absorlab/AbsorConnectLab/bullseye-arm64-sysroot'
    flags = f'-L native={base}/usr/lib/aarch64-linux-gnu -L native={base}/lib/aarch64-linux-gnu -C link-arg=--sysroot={base} -C link-arg=-B{base}/usr/lib/aarch64-linux-gnu/ -C link-arg=-fuse-ld=lld'
    # --target deja las herramientas de compilación en el host de la VM; solo
    # los artefactos objetivo usan la ABI de Bullseye. lld conserva el sysroot.
    result = subprocess.run(vm.SSH+['cd /home/absorlab/AbsorConnectLab/api-workers && RUSTFLAGS="'+flags+'" cargo build --target aarch64-unknown-linux-gnu --manifest-path agent/Cargo.toml --offline --locked --release -p absor-agent-webrtc-lab -p absor-agent-supervisor -p absor-agent-broker --features native-fixture,synthetic-lab,linux-broker-lab,protected-ipc-fixture'], capture_output=True, timeout=180)
    log = directory/'linux-webrtc-rust-build.log'
    log.write_bytes(result.stdout+result.stderr)
    log.chmod(0o600)
    if result.returncode:
        print((result.stdout+result.stderr).decode(errors='replace')[-4000:])
    result.check_returncode()
    hashes = {}
    for name in ['libabsor_agent_webrtc_lab.so', 'absor-lab-supervisor', 'absor-linux-broker-lab']:
        raw = subprocess.check_output(vm.SSH+['cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/aarch64-unknown-linux-gnu/release/'+name], timeout=30)
        path = target/(name+'-linux' if name != 'libabsor_agent_webrtc_lab.so' else name)
        assert not path.is_symlink()
        path.write_bytes(raw)
        path.chmod(0o700)
        hashes[name] = hashlib.sha256(raw).hexdigest()
    for name in ['BUILD.gn', 'channel_check.cc', 'synthetic_video.h', 'native_fixture_video.h']:
        assert not (target/name).is_symlink()
        shutil.copyfile(SOURCE/name, target/name)
        source_hashes[str((SOURCE/name).relative_to(ROOT))] = hashlib.sha256((SOURCE/name).read_bytes()).hexdigest()
    source_hashes['src/shared/remote/auth-vectors.json'] = hashlib.sha256((ROOT/'src/shared/remote/auth-vectors.json').read_bytes()).hexdigest()
    shutil.copyfile(ROOT/'agent/crates/agent-webrtc-lab/absor_bridge.h', target/'absor_bridge.h')
    assert (target/'vectors.h').is_file(), 'run_mac_build_first_for_public_vectors'
    env = dict(os.environ, DEPOT_TOOLS_UPDATE='0', DEPOT_TOOLS_COLLECT_METRICS='0')
    env['PATH'] = str(lab/'depot_tools')+os.pathsep+env['PATH']
    args = ('target_os="linux" target_cpu="arm64" is_debug=false symbol_level=0 '
            'rtc_include_tests=false rtc_build_examples=false is_component_build=false '
            'use_remoteexec=false use_siso=false rtc_use_h264=false proprietary_codecs=false '
            'rtc_use_x11=false rtc_use_pipewire=false use_glib=false use_dbus=false '
            'rtc_include_pulse_audio=false absor_rust_bridge=true absor_linux_fixture=true')
    out = 'out/AbsorLinuxProbe'
    subprocess.run([str(lab/'depot_tools/gn'), 'gen', out, '--root-target=//absor_connect_probe:rust_video_channel_check', '--args='+args], cwd=checkout, env=env, check=True)
    subprocess.run([str(lab/'depot_tools/gn'), 'check', out, '//absor_connect_probe:rust_video_channel_check', '--root-target=//absor_connect_probe:rust_video_channel_check'], cwd=checkout, env=env, check=True)
    subprocess.run(['ninja', '-C', out, '-j', '2', 'absor_connect_probe:rust_video_channel_check'], cwd=checkout, env=env, check=True)
    binary = checkout/out/'rust_video_channel_check'
    report = {'webrtcRevision':dependencies['webrtc']['revision'], 'boringSslRevision':dependencies['boringSslRevisionFromDeps'], 'target':'aarch64-linux-gnu', 'crossCompiled':True, 'executedByBuild':False, 'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(), 'libraries':hashes, 'gnArgs':args,
              'sysrootSha256':json.loads((checkout/'build/linux/sysroot_scripts/sysroots.json').read_text())['bullseye_arm64']['Sha256Sum'],
              'rustCompiler':vm.remote('rustc --version').decode().strip(),
              'rustLinker':vm.remote('ld.lld --version').decode().strip(),
              'artifactSourceSha256':source_hashes}
    path = directory/'linux-webrtc-build.json'
    path.write_text(json.dumps(report, indent=2)+'\n')
    path.chmod(0o600)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
