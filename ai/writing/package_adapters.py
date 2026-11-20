"""Pack (custodian) or unpack (receiver) the two serving adapters as one zip with a SHA manifest.

The adapters are trained on Cambridge W&I data and are NOT in Git. Only the custodian decides
whether to share the zip, and only through an access-controlled channel (no public upload,
no cloud model hosting). The zip holds run.json and best/ (adapter weights, adapter config,
tokenizer files) — about 7 MB. Checkpoints, optimizer state and training_args.bin are left out.

  pack:    .venv/Scripts/python.exe package_adapters.py pack   --output ..\\..\\lewa-writing-adapters.zip
  unpack:  .venv/Scripts/python.exe package_adapters.py unpack --input  <path>\\lewa-writing-adapters.zip
"""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from data import ROOT

RUNS = ("cefr-my-first-run", "gec-viet-full-18ep-bs2-ga8-20261111")
SKIP = {"training_args.bin"}


def _files(run: str):
    base = ROOT / "artifacts" / run
    yield base / "run.json"
    for path in sorted((base / "best").iterdir()):
        if path.is_file() and path.name not in SKIP:
            yield path


def pack(output: Path):
    if output.exists():
        raise SystemExit(f"{output} already exists")
    manifest = {}
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for run in RUNS:
            for path in _files(run):
                name = path.relative_to(ROOT / "artifacts").as_posix()
                archive.write(path, name)
                manifest[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        archive.writestr("MANIFEST.json", json.dumps(manifest, indent=2))
    print(f"Packed {len(manifest)} files into {output}")


def unpack(source: Path):
    target = ROOT / "artifacts"
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("MANIFEST.json"))
        for name, expected in manifest.items():
            if name.startswith(("/", "..")) or ".." in Path(name).parts or not name.split("/")[0] in RUNS:
                raise SystemExit(f"Refusing unexpected path in archive: {name}")
            data = archive.read(name)
            if hashlib.sha256(data).hexdigest() != expected:
                raise SystemExit(f"SHA mismatch for {name}; the archive is damaged.")
            destination = target / name
            if destination.exists():
                if destination.read_bytes() == data:
                    continue
                raise SystemExit(f"{destination} exists with different content; not overwriting.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    print(f"Unpacked {len(manifest)} files into {target}. Run check_writing_setup.py next.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("pack").add_argument("--output", type=Path, required=True)
    sub.add_parser("unpack").add_argument("--input", type=Path, required=True)
    args = parser.parse_args(argv)
    pack(args.output) if args.command == "pack" else unpack(args.input)


if __name__ == "__main__":
    main()
