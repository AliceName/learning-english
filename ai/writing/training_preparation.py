"""Bind training inputs to an optional, hash-verified preparation record."""
import json
from pathlib import Path

from training_state import file_hash


def preparation_provenance(report_path, task, train_file, dev_file):
    if report_path is None:
        return {"encoding_policy": "unchanged-prepared-text-v1",
                "preparation_report": None, "preparation_report_sha256": None}
    report_path = Path(report_path).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    policy = report.get("encoding_policy")
    if not isinstance(policy, str) or not policy.strip():
        raise ValueError("Preparation report must name its encoding_policy")
    expected = report.get("prepared_files_sha256", {})
    for split, file in (("train", train_file), ("dev", dev_file)):
        if file_hash(file) != expected.get(f"{task}-{split}.jsonl"):
            raise ValueError(f"Prepared {split} hash differs from preparation report")
    checksum = report_path.with_suffix(".sha256")
    if checksum.exists() and checksum.read_text(encoding="ascii").strip() != file_hash(report_path):
        raise ValueError("Preparation report checksum differs")
    return {"encoding_policy": policy, "preparation_report": str(report_path),
            "preparation_report_sha256": file_hash(report_path)}
