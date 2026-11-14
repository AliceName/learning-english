"""Validate recorded benchmark arms offline and export paired ERRANT files."""
import argparse
import hashlib
import json
from pathlib import Path

from gec_evaluation import ERRANT_PROTOCOL, m2_block

ARMS = ("gec_only", "gemini_only", "hybrid")


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def replay(cases, recorded):
    by_key = {}
    for row in recorded:
        key = row["case_id"], row["arm"]
        if key in by_key:
            raise ValueError("Duplicate case/arm")
        by_key[key] = row
    expected = {(case["id"], arm) for case in cases for arm in ARMS}
    if len(expected) != len(cases) * len(ARMS) or set(by_key) != expected:
        raise ValueError("Each case must have exactly one record per arm")
    for case in cases:
        original = case["original"]
        for arm in ARMS:
            row = by_key[case["id"], arm]
            if row.get("input_sha256") != digest(original):
                raise ValueError("Source changed between arms")
            status = row.get("status")
            if status not in ("ok", "timeout", "invalid_response", "provider_error", "blocked"):
                raise ValueError("Unknown outcome")
            if type(row.get("elapsed_ms")) is not int or row["elapsed_ms"] < 0:
                raise ValueError("Elapsed time must be a nonnegative integer")
            output = row.get("corrected")
            if status == "ok" and (not isinstance(output, str) or not output.strip() or len(output) > 24000):
                raise ValueError("Invalid recorded output")
            if status != "ok" and output is not None:
                raise ValueError("Failed calls must not supply a prediction")
            if status == "ok" and (not isinstance(row.get("provenance"), str) or not row["provenance"].strip()):
                raise ValueError("Successful outputs require provenance")
    return by_key


def export(cases, recorded, annotator, destination, fixture_kind):
    outputs = replay(cases, recorded)
    counts = {arm: {} for arm in ARMS}
    for (_, arm), row in outputs.items():
        status = row["status"]
        counts[arm][status] = counts[arm].get(status, 0) + 1
    destination.mkdir()
    for filename, arm in [("reference", None), *((arm, arm) for arm in ARMS)]:
        with (destination / f"{filename}.m2").open("x", encoding="utf-8", newline="\n") as stream:
            for case in cases:
                original = case["original"]
                prediction = case["reference"] if arm is None else outputs[case["id"], arm].get("corrected") or original
                stream.write(m2_block(annotator, original, prediction))
    report = {
        "fixture_kind": fixture_kind, "errant_protocol": ERRANT_PROTOCOL, "counts": counts,
        "failed_prediction_policy": "evaluate the unchanged original and retain the failure status",
        "case_ids": [case["id"] for case in cases],
        "case_snapshot_sha256": digest(json.dumps(cases, ensure_ascii=False, sort_keys=True)),
        "output_snapshot_sha256": digest(json.dumps(recorded, ensure_ascii=False, sort_keys=True)),
    }
    (destination / "manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--records", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--fixture-kind", choices=("synthetic", "development", "approved-held-out"), required=True)
    args = parser.parse_args()
    import errant
    export(json.loads(args.cases.read_text(encoding="utf-8")), json.loads(args.records.read_text(encoding="utf-8")),
           errant.load("en"), args.output, args.fixture_kind)


if __name__ == "__main__":
    main()
