import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gec_safety import correction_rejection_reason


class CorrectionSafetyTests(unittest.TestCase):
    def test_dropped_middle_and_initial_segments_are_blocked(self):
        for source, proposed in (
            ("We tested it yesterday, the battery lost half its charge, and we filed a report.",
             "We tested it yesterday, and we filed a report."),
            ("The first train left before dawn, the second train was full and we waited outside.",
             "The second train was full and we waited outside."),
        ):
            with self.subTest(source=source):
                self.assertEqual(correction_rejection_reason(source, proposed), "segment_deletion")

    def test_grammar_changes_across_clause_boundaries_are_allowed(self):
        self.assertIsNone(correction_rejection_reason(
            "She go to school, and she study English there every day.",
            "She goes to school, and she studies English there every day."))

    def test_valid_grammar_and_contractions_are_not_blocked(self):
        for original, proposed in (
            ("She go to school.", "She goes to school."),
            ("I usually watching English videos.", "I usually watch English videos."),
            ("I can not study here.", "I cannot study here."),
            ("I do not swim.", "I don't swim."),
            ("I don't know nothing.", "I don't know anything."),
            ("Learning English are helpful.", "To learn English is helpful."),
            ("I met Alice in Paris at 12:30.", "I met Alice in Paris at 12:30."),
            ("I likes books.\nThey is interesting.", "I like books.\nThey are interesting."),
        ):
            with self.subTest(original=original):
                self.assertIsNone(correction_rejection_reason(original, proposed))

    def test_original_intentional_repetition_is_not_blocked(self):
        for text in (
            "I waited and waited and waited.",
            "It was very very very cold.",
            "I have a book, I have a bag, and I have a pen.",
            "A line.\n\nAnother line.",
        ):
            with self.subTest(text=text):
                self.assertIsNone(correction_rejection_reason(text, text))

    def test_new_repetition_and_large_expansion_are_blocked(self):
        cases = (
            ("I have a book.", "I have a book I have a book I have a book."),
            ("It is very cold.", "It is very very very cold."),
            ("I need a new room.", "I need a new room because I need a new room because I need a new room because I need a new room."),
        )
        for original, proposed in cases:
            with self.subTest(original=original):
                self.assertIn(correction_rejection_reason(original, proposed), {"repetition", "expansion"})

    def test_numbers_negation_and_internal_capitalised_anchors_are_protected(self):
        cases = (
            ("I bought 12 books.", "I bought 13 books.", "numbers"),
            ("I bought books.", "I bought 12 books.", "numbers"),
            ("I do not like this room.", "I like this room.", "negation"),
            ("I like this room.", "I don't like this room.", "negation"),
            ("I met Catherine yesterday.", "I met someone yesterday.", "anchors"),
            ("I went to Paris.", "I went to London.", "anchors"),
        )
        for original, proposed, reason in cases:
            with self.subTest(original=original):
                self.assertEqual(correction_rejection_reason(original, proposed), reason)

    def test_empty_layout_changes_and_large_deletion_are_blocked(self):
        self.assertEqual(correction_rejection_reason("I like books.", " "), "empty")
        self.assertEqual(correction_rejection_reason("I like books.", "I like\nbooks."), "layout")
        self.assertEqual(correction_rejection_reason("I like\nbooks.", "I like books."), "layout")
        self.assertEqual(correction_rejection_reason(
            "I like reading books in the library after school with my friends.", "I like books."), "deletion")


if __name__ == "__main__":
    unittest.main()
