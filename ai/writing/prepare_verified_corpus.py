"""Repair proven Unicode serialization in W&I TRAIN only; preserve frozen holdouts.

This changes representation, not teacher corrections. An essay is authorized only
when both official sentence streams reconstruct their original/ref1 Markdown after
one strict Unicode-scalar decoding pass. Comparison ignores whitespace only; the
training strings retain every original character except the proven escape decoding.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from zipfile import ZipFile

from data import (SPLITS, deduplicate_inputs, normalized_text, read_jsonl,
                  read_member_bytes, remove_cross_split_duplicates, verify_prepared)

ENCODING_POLICY = "verified-unicode-train-v2"
REPORT_KIND = "verified_unicode_representation_repair_train_only_not_gold_relabel"
_HEADER = re.compile(r"^### essay_id = ([^\r\n]+)\r?\n", re.MULTILINE)
_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})")
FILES = tuple(f"{task}-{split}.jsonl" for task in ("cefr", "gec") for split in SPLITS)


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def text_sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def compact(value: str) -> str:
    return "".join(value.split())


def escaped_whitespace_matches(value: str, markdown: str) -> bool:
    """Prove escaped whitespace against raw Markdown, not compacted text.

    Literal tokenizer whitespace remains ignorable for reconstruction. Whitespace
    introduced by a Unicode escape must have that exact codepoint at the same
    boundary between non-whitespace characters. Multiple introduced codepoints at
    one boundary must occur in order, without reusing Markdown characters.
    """
    required, actual = defaultdict(list), defaultdict(list)
    preceding, cursor = 0, 0
    for match in _ESCAPE.finditer(value):
        preceding += sum(not char.isspace() for char in value[cursor:match.start()])
        char = chr(int(match.group(1), 16))
        if char.isspace():
            required[preceding].append(char)
        else:
            preceding += 1
        cursor = match.end()
    preceding = 0
    for char in markdown:
        if char.isspace():
            actual[preceding].append(char)
        else:
            preceding += 1
    for boundary, codepoints in required.items():
        available = iter(actual[boundary])
        for char in codepoints:
            if not any(found == char for found in available):
                return False
    return True


def strict_decode(value: str) -> str:
    """Decode exactly one pass, rejecting malformed, surrogate and Cc controls.

    Existing format characters (e.g. U+200B) are preserved as the Markdown corpus
    contains them too. No quote folding, case conversion or recursive decoding.
    """
    for match in re.finditer(r"\\u", value):
        if not _ESCAPE.match(value, match.start()):
            raise ValueError("malformed_unicode_escape")

    def replace(match):
        code = int(match.group(1), 16)
        if 0xD800 <= code <= 0xDFFF:
            raise ValueError("surrogate_unicode_escape")
        char = chr(code)
        if unicodedata.category(char) == "Cc":
            raise ValueError("control_unicode_escape")
        return char

    return _ESCAPE.sub(replace, value)


def markdown_essays(value: str) -> dict[str, str]:
    matches = list(_HEADER.finditer(value))
    if not matches:
        raise ValueError("Markdown has no essay_id headers")
    result = {}
    for index, match in enumerate(matches):
        identifier = match.group(1).strip()
        if identifier in result:
            raise ValueError("Duplicate essay_id in Markdown")
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(value)
        result[identifier] = value[match.end():stop].strip()
    return result


def load_train_evidence(source: Path, preparation: dict):
    """Never opens dev/test references or uses them to authorize train changes."""
    context = nullcontext(source) if source.is_dir() else ZipFile(source)
    hashes = {}
    records, proofs = {}, {}
    with context as archive:
        def read(member, expected=False):
            payload = read_member_bytes(archive, member)
            actual = hashlib.sha256(payload).hexdigest()
            if expected and preparation["source_files_sha256"].get(member) != actual:
                raise ValueError(f"Original source hash differs: {member}")
            hashes[member] = actual
            return payload.decode("utf-8-sig")

        for version in ("final", "first"):
            prefix = f"user-prompt-{version}-versions/en-writeandimprove2024-{version}-versions-"
            originals, targets, ids = [read(prefix + "train-sentences" + ext, True).splitlines()
                                       for ext in (".orig", ".corr", ".ids")]
            if not len(originals) == len(targets) == len(ids):
                raise ValueError("Misaligned original train streams")
            markdown_source = markdown_essays(read(prefix + "orig-train.md"))
            markdown_target = markdown_essays(read(prefix + "ref1-train.md"))
            groups, ordinal = defaultdict(list), Counter()
            for original, target, essay in zip(originals, targets, ids, strict=True):
                ordinal[essay] += 1
                identifier = f"{essay}:{ordinal[essay]}"
                if version == "first":
                    identifier = f"first:{identifier}"
                if identifier in records:
                    raise ValueError("Duplicate train sentence identifier")
                records[identifier] = dict(source_version=version, essay_id=essay,
                                           text=original, corrected_text=target)
                groups[essay].append((original, target))
            if set(groups) != set(markdown_source) or set(groups) != set(markdown_target):
                raise ValueError("Sentence/Markdown essay inventories differ")
            for essay, pairs in groups.items():
                source_stream = "".join(s for s, _ in pairs)
                target_stream = "".join(t for _, t in pairs)
                reason = None
                try:
                    decoded_source, decoded_target = strict_decode(source_stream), strict_decode(target_stream)
                    reconstructed = (compact(decoded_source) == compact(markdown_source[essay])
                                     and compact(decoded_target) == compact(markdown_target[essay]))
                    whitespace_proven = (escaped_whitespace_matches(source_stream, markdown_source[essay])
                                         and escaped_whitespace_matches(target_stream, markdown_target[essay]))
                    proven = reconstructed and whitespace_proven
                    if not reconstructed:
                        reason = "two_sided_markdown_reconstruction_failed"
                    elif not whitespace_proven:
                        reason = "escaped_whitespace_not_proven_in_markdown"
                except ValueError as error:
                    proven, reason = False, str(error)
                proofs[(version, essay)] = dict(
                    source_version=version, essay_id=essay, authorized=proven, reason=reason,
                    sentence_count=len(pairs),
                    source_has_escape=bool(_ESCAPE.search(source_stream)),
                    target_has_escape=bool(_ESCAPE.search(target_stream)),
                    original_markdown_sha256=text_sha(markdown_source[essay]),
                    corrected_markdown_sha256=text_sha(markdown_target[essay]),
                    original_stream_sha256=text_sha(source_stream), target_stream_sha256=text_sha(target_stream))
    return records, proofs, hashes


def repair_train(rows: list[dict], records: dict, proofs: dict):
    repaired, changes, unresolved = [], [], []
    for row in rows:
        if row.get("split") != "train" or row.get("source_version") not in ("final", "first"):
            raise ValueError("Expected official first/final train rows")
        raw = records.get(row["id"])
        if raw is None or any(raw[key] != row.get(key) for key in
                              ("text", "corrected_text", "source_version", "essay_id")):
            raise ValueError("Prepared train row differs from original sentence streams")
        proof = proofs[(row["source_version"], row["essay_id"])]
        candidate = dict(row)
        if proof["authorized"]:
            candidate["text"] = strict_decode(row["text"])
            candidate["corrected_text"] = strict_decode(row["corrected_text"])
        elif "\\u" in row["text"] or "\\u" in row["corrected_text"]:
            unresolved.append(dict(id=row["id"], essay_id=row["essay_id"],
                                   source_version=row["source_version"], reason=proof["reason"]))
        if candidate != row:
            changes.append(dict(id=row["id"], essay_id=row["essay_id"], source_version=row["source_version"],
                fields=[key for key in ("text", "corrected_text") if row[key] != candidate[key]],
                source_before_sha256=text_sha(row["text"]), source_after_sha256=text_sha(candidate["text"]),
                target_before_sha256=text_sha(row["corrected_text"]), target_after_sha256=text_sha(candidate["corrected_text"]),
                proof_key=f"{row['source_version']}:{row['essay_id']}"))
        repaired.append(candidate)
    return repaired, changes, unresolved


def deduplicate_train(rows: list[dict], heldouts: dict):
    # The source preparer already prioritizes final rows. Re-establish this stable
    # ordering explicitly, while retaining order inside each version.
    ordered = [row for version in ("final", "first") for row in rows if row["source_version"] == version]
    seen, trace = {}, []
    for row in ordered:
        key = " ".join(row["text"].split())
        if key in seen:
            winner = seen[key]
            trace.append(dict(id=row["id"], kept_id=winner["id"], reason="within_train_duplicate_input",
                conflicting_target=" ".join(row["corrected_text"].split()) != " ".join(winner["corrected_text"].split()),
                source_sha256=text_sha(row["text"]), target_sha256=text_sha(row["corrected_text"])))
        else:
            seen[key] = row
    parts = {"train": ordered}
    within = deduplicate_inputs(parts)["train"]
    before_cross = parts["train"]
    # Only heldout source strings are provided to the duplicate utility; no dev
    # target or test reference is inspected, changed, scored or used for tuning.
    parts.update(heldouts)
    before_holdout_ids = {split: [r["id"] for r in parts[split]] for split in ("dev", "test")}
    cross = remove_cross_split_duplicates(parts, "text")
    if any([r["id"] for r in parts[split]] != before_holdout_ids[split] for split in ("dev", "test")):
        raise ValueError("Frozen holdouts overlap each other; refusing to change them")
    heldout_matches = defaultdict(list)
    for split in ("dev", "test"):
        for row in heldouts[split]:
            heldout_matches[normalized_text(row["text"])].append(dict(split=split, id=row["id"]))
    kept = {row["id"] for row in parts["train"]}
    for row in before_cross:
        if row["id"] not in kept:
            trace.append(dict(id=row["id"], reason="cross_split_duplicate_input",
                              heldout_matches=heldout_matches[normalized_text(row["text"])],
                              source_sha256=text_sha(row["text"]), target_sha256=text_sha(row["corrected_text"])))
    return parts["train"], within, cross, trace


def reuse(source: Path, prepared: Path, output: Path):
    report_path = output / "preparation-report.json"
    if sha(report_path) != (output / "preparation-report.sha256").read_text(encoding="ascii").strip():
        raise ValueError("Verified preparation report hash changed")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("kind") != REPORT_KIND or report.get("encoding_policy") != ENCODING_POLICY:
        raise ValueError("Unsupported verified corpus policy")
    if sha(Path(__file__)) != report["preparer_sha256"]:
        raise ValueError("Preparer code changed; create a new prepared directory")
    if sha(Path(__file__).with_name("data.py")) != report["data_helpers_sha256"]:
        raise ValueError("Preparation helpers changed; create a new prepared directory")
    legacy = verify_prepared(source, prepared, "first-final")
    if sha(prepared / "preparation-report.json") != report["base_preparation_report_sha256"]:
        raise ValueError("Original preparation report changed")
    if legacy["prepared_files_sha256"] != report["base_prepared_files_sha256"]:
        raise ValueError("Original prepared files differ")
    context = nullcontext(source) if source.is_dir() else ZipFile(source)
    with context as archive:
        for member, expected in report["source_files_sha256"].items():
            if hashlib.sha256(read_member_bytes(archive, member)).hexdigest() != expected:
                raise ValueError(f"Corpus source changed: {member}")
    for name, expected in {**report["prepared_files_sha256"], **report["trace_files_sha256"]}.items():
        if sha(output / name) != expected:
            raise ValueError(f"Verified prepared output changed: {name}")
    return report


def prepare(source: Path, prepared: Path, output: Path):
    if output.resolve() == prepared.resolve() or output.resolve().is_relative_to(source.resolve()):
        raise ValueError("Output must be separate from immutable source/prepared inputs")
    if output.exists():
        raise ValueError("Choose a fresh output directory; refusing to overwrite")
    original = verify_prepared(source, prepared, "first-final")
    records, proofs, additional_hashes = load_train_evidence(source, original)
    old_rows = read_jsonl(prepared / "gec-train.jsonl")
    rows, changes, unresolved = repair_train(old_rows, records, proofs)
    # Streaming JSON reads extract source and ID only. Reference fields are not
    # retained or examined. Files themselves are copied unchanged below.
    heldouts = {}
    for split in ("dev", "test"):
        with (prepared / f"gec-{split}.jsonl").open(encoding="utf-8-sig") as stream:
            heldouts[split] = [dict(id=row["id"], text=row["text"])
                              for row in (json.loads(line) for line in stream if line.strip())]
    rows, within, cross, removals = deduplicate_train(rows, heldouts)
    kept = {row["id"] for row in rows}
    for change in changes:
        change["retained_after_dedup"] = change["id"] in kept
    report = dict(original)
    source_hashes = dict(original["source_files_sha256"], **additional_hashes)
    report.update(kind=REPORT_KIND, encoding_policy=ENCODING_POLICY, source_files_sha256=source_hashes,
        source_fingerprint_sha256=text_sha(json.dumps(source_hashes, sort_keys=True)),
        base_prepared_directory=str(prepared.resolve()),
        base_preparation_report_sha256=sha(prepared / "preparation-report.json"),
        base_prepared_files_sha256=original["prepared_files_sha256"], preparer_sha256=sha(Path(__file__)),
        data_helpers_sha256=sha(Path(__file__).with_name("data.py")),
        changed_split="train", frozen_dev_test_bytewise=True,
        representation_repair=dict(original_train_rows=len(old_rows), resulting_train_rows=len(rows),
            original_source_escape_rows=sum("\\u" in r["text"] for r in old_rows),
            original_target_escape_rows=sum("\\u" in r["corrected_text"] for r in old_rows),
            changed_rows=len(changes), changed_source_rows=sum("text" in c["fields"] for c in changes),
            changed_target_rows=sum("corrected_text" in c["fields"] for c in changes),
            retained_changed_rows=sum(c["retained_after_dedup"] for c in changes),
            unresolved_rows=len(unresolved), unresolved_by_reason=dict(Counter(r["reason"] for r in unresolved)),
            proof_essay_count=len(proofs), authorized_essay_count=sum(p["authorized"] for p in proofs.values()),
            unproven_essay_count=sum(not p["authorized"] for p in proofs.values()),
            within_train_removals=within, cross_split_removals=cross,
            decode_policy="single pass Unicode scalar; reject malformed/surrogate/Cc escapes; preserve other characters exactly",
            whitespace_policy="literal tokenizer whitespace ignored for reconstruction; every escaped whitespace must match exact raw Markdown codepoint and non-whitespace boundary in order; never collapse training strings"),
        limitations=[
            "Representation repair preserves official teacher targets; it is not a new gold-label review or spelling repair.",
            "A Markdown reconstruction proof does not certify grammatical or semantic quality of a target.",
            "Unproven essays remain unchanged and explicitly listed; no guesses or automatic semantic fixes.",
            "Only train is repaired. Dev/test JSONL remain bytewise identical for fixed evaluation comparability.",
            "Frozen dev can retain serialization artifacts; report real-user and frozen-dev evaluation separately.",
            "Re-deduplication may reduce train rows; fewer repeated rows does not mean less unique useful supervision.",
            "Heldout source strings are used only to prevent exact normalized input leakage, never as training targets.",
            "No model trained, no new external data, no new synthetic error or CEFR labels.",
        ])
    report["gec"] = {split: dict(value) for split, value in original["gec"].items()}
    report["gec"]["train"]["count"] = len(rows)
    report["gec_effective_versions"] = dict(original["gec_effective_versions"])
    report["gec_effective_versions"]["train"] = dict(Counter(r["source_version"] for r in rows))
    output.mkdir(parents=True, exist_ok=False)
    with (output / "gec-train.jsonl").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    for name in FILES:
        if name != "gec-train.jsonl":
            (output / name).write_bytes((prepared / name).read_bytes())
    traces = {"repair-changes.jsonl": changes, "repair-unresolved.jsonl": unresolved,
              "repair-removals.jsonl": removals, "repair-essay-proofs.jsonl": list(proofs.values())}
    for name, values in traces.items():
        with (output / name).open("x", encoding="utf-8", newline="\n") as stream:
            stream.write("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values))
    report["prepared_files_sha256"] = {name: sha(output / name) for name in FILES}
    report["trace_files_sha256"] = {name: sha(output / name) for name in traces}
    with (output / "preparation-report.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    (output / "preparation-report.sha256").write_text(sha(output / "preparation-report.json") + "\n", encoding="ascii")
    # Verify source/base files and every output after writing, not only before.
    reuse(source, prepared, output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse", action="store_true")
    args = parser.parse_args()
    operation = reuse if args.reuse and args.output.exists() else prepare
    report = operation(args.source, args.prepared, args.output)
    print(json.dumps(dict(encoding_policy=report["encoding_policy"], train_rows=report["gec"]["train"]["count"],
                          changed_rows=report["representation_repair"]["changed_rows"],
                          unresolved_rows=report["representation_repair"]["unresolved_rows"],
                          report_sha256=sha(args.output / "preparation-report.json"))))


if __name__ == "__main__":
    main()
