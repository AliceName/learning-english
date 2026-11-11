"""Install one pinned public GGUF and CPU runtime; never upload essays or corpus."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
MODEL_ID = "Qwen/Qwen2.5-1.5B-Instruct-GGUF"
REVISION = "91cad51170dc346986eccefdc2dd33a9da36ead9"
MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
MODEL_SHA = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
RUNTIME_VERSION = "b11913"
ARCHIVE = "llama-b11913-bin-win-cpu-x64.zip"
ARCHIVE_SHA = "55b31ccaf398e90457cfe28087297f5f3fdf1e3bfa7a28e1108f13d0af8e4621"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, destination, expected):
    if destination.is_symlink():
        raise ValueError("Download destination must not be a symbolic link")
    if destination.exists():
        if sha(destination) != expected:
            raise ValueError(f"Existing download hash differs: {destination.name}")
        return
    temporary = destination.with_suffix(destination.suffix + ".partial")
    if temporary.is_symlink():
        raise ValueError("Partial download must not be a symbolic link")
    request = urllib.request.Request(url, headers={"User-Agent": "LearningEnglish-local-installer"})
    with urllib.request.urlopen(request, timeout=60) as source, temporary.open("wb") as target:
        total = 0
        while block := source.read(4 * 1024 * 1024):
            target.write(block)
            total += len(block)
            if total % (64 * 1024 * 1024) < len(block):
                print(json.dumps({"download": destination.name, "mib": total // (1024 * 1024)}), flush=True)
    if sha(temporary) != expected:
        raise ValueError(f"Downloaded file failed SHA-256: {destination.name}")
    temporary.replace(destination)


def verify_or_extract_runtime(archive: Path, runtime: Path):
    """Trust archive bytes, never an arbitrary pre-existing executable directory."""
    base = runtime.resolve()
    if runtime.is_symlink() or (runtime.exists() and not runtime.is_dir()):
        raise ValueError("Runtime directory must be a regular directory")
    with zipfile.ZipFile(archive) as bundle:
        expected = {}
        for info in bundle.infolist():
            target = (base / info.filename).resolve()
            if (Path(info.filename).is_absolute() or not target.is_relative_to(base)
                    or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError("Runtime archive contains an escaping or symbolic path")
            if info.is_dir():
                continue
            relative = str(target.relative_to(base))
            if relative.casefold() in {name.casefold() for name in expected}:
                raise ValueError("Runtime archive contains duplicate target paths")
            with bundle.open(info) as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            expected[relative] = (digest, info)
        if not expected:
            raise ValueError("Runtime archive contains no files")
        if runtime.exists():
            actual = {}
            for path in runtime.rglob("*"):
                if path.is_symlink() or not path.resolve().is_relative_to(base):
                    raise ValueError("Existing runtime contains an escaping or symbolic path")
                if path.is_file():
                    actual[str(path.relative_to(runtime))] = sha(path)
            if actual != {name: digest for name, (digest, _) in expected.items()}:
                raise ValueError("Existing runtime files differ from the pinned archive; use a new directory")
        else:
            runtime.mkdir(parents=True, exist_ok=False)
            for relative, (_, info) in expected.items():
                target = runtime / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, target.open("xb") as destination:
                    shutil.copyfileobj(source, destination)
            if {str(path.relative_to(runtime)): sha(path) for path in runtime.rglob("*") if path.is_file()} != {
                    name: digest for name, (digest, _) in expected.items()}:
                raise ValueError("Extracted runtime failed archive verification")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / ".cache/feedback-local")
    args = parser.parse_args()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    model, archive = directory / MODEL_FILE, directory / ARCHIVE
    download(f"https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{MODEL_FILE}", model, MODEL_SHA)
    download(f"https://github.com/ggml-org/llama.cpp/releases/download/{RUNTIME_VERSION}/{ARCHIVE}", archive, ARCHIVE_SHA)
    runtime = directory / RUNTIME_VERSION
    verify_or_extract_runtime(archive, runtime)
    servers = list(runtime.rglob("llama-server.exe"))
    if len(servers) != 1:
        raise ValueError("Expected exactly one CPU llama-server executable")
    server = servers[0]
    runtime_files = {str(path.relative_to(runtime)): sha(path) for path in runtime.rglob("*") if path.is_file()}
    manifest = dict(modelId=MODEL_ID, modelPath=str(model), modelSha256=MODEL_SHA,
                    modelRevision=REVISION, runtimePath=str(server), runtimeSha256=sha(server),
                    runtimeVersion=RUNTIME_VERSION, runtimeArchiveSha256=ARCHIVE_SHA,
                    runtimeFiles=runtime_files, cpuOnly=True, context=2048,
                    maxOutputTokens=512, temperature=0, dataUploads=False)
    path = directory / "manifest.json"
    if path.is_symlink():
        raise ValueError("Runtime manifest must not be a symbolic link")
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8-sig")) != manifest:
            raise ValueError("Existing runtime manifest differs; use a new installation directory")
    else:
        with path.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(manifest, indent=2))
    print(json.dumps({"installed": True, "manifest": str(path), "model_sha256": MODEL_SHA}), flush=True)


if __name__ == "__main__":
    main()
