import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit_cefr_model import summarize, slices


class ModelAuditMetricsTests(unittest.TestCase):
    def test_confusion_and_ordinal_errors(self):
        rows = [{"reference": "A2", "predicted": "A2"},
                {"reference": "B1", "predicted": "B2"},
                {"reference": "C2", "predicted": "B1"}]
        r = summarize(rows)
        self.assertAlmostEqual(r["accuracy"], 1/3)
        self.assertAlmostEqual(r["mean_absolute_band_error"], 4/3)
        self.assertEqual(r["two_or_more_band_errors"], 1)
        self.assertEqual(r["per_class"]["A1"]["assessment"], "unsupported")
        self.assertIsNone(r["per_class"]["A1"]["recall"])
        self.assertEqual(r["per_class"]["C2"]["f1"], 0)

    def test_fixed_six_macro_does_not_hide_absent_classes(self):
        r = summarize([{"reference": "B1", "predicted": "B1"}])
        self.assertAlmostEqual(r["macro_f1_fixed_six"], 1/6)
        self.assertIsNone(r["quadratic_weighted_kappa"])

    def test_prompt_slices_do_not_lose_examples(self):
        rows = [{"reference": "B1", "predicted": "B1", "prompt": "one"},
                {"reference": "B2", "predicted": "B1", "prompt": "two"}]
        r = slices(rows, "prompt")
        self.assertEqual(sum(g["count"] for g in r.values()), 2)

    def test_reject_empty_and_invalid_labels(self):
        with self.assertRaises(ValueError):
            summarize([])
        with self.assertRaises(ValueError):
            summarize([{"reference": "A3", "predicted": "B1"}])


if __name__ == "__main__":
    unittest.main()
