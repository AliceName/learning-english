import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from gec_gemini_replay import ARMS, digest, export, replay


class OfflineReplayTests(unittest.TestCase):
    def setUp(self):
        self.text = "I has a book.\r\nIt is blue."
        self.cases = [{"id": "synthetic-1", "original": self.text, "reference": "I have a book.\r\nIt is blue."}]
        self.rows = [
            {"case_id": "synthetic-1", "arm": arm, "status": "ok", "elapsed_ms": 10,
             "input_sha256": digest(self.text), "corrected": self.text, "provenance": "synthetic"}
            for arm in ARMS
        ]

    def test_disagreement_retains_independent_outputs_and_source(self):
        self.rows[1]["corrected"] = self.cases[0]["reference"]
        before = copy.deepcopy((self.cases, self.rows))
        results = replay(self.cases, self.rows)
        self.assertNotEqual(results["synthetic-1", "gec_only"], results["synthetic-1", "gemini_only"])
        self.assertEqual(before, (self.cases, self.rows))

    def test_timeout_is_recorded_without_prediction(self):
        self.rows[1].update(status="timeout", corrected=None, elapsed_ms=4000)
        self.assertEqual(replay(self.cases, self.rows)["synthetic-1", "gemini_only"]["elapsed_ms"], 4000)
        self.rows[1]["corrected"] = self.text
        with self.assertRaises(ValueError):
            replay(self.cases, self.rows)

    def test_invalid_missing_or_transformed_input_is_rejected(self):
        for updates in ({"corrected": []}, {"status": "invalid_response"}, {"input_sha256": digest(self.text.replace("\r", ""))}):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                replay(self.cases, [self.rows[0], self.rows[1] | updates, self.rows[2]])
        with self.assertRaises(ValueError):
            replay(self.cases, self.rows[:2])

    def test_export_keeps_all_pairings_and_marks_unchanged_timeout_fallback(self):
        self.rows[1].update(status="timeout", corrected=None, elapsed_ms=4000)
        self.rows[2]["corrected"] = self.cases[0]["reference"]
        with TemporaryDirectory() as directory:
            output = Path(directory) / "replay"
            with patch("gec_gemini_replay.m2_block", side_effect=lambda _, source, corrected: json.dumps([source, corrected])):
                export(self.cases, self.rows, None, output, "synthetic")
            report = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(report["counts"]["gemini_only"], {"timeout": 1})
            for arm in ARMS:
                source, corrected = json.loads((output / f"{arm}.m2").read_text(encoding="utf-8"))
                self.assertEqual(source, self.text)
                self.assertEqual(corrected, self.cases[0]["reference"] if arm == "hybrid" else self.text)
