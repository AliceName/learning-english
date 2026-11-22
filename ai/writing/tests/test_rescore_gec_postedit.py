import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gec_postedit
from inference import IncompleteGenerationError
from rescore_gec_postedit import CachedAdapter, configure, half_of, load_groups


class RescoreTests(unittest.TestCase):
    def setUp(self):
        self.risk, self.fixes = gec_postedit._risk, gec_postedit.RULE_FIXES

    def tearDown(self):
        gec_postedit._risk, gec_postedit.RULE_FIXES = self.risk, self.fixes

    def test_cached_adapter_replays_outputs_and_incomplete(self):
        adapter = CachedAdapter({"She go home.": "She goes home.", "Long one.": None})
        self.assertEqual(adapter.correct("She go home."), "She goes home.")
        with self.assertRaises(IncompleteGenerationError):
            adapter.correct("Long one.")
        with self.assertRaises(KeyError):
            adapter.correct("Never seen.")

    def test_halves_are_stable_and_groups_follow_report_order(self):
        self.assertEqual(half_of("row-1"), half_of("row-1"))
        rows = [{"id": i, "text": f"t{i}", "corrected_text": f"t{i}" if i % 2 else f"c{i}"} for i in range(40)]
        report = {"sample_ids": [r["id"] for r in rows]}
        both = load_groups(report, rows, "all")
        self.assertEqual((len(both["requires_edit"]), len(both["already_correct"])), (20, 20))
        a, b = load_groups(report, rows, "a"), load_groups(report, rows, "b")
        self.assertEqual(sum(map(len, a.values())) + sum(map(len, b.values())), 40)
        self.assertTrue(a["requires_edit"] and b["requires_edit"])

    def test_configure_switches_rules_off(self):
        configure({"article_deletion", "irregular_past"})
        self.assertEqual(gec_postedit.RULE_FIXES, frozenset({"much_less"}))
        self.assertEqual(gec_postedit.add_rule_fixes("We drinked tea."), "We drinked tea.")
        text, dropped = gec_postedit.keep_safe_edits("I am afraid of the dark.", "I am afraid of dark.")
        self.assertEqual((text, dropped), ("I am afraid of dark.", []))
        with self.assertRaises(ValueError):
            configure({"no_such_rule"})


if __name__ == "__main__":
    unittest.main()
