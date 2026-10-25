#!/usr/bin/env python3
"""Compila los diagnósticos con GN y las dependencias oficiales ya sincronizadas."""
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parent
REPOSITORY = SOURCE.parents[2]


def main():
    started = time.monotonic()
    if len(sys.argv) not in (2, 3) or len(sys.argv) == 3 and sys.argv[2] != "--rust-bridge":
        raise RuntimeError("Uso: python3 build.py <laboratorio-externo-sincronizado> [--rust-bridge]")
    rust_bridge = len(sys.argv) == 3
    if rust_bridge and platform.system() != "Darwin":
        raise RuntimeError("El enlace libwebrtc/Rust de laboratorio solo se ha preparado para macOS.")
    workspace = Path(sys.argv[1]).expanduser().resolve()
    if workspace == REPOSITORY or REPOSITORY in workspace.parents:
        raise RuntimeError("El laboratorio debe quedar fuera del repositorio.")
    checkout = workspace / "webrtc-native" / "src"
    dependencies = json.loads((SOURCE / "dependencies.json").read_text())
    for path, dependency in ((checkout, dependencies["webrtc"]),
                             (workspace / "depot_tools", dependencies["depotTools"])):
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()
        if actual != dependency["revision"]:
            raise RuntimeError("El checkout no coincide con la revisión fijada.")
    crypto_revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=checkout / "third_party/boringssl/src", text=True).strip()
    if crypto_revision != dependencies["boringSslRevisionFromDeps"]:
        raise RuntimeError("BoringSSL no coincide con la revisión transitiva fijada.")
    target = checkout / "absor_connect_probe"
    marker = target / ".absor-check"
    if target.exists() and (target.is_symlink() or not marker.is_file()):
        raise RuntimeError("El destino ya existe y no pertenece a este diagnóstico.")
    target.mkdir(exist_ok=True)
    marker.touch()
    for filename in ("BUILD.gn", "auth_check.cc", "factory_check.cc", "offer_check.cc", "channel_check.cc", "synthetic_video.h"):
        destination = target / filename
        if destination.is_symlink():
            raise RuntimeError("El destino no puede ser un enlace simbólico.")
        shutil.copyfile(SOURCE / filename, destination)
    if rust_bridge:
        # ABI optativa: nunca habilitarla en el servicio ni aceptar K del propietario.
        rust_environment = dict(os.environ)
        if platform.system() == "Darwin":
            rust_environment["MACOSX_DEPLOYMENT_TARGET"] = "13.0"
        rust_environment["RUSTC"] = str(checkout / "third_party/rust-toolchain/bin/rustc")
        subprocess.run(["cargo", "build", "--manifest-path", str(REPOSITORY / "agent/Cargo.toml"),
                        "--offline", "--locked", "--release", "-p", "absor-agent-webrtc-lab", "--features", "lab-http"], env=rust_environment, check=True)
        for source, name in ((REPOSITORY / "agent/target/release/libabsor_agent_webrtc_lab.dylib", "libabsor_agent_webrtc_lab.dylib"),
                             (REPOSITORY / "agent/crates/agent-webrtc-lab/absor_bridge.h", "absor_bridge.h")):
            destination = target / name
            if destination.is_symlink():
                raise RuntimeError("El destino de la ABI no puede ser un enlace.")
            shutil.copyfile(source, destination)
    vectors_path = REPOSITORY / "src/shared/remote/auth-vectors.json"
    vectors = json.loads(vectors_path.read_text())["vectors"]
    header = "#pragma once\n#include <string>\n#include <vector>\n"
    header += "struct Vector { std::string key, nonce, offer, answer, proof, password, salt; int iterations; };\n"
    header += "const std::vector<Vector> kVectors = {\n"
    for vector in vectors:
        fields = [vector.get(name, "") for name in (
            "key", "nonce", "offerFingerprint", "answerFingerprint", "proof", "password", "salt")]
        header += "{" + ",".join(json.dumps(field, ensure_ascii=False) for field in fields)
        header += "," + str(vector.get("iterations", 0)) + "},\n"
    header += "};\n"
    generated = target / "vectors.h"
    if generated.is_symlink():
        raise RuntimeError("La cabecera de vectores no puede ser un enlace.")
    generated.write_text(header)
    environment = dict(os.environ)
    environment["DEPOT_TOOLS_UPDATE"] = "0"
    environment["DEPOT_TOOLS_COLLECT_METRICS"] = "0"
    environment["PATH"] = str(workspace / "depot_tools") + os.pathsep + environment["PATH"]
    arguments = ('is_debug=false symbol_level=0 rtc_include_tests=false rtc_build_examples=false '
                 'is_component_build=false use_remoteexec=false use_siso=false '
                 'rtc_use_h264=false proprietary_codecs=false')
    if rust_bridge:
        arguments += ' absor_rust_bridge=true'
    subprocess.run([str(workspace / "depot_tools/gn"), "gen", "out/AbsorProbe",
                    "--root-target=//absor_connect_probe:all", "--args=" + arguments],
                   cwd=checkout, env=environment, check=True)
    subprocess.run([str(workspace / "depot_tools/gn"), "check", "out/AbsorProbe",
                    "//absor_connect_probe:*", "--root-target=//absor_connect_probe:all"],
                   cwd=checkout, env=environment, check=True)
    subprocess.run(["ninja", "-C", "out/AbsorProbe", "-j", "2",
                    "absor_connect_probe:auth_check", "absor_connect_probe:factory_check",
                    "absor_connect_probe:offer_check", "absor_connect_probe:channel_check", "absor_connect_probe:video_channel_check"] + (["absor_connect_probe:rust_video_channel_check"] if rust_bridge else []),
                   cwd=checkout, env=environment, check=True)
    results = []
    for filename in ("auth_check", "factory_check", "offer_check"):
        binary = checkout / "out/AbsorProbe" / filename
        execution = subprocess.run([str(binary)], check=True, capture_output=True, text=True)
        result = {"binary": filename, "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                  "result": json.loads(execution.stdout)}
        results.append(result)
        print(json.dumps(result))
    compiler = subprocess.check_output(
        [str(checkout / "third_party/llvm-build/Release+Asserts/bin/clang++"), "--version"],
        text=True).splitlines()[0]
    report = {"schema": 1, "webrtcRevision": dependencies["webrtc"]["revision"],
              "architecture": platform.machine(), "compiler": compiler,
              "buildInvocationSeconds": round(time.monotonic() - started, 2),
              "binaries": results, "transportTested": False}
    endpoint = checkout / "out/AbsorProbe/channel_check"
    report["channelEndpoint"] = {
        "binary": "channel_check", "sha256": hashlib.sha256(endpoint.read_bytes()).hexdigest(),
        "compiled": True, "executedByThisCommand": False,
    }
    video_endpoint = checkout / "out/AbsorProbe/video_channel_check"
    report["videoEndpoint"] = {
        "binary": "video_channel_check", "sha256": hashlib.sha256(video_endpoint.read_bytes()).hexdigest(),
        "compiled": True, "executedByThisCommand": False,
    }
    if rust_bridge:
        rust_endpoint = checkout / "out/AbsorProbe/rust_video_channel_check"
        report["rustEndpoint"] = {"binary": "rust_video_channel_check", "sha256": hashlib.sha256(rust_endpoint.read_bytes()).hexdigest(),
                                  "compiled": True, "executedByThisCommand": False}
        report["rustCompiler"] = subprocess.check_output([rust_environment["RUSTC"], "--version"], text=True).strip()
        report["rustLibrarySha256"] = hashlib.sha256((target / "libabsor_agent_webrtc_lab.dylib").read_bytes()).hexdigest()
    report_path = workspace / "webrtc-probe-results.json"
    if report_path.is_symlink():
        raise RuntimeError("El informe no puede ser un enlace simbólico.")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    report_path.chmod(0o600)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
