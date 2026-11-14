import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audit_cefr_data import distribution, overlap, provenance_errors, summarize


class CefrDataAuditTests(unittest.TestCase):
    def test_distribution_reports_conventional_even_median(self):
        self.assertEqual(distribution([3, 1, 4, 2])["median"], 2.5)
        self.assertIsNone(distribution([]))

    def row(self, **changes):
        return {"id": "e1", "text": "An original essay.", "user_id": "u1", "prompt_id": "p1",
                "split": "train", "cefr": "B1", "original_cefr": "B1+", "label_source": "human_final", **changes}

    def source(self, **changes):
        return {"is_final_version": "TRUE", "text": "An original essay.", "humannotator_cefr_level": "B1+",
                "public_user_id": "u1", "public_prompt_id": "p1", "split": "train", **changes}

    def test_final_original_and_plus_mapping_are_checked(self):
        source = {"e1": self.source()}
        self.assertEqual(provenance_errors([self.row()], source, "train"), {})
        self.assertEqual(provenance_errors([self.row(cefr="B2")], source, "train"), {"band_mapping_mismatch": 1})
        failures = provenance_errors([self.row(text="A corrected version.", label_source="auto")], source, "train")
        self.assertEqual(failures, {"text_not_original": 1, "label_source_not_human_final": 1})

    def test_nonfinal_and_missing_source_are_rejected(self):
        self.assertEqual(provenance_errors([self.row()], {}, "train"), {"id_not_in_source": 1})
        self.assertEqual(provenance_errors([self.row()], {"e1": self.source(is_final_version="FALSE")}, "train"), {"not_final": 1})

    def test_overlap_distinguishes_shared_prompt_from_leakage(self):
        left = [self.row()]
        right = [self.row(id="e2", user_id="u2", text="Another essay.")]
        self.assertEqual(overlap(left, right), {"essay_id": 0, "user": 0, "user_prompt_set": 0,
                         "prompt": 1, "exact_text": 0, "normalized_text": 0})
        self.assertEqual(overlap(left, [self.row(text=" AN original  essay. ")])["normalized_text"], 1)

    def test_budget_boundary_and_class_users(self):
        rows = [self.row(), self.row(id="e2", user_id="u2", cefr="A1", original_cefr="A1")]
        result = summarize(rows, [512, 513], 512)
        self.assertEqual((result["selected"], result["encoded"], result["over_length_skipped"]), (2, 1, 1))
        self.assertEqual(result["labels"]["B1"], 1)
        self.assertEqual(result["labels"]["A1"], 0)
        self.assertEqual(result["in_budget_by_band"]["B1"]["unique_users"], 1)
        self.assertEqual(result["over_budget_ids"], ["e2"])


if __name__ == "__main__":
    unittest.main()
