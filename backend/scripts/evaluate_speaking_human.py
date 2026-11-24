"""Compare frozen Speaking predictions with independent human labels (no training).

Both inputs are UTF-8 JSONL. Reference rows contain recordingId, unitId,
unitType (phoneme/word), speakerId, split (train/calibration/test), referenceText,
nativeLanguage (e.g. vi), source='human', and humanScores (a list on 0..2).
Prediction rows contain recordingId, unitId, referenceText, modelVersion,
calibrationId, status, and score (final calibrated 0..2, or null if unassessed).
Use stable, manually checked unit IDs; filtered phone-array indices are unsafe.

The existing calibration is phoneme-only: word MAE is reported separately and
word practice decisions are not inferred from the phoneme threshold. Neither
input labels nor the calibration artifact are changed. No audio is generated.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path


DEFAULT_CALIBRATION = Path(__file__).resolve().parents[1] / "speaking-ai/configs/scoring-calibration.json"
UNASSESSED_STATUSES = {"unsupported", "record_again", "rejected"}


def required_text(row, field):
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


def checked_score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Scores must be numeric on the 0..2 scale")
    if not math.isfinite(value) or not 0 <= value <= 2:
        raise ValueError("Scores must be finite and within 0..2")
    return float(value)


def read_jsonl(path):
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as error:
            raise ValueError(f"{path.name}:{line_number}: invalid JSON") from error
        if not isinstance(row, dict):
            raise ValueError(f"{path.name}:{line_number}: expected a JSON object")
        rows.append(row)
    return rows


def load_calibration(path):
    artifact = json.loads(path.read_text(encoding="utf-8-sig"))
    payload = {key: value for key, value in artifact.items() if key != "calibration_id"}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if artifact.get("calibration_id") != "cal1-" + fingerprint[:16]:
        raise ValueError("Calibration fingerprint does not match its contents")
    threshold = checked_score(artifact.get("practice_threshold"))
    if not .25 <= threshold <= 1.95:
        raise ValueError("Practice threshold is outside the supported calibration range")
    return artifact


def validate_references(rows, fit_speakers):
    references, recordings, speakers = {}, {}, {}
    for row in rows:
        for field in ("recordingId", "unitId", "speakerId", "referenceText", "nativeLanguage"):
            required_text(row, field)
        key = row["recordingId"], row["unitId"]
        if key in references:
            raise ValueError(f"Duplicate human label: {key}")
        if row.get("source") != "human":
            raise ValueError("Only source='human' labels are accepted; synthesized audio is not human evidence")
        if row.get("unitType") not in {"phoneme", "word"}:
            raise ValueError("unitType must be phoneme or word")
        if row.get("split") not in {"train", "calibration", "test"}:
            raise ValueError("split must be train, calibration, or test")
        scores = row.get("humanScores")
        if not isinstance(scores, list) or not scores:
            raise ValueError("humanScores must contain at least one human rating on 0..2")
        mean = sum(checked_score(score) for score in scores) / len(scores)
        metadata = tuple(row[field] for field in ("speakerId", "split", "referenceText", "nativeLanguage"))
        previous = recordings.setdefault(row["recordingId"], metadata)
        if previous != metadata:
            raise ValueError(f"Inconsistent recording metadata: {row['recordingId']}")
        previous_split = speakers.setdefault(row["speakerId"], row["split"])
        if previous_split != row["split"]:
            raise ValueError(f"Speaker overlap between splits: {row['speakerId']}")
        if row["split"] == "test" and row["speakerId"] in fit_speakers:
            raise ValueError(f"Held-out speaker appears in supplied fit registry: {row['speakerId']}")
        references[key] = {**row, "humanMean": mean}
    return references


def validate_predictions(rows, references, calibration_id):
    models = {}
    for row in rows:
        for field in ("recordingId", "unitId", "referenceText", "modelVersion", "calibrationId"):
            required_text(row, field)
        key = row["recordingId"], row["unitId"]
        if key not in references:
            raise ValueError(f"Prediction has no matching human annotation: {key}")
        if references[key]["referenceText"] != row["referenceText"]:
            raise ValueError(f"Prediction/reference text mismatch: {key}")
        if row["calibrationId"] != calibration_id:
            raise ValueError(f"Prediction calibrationId does not match the frozen artifact: {key}")
        predictions = models.setdefault(row["modelVersion"], {})
        if key in predictions:
            raise ValueError(f"Duplicate prediction for {row['modelVersion']}: {key}")
        status = row.get("status")
        if status == "scored":
            checked_score(row.get("score"))
        elif status not in UNASSESSED_STATUSES or row.get("score") is not None:
            raise ValueError("Unassessed predictions need null score and status unsupported/record_again/rejected")
        predictions[key] = row
    return models


def summarize(rows, predictions, threshold, unit_type):
    paired, missing, unassessed = [], 0, {}
    for row in rows:
        prediction = predictions.get((row["recordingId"], row["unitId"]))
        if prediction is None:
            missing += 1
        elif prediction["status"] != "scored":
            status = prediction["status"]
            unassessed[status] = unassessed.get(status, 0) + 1
        else:
            paired.append((row["humanMean"], prediction["score"]))
    errors = [prediction - target for target, prediction in paired]
    result = {
        "status": "measured_comparison" if paired else "insufficient_data",
        "annotated_units": len(rows),
        "recordings": len({row["recordingId"] for row in rows}),
        "speakers": len({row["speakerId"] for row in rows}),
        "scored_units": len(paired), "missing_predictions": missing,
        "unassessed": unassessed,
        "scored_coverage": len(paired) / len(rows) if rows else None,
        "mae": sum(abs(error) for error in errors) / len(errors) if errors else None,
        "rmse": math.sqrt(sum(error ** 2 for error in errors) / len(errors)) if errors else None,
        "practice_decisions": None,
    }
    if unit_type == "phoneme":
        tp = sum(target < 1.5 and prediction < threshold for target, prediction in paired)
        fp = sum(target >= 1.5 and prediction < threshold for target, prediction in paired)
        fn = sum(target < 1.5 and prediction >= threshold for target, prediction in paired)
        tn = len(paired) - tp - fp - fn
        result["practice_decisions"] = {
            "human_weak_below": 1.5, "prediction_practice_below": threshold,
            "true_suggestions": tp, "false_suggestions": fp, "missed_weak": fn, "true_nonweak": tn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "false_suggestion_rate": fp / (fp + tn) if fp + tn else None,
            "missed_weak_rate": fn / (tp + fn) if tp + fn else None,
        }
    return result


def evaluate(reference_rows, prediction_rows, calibration, fit_speakers=None):
    references = validate_references(reference_rows, set(fit_speakers or []))
    models = validate_predictions(prediction_rows, references, calibration["calibration_id"])
    held_out = [row for row in references.values() if row["split"] == "test"]
    results = {}
    for version, predictions in models.items():
        results[version] = {}
        for group, rows in (("all_test", held_out), ("vietnamese_test", [row for row in held_out if row["nativeLanguage"].lower() == "vi"])):
            results[version][group] = {
                kind: summarize([row for row in rows if row["unitType"] == kind], predictions,
                                calibration["practice_threshold"], kind)
                for kind in ("phoneme", "word")
            }
    vietnamese_scored = any(
        result["vietnamese_test"][kind]["scored_units"]
        for result in results.values() for kind in ("phoneme", "word")
    )
    common_results = {}
    if len(models) > 1:
        common_rows = [
            row for row in held_out
            if all(predictions.get((row["recordingId"], row["unitId"]), {}).get("status") == "scored"
                   for predictions in models.values())
        ]
        for version, predictions in models.items():
            common_results[version] = {
                group: {
                    kind: summarize([row for row in rows if row["unitType"] == kind], predictions,
                                    calibration["practice_threshold"], kind)
                    for kind in ("phoneme", "word")
                }
                for group, rows in (("all_test", common_rows), ("vietnamese_test", [
                    row for row in common_rows if row["nativeLanguage"].lower() == "vi"
                ]))
            }
    return {
        "schema_version": 1,
        "status": "measured_comparison" if vietnamese_scored else "insufficient_data",
        "calibration_id": calibration["calibration_id"],
        "calibration_evidence_scope": calibration.get("evidence_scope"),
        "held_out_annotated_units": len(held_out),
        "vietnamese_held_out_annotated_units": sum(row["nativeLanguage"].lower() == "vi" for row in held_out),
        "split_speaker_counts": {
            split: len({row["speakerId"] for row in references.values() if row["split"] == split})
            for split in ("train", "calibration", "test")
        },
        "fit_registry_supplied": fit_speakers is not None,
        "supplied_fit_speakers": len(set(fit_speakers or [])),
        "models": results,
        "common_scored_model_comparison": common_results,
        "limitations": [
            "No Vietnamese-speaker validation claim is made. Human label authenticity and actual model training membership are not independently audited.",
            "Only scored units enter MAE/confusion counts; missing and unassessed units remain visible in coverage.",
            "MAE uses mean human ratings on 0..2. Practice threshold applies only to phonemes; words have no calibrated practice classification.",
            "Test speakers must be disjoint from supplied train/calibration speakers. Supply the full fit registry to check known prior training membership.",
            "Small samples and one-rater labels are exploratory. Freeze model, mapping, calibration and unit alignment before evaluating the held-out set.",
            "Compare model versions using common_scored_model_comparison; per-model MAE may otherwise use different units.",
            "A practice suggestion is not a diagnosis of a substituted or missing phoneme.",
        ],
    }


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--calibration-artifact", type=Path, default=DEFAULT_CALIBRATION)
    parser.add_argument("--fit-speakers", type=Path, help="One anonymous speaker ID per line, all known training/calibration speakers")
    args = parser.parse_args()
    try:
        inputs = [args.references, args.predictions, args.calibration_artifact]
        if args.fit_speakers:
            inputs.append(args.fit_speakers)
        if args.output.resolve() in {path.resolve() for path in inputs}:
            raise ValueError("Output must not overwrite any input")
        calibration = load_calibration(args.calibration_artifact)
        speakers = args.fit_speakers.read_text(encoding="utf-8-sig").splitlines() if args.fit_speakers else None
        if speakers is not None:
            speakers = [speaker.strip() for speaker in speakers if speaker.strip()]
        report = evaluate(read_jsonl(args.references), read_jsonl(args.predictions), calibration, speakers)
        report["input_sha256"] = {
            "references": digest(args.references), "predictions": digest(args.predictions),
            "calibration_artifact": digest(args.calibration_artifact),
            "fit_speakers": digest(args.fit_speakers) if args.fit_speakers else None,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(2, f"Evaluation error: {error}\n")
    print(f"{report['status']}: {args.output}")


if __name__ == "__main__":
    main()
