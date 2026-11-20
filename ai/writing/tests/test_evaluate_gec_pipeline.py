import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_gec_pipeline import run_pipeline, score
from inference import InputBudgetError


class FakeEngine:
    """Fictional rule-based corrector standing in for WritingEngine.analyze."""
    def __init__(self):
        self.calls = []

    def analyze(self, text, corrections=False):
        self.calls.append(text)
        if len(text.split()) < 3:
            raise InputBudgetError("too short")
        fixed = text.replace("She go ", "She goes ", 1)
        if fixed == text:
            fixed = text.replace(" study ", " studies ", 1)
        changed = fixed != text
        return {"correctedText": fixed, "gecCoverage": {"totalBodySentences": 1, "changed": int(changed),
                                                        "unchanged": int(not changed), "rejected": 0}}


class PipelineEvaluationTests(unittest.TestCase):
    def test_second_pass_fixes_remaining_error(self):
        text = "She go home and study English."
        one, _, _ = run_pipeline(FakeEngine(), text, passes=1)
        two, coverage, status = run_pipeline(FakeEngine(), text, passes=2)
        self.assertEqual(one, "She goes home and study English.")
        self.assertEqual(two, "She goes home and studies English.")
        self.assertEqual((status, coverage["changed"]), ("ok", 2))

    def test_stops_when_nothing_changes_and_reports_rejection(self):
        engine = FakeEngine()
        prediction, _, status = run_pipeline(engine, "This sentence is fine.", passes=3)
        self.assertEqual((prediction, len(engine.calls), status), ("This sentence is fine.", 1, "ok"))
        prediction, _, status = run_pipeline(FakeEngine(), "Too short", passes=2)
        self.assertEqual((prediction, status), ("Too short", "input_rejected"))

    @unittest.skipUnless(importlib.util.find_spec("errant") and importlib.util.find_spec("en_core_web_sm"),
                         "requires ai/writing/requirements-evaluation.txt")
    def test_score_reports_errant_and_overcorrection(self):
        groups = {
            "requires_edit": [{"id": "e1", "text": "She go to school every day.",
                               "corrected_text": "She goes to school every day."}],
            "already_correct": [{"id": "c1", "text": "We study maths at home.", "corrected_text": "We study maths at home."},
                                {"id": "c2", "text": "They walk to the park.", "corrected_text": "They walk to the park."}],
        }
        with tempfile.TemporaryDirectory() as tmp:
            report = score(groups, FakeEngine(), passes=1, output=Path(tmp) / "out")
        metrics = report["metrics"]
        self.assertEqual((metrics["tp"], metrics["fn"]), (1, 0))
        self.assertEqual(metrics["fp"], 1)  # "study" -> "studies" on a correct sentence
        self.assertAlmostEqual(metrics["overcorrection_rate"], 0.5)
        self.assertEqual(report["groups"]["already_correct"]["changed"], 1)


if __name__ == "__main__":
    unittest.main()
