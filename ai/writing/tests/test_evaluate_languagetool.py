import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_languagetool import apply_matches


def match(offset, length, value, category="GRAMMAR", issue="grammar"):
    return {"offset": offset, "length": length, "replacements": [{"value": value}, {"value": "other"}],
            "rule": {"id": "R", "issueType": issue, "category": {"id": category}}}


class ApplyMatchesTests(unittest.TestCase):
    def test_applies_first_replacement_right_to_left(self):
        text = "She go to scool."
        corrected, counts = apply_matches(text, [match(10, 5, "school", "TYPOS", "misspelling"), match(4, 2, "goes")])
        self.assertEqual(corrected, "She goes to school.")
        self.assertEqual(counts["applied"], 2)

    def test_skips_excluded_rules_overlaps_and_empty_suggestions(self):
        text = "He have a  dog."
        matches = [match(3, 4, "has"), match(3, 6, "has a"), match(9, 2, " ", "TYPOGRAPHY", "whitespace"),
                   match(0, 2, "They", "STYLE", "style"), {**match(12, 3, "x"), "replacements": []}]
        corrected, counts = apply_matches(text, matches)
        self.assertEqual(corrected, "He has a  dog.")
        self.assertEqual(dict(counts), {"applied": 1, "overlap": 1, "excluded_rule": 2, "no_replacement": 1})

    def test_only_categories_keeps_spelling_and_drops_the_rest(self):
        text = "He have a scool"
        matches = [match(3, 4, "has"), match(10, 5, "school", "TYPOS", "misspelling"),
                   match(15, 0, ".", "PUNCTUATION", "typographical")]
        corrected, counts = apply_matches(text, matches, only_categories={"TYPOS"})
        self.assertEqual(corrected, "He have a school")
        self.assertEqual(dict(counts), {"applied": 1, "not_selected": 2})

    def test_uses_utf16_offsets(self):
        text = "😀 I has a cat."  # the emoji is two UTF-16 code units
        corrected, _ = apply_matches(text, [match(5, 3, "have")])
        self.assertEqual(corrected, "😀 I have a cat.")

    def test_rejects_offsets_past_the_end(self):
        with self.assertRaises(ValueError):
            apply_matches("short", [match(3, 10, "x")])


if __name__ == "__main__":
    unittest.main()
