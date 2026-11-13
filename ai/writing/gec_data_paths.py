"""Resolve evaluator inputs without editing the training manifest."""

import hashlib
from pathlib import Path


def verified_data_paths(manifest, splits, data_root=None):
    """Return the requested splits after verifying their recorded SHA-256 hashes."""
    if data_root is not None:
        data_root = data_root.resolve()
        if not data_root.is_dir():
            raise ValueError(f"Data root is not a directory: {data_root}")

    paths = {}
    for split in splits:
        try:
            recorded = Path(manifest["data_files"][split])
            expected = manifest["data_sha256"][split]
        except (KeyError, TypeError) as error:
            raise ValueError(f"Missing manifest path or SHA-256 for {split}") from error
        path = recorded
        if data_root is not None:
            matches = [p for p in data_root.rglob("*") if p.name == recorded.name and p.is_file()]
            if not matches:
                raise ValueError(f"Missing {split} file {recorded.name} under {data_root}")
            if len(matches) != 1:
                raise ValueError(f"Ambiguous {split} file {recorded.name} under {data_root}; choose a narrower --data-root")
            path = matches[0].resolve()
            if not path.is_relative_to(data_root):
                raise ValueError(f"Resolved {split} file lies outside --data-root: {path}")
            if path in paths.values():
                raise ValueError(f"Ambiguous split mapping: {split} resolves to a file already used by another split")
        if not path.is_file():
            raise ValueError(f"Missing {split} file: {path}")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError(f"SHA-256 mismatch for {split}: {path}")
        paths[split] = path
    return paths
