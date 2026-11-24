"""Synthetic unit fixtures test the evaluator, never pronunciation accuracy."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from evaluate_speaking_human import DEFAULT_CALIBRATION, evaluate, load_calibration


class HumanSpeakingEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.calibration = load_calibration(DEFAULT_CALIBRATION)

    def reference(self, unit, score=1, **overrides):
        return {
            "recordingId": "synthetic-fixture-recording", "unitId": str(unit), "unitType": "phoneme",
            "speakerId": "fixture-speaker", "split": "test", "referenceText": "A test sentence.",
            "nativeLanguage": "vi", "source": "human", "humanScores": [score], **overrides,
        }

    def prediction(self, unit, score=1, **overrides):
        return {
            "recordingId": "synthetic-fixture-recording", "unitId": str(unit),
            "referenceText": "A test sentence.", "modelVersion": "fixture-model",
            "calibrationId": self.calibration["calibration_id"], "status": "scored", "score": score,
            **overrides,
        }

    def summary(self, report, version="fixture-model", kind="phoneme"):
        return report["models"][version]["vietnamese_test"][kind]

    def test_metrics_confusion_and_unassessed_denominators(self):
        references = [self.reference(i, score) for i, score in enumerate([0, 2, 1, 2, 0, 1])]
        predictions = [self.prediction(i, score) for i, score in enumerate([.5, .5, 1.5, 2])]
        predictions.append(self.prediction(4, None, status="record_again"))
        report = evaluate(references, predictions, self.calibration)
        summary = self.summary(report)
        self.assertEqual(report["status"], "measured_comparison")
        self.assertAlmostEqual(summary["mae"], .625)
        self.assertAlmostEqual(summary["rmse"], (2.75 / 4) ** .5)
        self.assertEqual(summary["scored_units"], 4)
        self.assertEqual(summary["missing_predictions"], 1)
        self.assertEqual(summary["unassessed"], {"record_again": 1})
        self.assertAlmostEqual(summary["scored_coverage"], 4 / 6)
        decisions = summary["practice_decisions"]
        for field in ("true_suggestions", "false_suggestions", "missed_weak", "true_nonweak"):
            self.assertEqual(decisions[field], 1)
        self.assertEqual(decisions["precision"], .5)
        self.assertEqual(decisions["recall"], .5)

    def test_human_ratings_are_averaged_and_boundaries_are_strict(self):
        ref = self.reference(0, humanScores=[1, 2])
        report = evaluate([ref], [self.prediction(0, 1.1)], self.calibration)
        summary = self.summary(report)
        self.assertAlmostEqual(summary["mae"], .4)
        self.assertEqual(summary["practice_decisions"]["true_nonweak"], 1)
        self.assertIsNone(summary["practice_decisions"]["recall"])

    def test_independent_models_compared_on_identical_scored_units(self):
        refs = [self.reference(0), self.reference(1)]
        preds = [self.prediction(0, 0), self.prediction(1, 2), self.prediction(0, .5, modelVersion="new-model")]
        report = evaluate(refs, preds, self.calibration)
        self.assertEqual(self.summary(report)["scored_units"], 2)
        self.assertEqual(self.summary(report, "new-model")["missing_predictions"], 1)
        common = report["common_scored_model_comparison"]
        for model in common.values():
            self.assertEqual(model["vietnamese_test"]["phoneme"]["scored_units"], 1)
        self.assertEqual(common["new-model"]["vietnamese_test"]["phoneme"]["mae"], .5)

    def test_word_scores_do_not_inherit_phoneme_threshold(self):
        report = evaluate([self.reference(0, unitType="word")], [self.prediction(0)], self.calibration)
        summary = self.summary(report, kind="word")
        self.assertEqual(summary["mae"], 0)
        self.assertIsNone(summary["practice_decisions"])

    def test_no_scored_vietnamese_test_rows_is_insufficient_data(self):
        for references, predictions in (
            ([], []),
            ([self.reference(0)], []),
            ([self.reference(0)], [self.prediction(0, None, status="unsupported")]),
            ([self.reference(0, nativeLanguage="en")], [self.prediction(0)]),
            ([self.reference(0, split="calibration")], [self.prediction(0)]),
        ):
            with self.subTest(references=references, predictions=predictions):
                report = evaluate(references, predictions, self.calibration)
                self.assertEqual(report["status"], "insufficient_data")
                if predictions:
                    self.assertIsNone(self.summary(report)["mae"])

    def test_speaker_overlap_is_rejected_including_prior_fit_registry(self):
        refs = [self.reference(0), self.reference(1, recordingId="other", split="train")]
        with self.assertRaisesRegex(ValueError, "Speaker overlap"):
            evaluate(refs, [], self.calibration)
        with self.assertRaisesRegex(ValueError, "fit registry"):
            evaluate([self.reference(0)], [], self.calibration, ["fixture-speaker"])

    def test_nonfinite_bool_wrong_scale_and_synthetic_source_are_rejected(self):
        for score in (float("nan"), float("inf"), True, -1, 90, "1"):
            with self.subTest(score=score):
                with self.assertRaises(ValueError):
                    evaluate([self.reference(0, score)], [], self.calibration)
                with self.assertRaises(ValueError):
                    evaluate([self.reference(0)], [self.prediction(0, score)], self.calibration)
        with self.assertRaisesRegex(ValueError, "source='human'"):
            evaluate([self.reference(0, source="synthetic")], [], self.calibration)

    def test_duplicates_unknown_units_and_text_or_calibration_mismatch_are_rejected(self):
        ref, pred = self.reference(0), self.prediction(0)
        cases = [
            ([ref, ref], []), ([ref], [pred, pred]), ([ref], [self.prediction(9)]),
            ([ref], [self.prediction(0, referenceText="Different sentence.")]),
            ([ref], [self.prediction(0, calibrationId="wrong")]),
            ([ref], [self.prediction(0, .5, status="unsupported")]),
        ]
        for references, predictions in cases:
            with self.subTest(references=references, predictions=predictions):
                with self.assertRaises(ValueError):
                    evaluate(references, predictions, self.calibration)

    def test_calibration_fingerprint_is_checked(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "calibration.json"
            artifact = copy.deepcopy(self.calibration)
            artifact["practice_threshold"] = 1.5
            path.write_text(json.dumps(artifact), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                load_calibration(path)

    def test_cli_preserves_inputs_and_rejects_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            refs, preds, output = root / "references.jsonl", root / "predictions.jsonl", root / "report.json"
            refs.write_text(json.dumps(self.reference(0)) + "\n", encoding="utf-8")
            preds.write_text(json.dumps(self.prediction(0)) + "\n", encoding="utf-8")
            before = [path.read_bytes() for path in (refs, preds, DEFAULT_CALIBRATION)]
            command = [sys.executable, str(Path(__file__).with_name("evaluate_speaking_human.py")),
                       "--references", str(refs), "--predictions", str(preds), "--output"]
            result = subprocess.run(command + [str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["status"], "measured_comparison")
            self.assertEqual(before, [path.read_bytes() for path in (refs, preds, DEFAULT_CALIBRATION)])
            result = subprocess.run(command + [str(refs)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must not overwrite", result.stderr)
            self.assertEqual(refs.read_bytes(), before[0])


if __name__ == "__main__":
    unittest.main()
