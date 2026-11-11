"""Read a licensed ZIP or extracted directory locally; never execute bundled scripts."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from contextlib import nullcontext
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
SPLITS = ("train", "dev", "test")


def cefr_band(label: str) -> str:
    # A plus denotes the upper part of the same band; retain the original too.
    band = label.removesuffix("+")
    if band not in LEVELS:
        raise ValueError(f"Unsupported human CEFR label: {label!r}")
    return band


def read_member_bytes(archive: ZipFile | Path, suffix: str) -> bytes:
    if isinstance(archive, Path):
        root = archive.resolve()
        target = (root / suffix).resolve()
        if not target.is_relative_to(root):
            raise ValueError("Corpus member resolves outside the source directory")
        return target.read_bytes()
    matches = [n for n in archive.namelist() if n == suffix or n.endswith("/" + suffix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one archive member matching {suffix}; found {len(matches)}")
    return archive.read(matches[0])


def read_member(archive: ZipFile | Path, suffix: str) -> str:
    return read_member_bytes(archive, suffix).decode("utf-8-sig")


def deduplicate_inputs(parts: dict[str, list[dict]]) -> dict:
    """Keep final-version examples first; never multiply repeated/conflicting supervision."""
    report = {}
    for split, rows in parts.items():
        seen, kept = {}, []
        duplicate = conflicting = 0
        for row in rows:
            # Preserve case because capitalization itself can be a GEC target.
            key = " ".join(row["text"].split())
            if key in seen:
                duplicate += 1
                conflicting += " ".join(row.get("corrected_text", "").split()) != seen[key]
                continue
            seen[key] = " ".join(row.get("corrected_text", "").split())
            kept.append(row)
        parts[split] = kept
        report[split] = {"removed": duplicate, "conflicting_targets_removed": conflicting}
    return report


def tsv(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


def normalized_text(text: str) -> str:
    return " ".join(text.split()).casefold()


def remove_cross_split_duplicates(parts: dict[str, list[dict]], field: str) -> dict[str, int]:
    """Keep held-out examples; remove matching inputs from earlier splits."""
    seen: set[str] = set()
    removed = {}
    for split in reversed(SPLITS):
        kept = []
        current = set()
        for row in parts[split]:
            key = normalized_text(row[field])
            if key in seen:
                continue
            kept.append(row)
            current.add(key)
        removed[split] = len(parts[split]) - len(kept)
        parts[split] = kept
        seen.update(current)
    return removed


def assert_disjoint(parts: dict[str, list[dict]], field: str) -> None:
    for i, left in enumerate(SPLITS):
        a = {row[field] for row in parts[left]}
        for right in SPLITS[i + 1:]:
            if a & {row[field] for row in parts[right]}:
                raise ValueError(f"Split leakage in {field}: {left}/{right}")


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig") as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    if not rows:
        raise ValueError(f"No examples in {path}")
    return rows


def prepare(source: Path, output: Path, gec_versions: str = "final") -> dict:
    if gec_versions not in ("final", "first-final"):
        raise ValueError("GEC versions must be final or first-final")
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Output must be empty: {output}")
    source_hashes = {}
    context = nullcontext(source) if source.is_dir() else ZipFile(source)
    with context as archive:
        def read(suffix):
            payload = read_member_bytes(archive, suffix)
            source_hashes[suffix] = hashlib.sha256(payload).hexdigest()
            return payload.decode("utf-8-sig")

        whole = tsv(read("whole-corpus/en-writeandimprove2024-corpus.tsv"))
        required = {"public_essay_id", "public_user_id", "public_prompt_id", "text",
                    "is_final_version", "humannotator_cefr_level", "split"}
        if not whole or not required <= whole[0].keys():
            raise ValueError("Archive is not the expected Write & Improve v2 schema")
        final = [row for row in whole if row["is_final_version"].upper() == "TRUE"]
        by_id = {row["public_essay_id"]: row for row in whole}
        if len(by_id) != len(whole):
            raise ValueError("Duplicate essay IDs in corpus metadata")
        cefr = {split: [] for split in SPLITS}
        missing = 0
        for row in final:
            label = row["humannotator_cefr_level"]
            if label in ("", "NA"):
                missing += 1
                continue
            split = row["split"]
            if split not in SPLITS:
                raise ValueError("Human-labelled final essay has no official split")
            if not row["text"].strip():
                raise ValueError("Empty human-labelled essay")
            cefr[split].append({
                "id": row["public_essay_id"], "user_id": row["public_user_id"],
                "prompt_id": row["public_prompt_id"], "text": row["text"],
                "cefr": cefr_band(label), "original_cefr": label,
                "label_source": "human_final", "split": split,
            })
        assert_disjoint(cefr, "user_id")
        assert_disjoint(cefr, "id")
        removed_cefr = remove_cross_split_duplicates(cefr, "text")

        gec = {split: [] for split in SPLITS}
        versions = ("final", "first") if gec_versions == "first-final" else ("final",)
        raw_counts = {}
        for version in versions:
            prefix = f"user-prompt-{version}-versions/en-writeandimprove2024-{version}-versions-"
            for split in SPLITS:
                originals = read(prefix + split + "-sentences.orig").splitlines()
                ids = read(prefix + split + "-sentences.ids").splitlines()
                corrections = (read(prefix + split + "-sentences.corr").splitlines()
                               if split != "test" else [None] * len(originals))
                if not len(originals) == len(ids) == len(corrections):
                    raise ValueError(f"Misaligned GEC source/correction/ID files for {version}/{split}")
                raw_counts[f"{version}-{split}"] = len(originals)
                sentence_number: Counter = Counter()
                for original, corrected, essay_id in zip(originals, corrections, ids, strict=True):
                    meta = by_id[essay_id]
                    if meta["split"] != split or meta.get(f"is_{version}_version", "").upper() != "TRUE":
                        raise ValueError("GEC ID metadata disagrees with official split/version")
                    sentence_number[essay_id] += 1
                    if not original.strip():
                        continue
                    sentence_id = f"{essay_id}:{sentence_number[essay_id]}"
                    item = {"id": sentence_id if version == "final" else f"first:{sentence_id}",
                            "essay_id": essay_id, "user_id": meta["public_user_id"],
                            "prompt_id": meta["public_prompt_id"], "text": original,
                            "split": split, "source_version": version}
                    if corrected is not None:
                        if not corrected.strip():
                            raise ValueError("Empty GEC correction")
                        item["corrected_text"] = corrected
                    gec[split].append(item)
        assert_disjoint(gec, "user_id")
        within_gec = deduplicate_inputs(gec) if gec_versions == "first-final" else None
        removed_gec = remove_cross_split_duplicates(gec, "text")

    fingerprint = hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest()
    digest = None
    if source.is_file():
        with source.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {
        "source_sha256": digest,
        "source_kind": "directory" if source.is_dir() else "zip",
        "source_fingerprint_sha256": fingerprint,
        "source_files_sha256": source_hashes,
        "gec_versions": list(versions), "gec_raw_counts": raw_counts,
        "gec_within_split_inputs_removed": within_gec,
        "cefr_label_policy": "human-labelled final originals only; X+ maps to X; no auto-label fallback",
        "cefr_unlabelled_final_skipped": missing,
        "cefr_cross_split_inputs_removed": removed_cefr,
        "gec_cross_split_inputs_removed": removed_gec,
        "cefr": {s: {"count": len(rows), "labels": dict(Counter(r["cefr"] for r in rows)),
                      "original_labels": dict(Counter(r["original_cefr"] for r in rows))}
                 for s, rows in cefr.items()},
        "gec": {s: {"count": len(rows), "has_human_corrections": s != "test"}
                for s, rows in gec.items()},
        "gec_effective_versions": {s: dict(Counter(r["source_version"] for r in rows)) for s, rows in gec.items()},
        "warnings": [
            "A1/C2 coverage is sparse: inspect per-class support before claiming A1-C2 quality.",
            "Official test data is held out. GEC test has no reference corrections in this ZIP.",
            "The corpus provides edits/corrections, not Vietnamese explanation/style supervision.",
            "Keep this report, corpus derivatives and trained adapters private under the source terms.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    for task, parts in (("cefr", cefr), ("gec", gec)):
        for split, rows in parts.items():
            with (output / f"{task}-{split}.jsonl").open("w", encoding="utf-8") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    report["prepared_files_sha256"] = {f"{task}-{split}.jsonl": hashlib.sha256(
        (output / f"{task}-{split}.jsonl").read_bytes()).hexdigest()
        for task in ("cefr", "gec") for split in SPLITS}
    (output / "preparation-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def verify_prepared(source: Path, output: Path, gec_versions: str) -> dict:
    report = json.loads((output / "preparation-report.json").read_text(encoding="utf-8"))
    expected = ["final", "first"] if gec_versions == "first-final" else ["final"]
    if report.get("gec_versions") != expected or not report.get("prepared_files_sha256"):
        raise ValueError("Prepared data configuration differs or has no integrity hashes; choose a new output directory")
    context = nullcontext(source) if source.is_dir() else ZipFile(source)
    with context as archive:
        for name, digest in report["source_files_sha256"].items():
            if hashlib.sha256(read_member_bytes(archive, name)).hexdigest() != digest:
                raise ValueError("Corpus source changed; prepare into a new directory")
    for task in ("cefr", "gec"):
        for split in SPLITS:
            name = f"{task}-{split}.jsonl"
            if hashlib.sha256((output / name).read_bytes()).hexdigest() != report["prepared_files_sha256"].get(name):
                raise ValueError("Prepared JSONL changed; prepare into a new directory")
    return report


def validate_splits(parts: dict[str, list[dict]], task: str) -> None:
    for split, rows in parts.items():
        if not rows:
            raise ValueError(f"Empty {split} set")
        for row in rows:
            fields = ["id", "user_id", "text"]
            if task == "cefr":
                fields += ["cefr", "label_source"]
                if row.get("cefr") not in LEVELS or row.get("label_source") != "human_final":
                    raise ValueError("CEFR requires human_final labels in A1-C2")
            elif task == "gec":
                fields += ["corrected_text"]
            else:
                fields += ["prompt", "corrected_text", "feedback", "reviewed_by"]
                if row.get("reviewed") is not True:
                    raise ValueError("Feedback examples must be human-reviewed; reviewed=true required")
            if any(not isinstance(row.get(k), str) or not row[k].strip() for k in fields):
                raise ValueError(f"Missing required fields for {task} in {split}; expected {fields}")
        if len({row["id"] for row in rows}) != len(rows):
            raise ValueError(f"Duplicate example IDs in {split}")
    # Apply the same checks to custom supervised feedback data as to corpus data.
    padded = {s: parts.get(s, []) for s in SPLITS}
    assert_disjoint(padded, "user_id")
    assert_disjoint(padded, "id")
    for i, left in enumerate(SPLITS):
        texts = {normalized_text(r["text"]) for r in padded[left]}
        for right in SPLITS[i + 1:]:
            if texts & {normalized_text(r["text"]) for r in padded[right]}:
                raise ValueError(f"Repeated input across {left}/{right}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--archive", type=Path, help="Legacy ZIP input")
    inputs.add_argument("--source", type=Path, help="Extracted corpus directory or ZIP")
    parser.add_argument("--gec-versions", choices=("final", "first-final"), default="final")
    parser.add_argument("--reuse", action="store_true", help="Reuse only after verifying source and prepared file hashes")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "prepared")
    args = parser.parse_args()
    operation = verify_prepared if args.reuse and (args.output / "preparation-report.json").exists() else prepare
    operation(args.source or args.archive, args.output, args.gec_versions)
    print(f"Prepared private data. Inspect {args.output / 'preparation-report.json'} locally.")
