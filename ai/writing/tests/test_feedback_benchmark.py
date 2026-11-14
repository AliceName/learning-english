import copy
import json
import math
from pathlib import Path
import tempfile
import unittest

from benchmark_feedback import WARMUP_TEXT, load_cases, summarize
from synthetic_feedback_fixture import write_feedback_fixture


class FeedbackBenchmarkTests(unittest.TestCase):
    def test_synthetic_contract_fixtures_are_unique_bounded_and_grounded(self):
        with tempfile.TemporaryDirectory() as directory:
            cases = load_cases(write_feedback_fixture(Path(directory) / "fixtures.jsonl"))
        self.assertEqual(30, len(cases))
        self.assertEqual(30, len({r["text"] for r in cases}))
        self.assertTrue(all(80 <= len(r["text"].split()) <= 150 for r in cases))
        self.assertTrue(80 <= len(WARMUP_TEXT.split()) <= 150)
        self.assertNotIn(WARMUP_TEXT, {r["text"] for r in cases})
        self.assertEqual(3, sum(bool(r["errors"]) for r in cases))
        self.assertEqual(2, sum(r["topic"] is None for r in cases))

    def test_gate_uses_all_30_deadlines_and_inclusive_27_ready_boundary(self):
        records = [{"durationSeconds": 30.0, "runtimeWarmBefore": True,
                    "response": {"status": "ready" if i < 27 else "unavailable"}, "reason": None} for i in range(30)]
        report = summarize(records, cold_startup_seconds=3.2)
        self.assertTrue(report["technical_gate_passed"])
        self.assertEqual(27, report["readyCount"])
        self.assertEqual(30.0, report["p95Seconds"])
        self.assertFalse(report["pedagogyValidated"])
        self.assertTrue(report["successfuldoesnotmeanpedagogyvalidated"])
        records[0]["durationSeconds"] = 30.00001
        self.assertFalse(summarize(records, cold_startup_seconds=3.2)["technical_gate_passed"])
        records[0]["durationSeconds"] = 1
        records[0]["response"]["status"] = "unavailable"
        self.assertFalse(summarize(records, cold_startup_seconds=3.2)["technical_gate_passed"])

    def test_missing_cold_or_nonfinite_cases_cannot_pass_as_warm_benchmark(self):
        records = [{"durationSeconds": float(i + 1), "runtimeWarmBefore": True,
                    "response": {"status": "ready"}} for i in range(30)]
        self.assertEqual(29, summarize(records, cold_startup_seconds=0)["p95Seconds"])
        self.assertFalse(summarize(records[:-1], cold_startup_seconds=0)["technical_gate_passed"])
        records[0]["runtimeWarmBefore"] = False
        self.assertFalse(summarize(records, cold_startup_seconds=0)["technical_gate_passed"])
        for invalid in (math.nan, math.inf, -1):
            records[0]["durationSeconds"] = invalid
            with self.assertRaises(ValueError):
                summarize(records, cold_startup_seconds=0)

    def test_fixture_validation_rejects_wrong_count_duplicate_and_ungrounded_change(self):
        with tempfile.TemporaryDirectory() as directory:
            cases = load_cases(write_feedback_fixture(Path(directory) / "fixtures.jsonl"))
        variants = [cases[:-1], copy.deepcopy(cases), copy.deepcopy(cases)]
        variants[1][1]["text"] = variants[1][0]["text"]
        variants[2][0]["errors"] = [{"original": "Never present in the essay.", "suggestion": "Changed."}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixtures.jsonl"
            for variant in variants:
                path.write_text("".join(json.dumps(row) + "\n" for row in variant), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_cases(path)


if __name__ == "__main__":
    unittest.main()
