"""Read-only CEFR provenance/coverage audit; no model inference or test scoring."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
from statistics import median

from data import LEVELS, cefr_band, normalized_text, read_jsonl

ROOT = Path(__file__).resolve().parent


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def distribution(values):
    ordered = sorted(values)
    if not ordered:
        return None
    return {"min": ordered[0], "median": median(ordered),
            "p90": ordered[int((len(ordered) - 1) * .90)],
            "p95": ordered[int((len(ordered) - 1) * .95)], "max": ordered[-1]}


def provenance_errors(rows, source_by_id, split):
    failures = Counter()
    for row in rows:
        source = source_by_id.get(row.get("id"))
        if source is None:
            failures["id_not_in_source"] += 1
            continue
        for name, valid in {
            "not_final": source.get("is_final_version", "").upper() == "TRUE",
            "text_not_original": row.get("text") == source.get("text"),
            "human_label_mismatch": row.get("original_cefr") == source.get("humannotator_cefr_level"),
            "label_source_not_human_final": row.get("label_source") == "human_final",
            "split_mismatch": row.get("split") == split == source.get("split"),
            "user_mismatch": row.get("user_id") == source.get("public_user_id"),
            "prompt_mismatch": row.get("prompt_id") == source.get("public_prompt_id"),
        }.items():
            if not valid:
                failures[name] += 1
        try:
            valid_band = row.get("cefr") == cefr_band(row.get("original_cefr", ""))
        except (ValueError, AttributeError):
            valid_band = False
        if not valid_band:
            failures["band_mapping_mismatch"] += 1
    return dict(failures)


def overlap(left, right):
    fields = {"essay_id": lambda r: r["id"], "user": lambda r: r["user_id"],
              "user_prompt_set": lambda r: (r["user_id"], r["prompt_id"]),
              "prompt": lambda r: r["prompt_id"], "exact_text": lambda r: r["text"],
              "normalized_text": lambda r: normalized_text(r["text"])}
    return {name: len({key(r) for r in left} & {key(r) for r in right}) for name, key in fields.items()}


def summarize(rows, lengths, budget):
    if len(rows) != len(lengths):
        raise ValueError("Token length count does not match rows")
    kept = [(row, length) for row, length in zip(rows, lengths, strict=True) if length <= budget]
    skipped = [(row, length) for row, length in zip(rows, lengths, strict=True) if length > budget]
    counts = Counter(row["cefr"] for row, _ in kept)
    band_details = {}
    for band in LEVELS:
        selected = [(row, length) for row, length in kept if row["cefr"] == band]
        band_details[band] = {"essays": len(selected), "unique_users": len({r["user_id"] for r, _ in selected}),
                              "unique_prompts": len({r["prompt_id"] for r, _ in selected}),
                              "token_lengths": distribution([n for _, n in selected])}
    return {"selected": len(rows), "encoded": len(kept), "over_length_skipped": len(skipped),
            "labels": {band: counts[band] for band in LEVELS},
            "original_labels": dict(sorted(Counter(r["original_cefr"] for r in rows).items())),
            "missing_band_labels": [band for band in LEVELS if counts[band] == 0],
            "unique_users": len({r["user_id"] for r in rows}),
            "unique_user_prompt_sets": len({(r["user_id"], r["prompt_id"]) for r in rows}),
            "unique_prompts": len({r["prompt_id"] for r in rows}),
            "exact_duplicates_within_split": len(rows) - len({r["text"] for r in rows}),
            "normalized_duplicates_within_split": len(rows) - len({normalized_text(r["text"]) for r in rows}),
            "tokens_all": distribution(lengths),
            "words_all": distribution([len(r["text"].split()) for r in rows]),
            "in_budget_by_band": band_details,
            "in_budget_prompt_counts": dict(sorted(Counter(r["prompt_id"] for r, _ in kept).items())),
            "over_budget_ids": [r["id"] for r, _ in skipped]}


def audit_run(run, source_by_id):
    from transformers import AutoTokenizer

    manifest_path = run / "run.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if manifest.get("task") != "cefr" or not manifest.get("completed"):
        raise ValueError("Audit requires a completed CEFR run")
    if manifest.get("labels") != list(LEVELS):
        raise ValueError("Manifest label order does not match CEFR LEVELS")
    tokenizer_dir = run / "best"
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir, use_fast=False, local_files_only=True)
    selected_rows = {}
    splits = {}
    checks = []
    for split in ("train", "dev"):
        path = Path(manifest["data_files"][split])
        digest = sha256(path)
        if digest != manifest["data_sha256"][split]:
            raise ValueError(f"{run.name}/{split} differs from its training manifest")
        rows = read_jsonl(path)
        lengths = [len(ids) for ids in tokenizer([r["text"] for r in rows], truncation=False)["input_ids"]]
        summary = summarize(rows, lengths, manifest["max_input_length"])
        failures = provenance_errors(rows, source_by_id, split)
        if failures:
            raise ValueError(f"{run.name}/{split} source provenance failures: {failures}")
        old = manifest["tokenization"][split]
        for field in ("selected", "encoded", "over_length_skipped"):
            if summary[field] != old[field]:
                raise ValueError(f"{run.name}/{split}/{field} differs from manifest")
        if {k: v for k, v in summary["labels"].items() if v} != old["labels"]:
            raise ValueError(f"{run.name}/{split} label counts differ from manifest")
        checks.append(f"{split}: hash, label mapping, human-final original source and tokenization counts match")
        splits[split] = {"path": str(path), "sha256": digest, **summary}
        selected_rows[split] = rows
    leakage = overlap(selected_rows["train"], selected_rows["dev"])
    if any(leakage[k] for k in ("essay_id", "user", "user_prompt_set", "exact_text", "normalized_text")):
        raise ValueError(f"Train/dev leakage found: {leakage}")
    tokenizer_hashes = {f.name: sha256(f) for f in sorted(tokenizer_dir.iterdir())
                        if f.is_file() and f.name in {"tokenizer_config.json", "special_tokens_map.json", "spm.model", "tokenizer.json", "added_tokens.json"}}
    return {"run": str(run.resolve()), "manifest_sha256": sha256(manifest_path),
            "adapter_sha256": sha256(tokenizer_dir / "adapter_model.safetensors"),
            "tokenizer_files_sha256": tokenizer_hashes, "budget": manifest["max_input_length"],
            "base_revision": manifest.get("base_revision"), "checks": checks,
            "train_dev_overlap": leakage, "splits": splits}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="+", type=Path, default=[ROOT / "artifacts/cefr-my-first-run", ROOT / "artifacts/cefr-balanced-v1"])
    parser.add_argument("--source", type=Path, default=Path.home() / "Downloads/write-and-improve-corpus-2024-v2/whole-corpus/en-writeandimprove2024-corpus.tsv")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    with args.source.open(encoding="utf-8-sig", newline="") as stream:
        source_rows = list(csv.DictReader(stream, delimiter="\t"))
    source_by_id = {r["public_essay_id"]: r for r in source_rows}
    if len(source_by_id) != len(source_rows):
        raise ValueError("Source essay IDs are duplicated")
    results = [audit_run(run, source_by_id) for run in args.runs]
    report = {"kind": "CPU provenance audit; no inference, training, test scoring or data mutation",
              "source": str(args.source.resolve()), "source_sha256": sha256(args.source),
              "source_rows": len(source_rows), "audit_source_sha256": sha256(Path(__file__)), "runs": results,
              "limitations": ["Exact/normalized overlap checks do not exclude near-duplicate semantic overlap.",
                              "Prompts are shared across splits; user separation does not imply unseen-prompt evaluation.",
                              "Indicative human labels are not an official CEFR certificate.",
                              "Source TSV checked byte-for-byte at essay field level; original licensed ZIP hash not rechecked.",
                              "No held-out test inputs/labels were used in this audit."]}
    (args.output / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"runs": len(results), "status": "passed", "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
