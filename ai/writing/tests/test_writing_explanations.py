import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import writing_explanations as wx

ERRANT_AVAILABLE = all(importlib.util.find_spec(m) for m in ("errant", "spacy"))


class WhitelistTests(unittest.TestCase):
    def test_existing_precise_rules_keep_version_one(self):
        [item] = wx.explain_accepted_change("He can goes home.", "He can go home.")
        self.assertEqual((item["category"], item["templateVersion"]), ("VERB:FORM", "vi-edit-templates-v1"))

    def test_without_errant_unknown_changes_stay_other(self):
        with patch.object(wx, "_errant", return_value=None):
            [item] = wx.explain_accepted_change("My grandmother are ill.", "My grandmother is ill.")
        self.assertEqual((item["category"], item["templateVersion"]), ("OTHER", "vi-edit-templates-v1"))


@unittest.skipUnless(ERRANT_AVAILABLE, "errant and spaCy are needed for v2 categories")
class ErrantCategoryTests(unittest.TestCase):
    def categories(self, original, suggestion):
        return [(i["category"], i["templateVersion"]) for i in wx.explain_accepted_change(original, suggestion)]

    def test_common_learner_errors_get_a_rule_category(self):
        v2 = "vi-edit-templates-v2"
        self.assertEqual(self.categories("My grandmother are ill.", "My grandmother is ill."), [("VERB:SVA", v2)])
        self.assertEqual(self.categories("Thank you for invite me.", "Thank you for inviting me."), [("VERB:FORM", v2)])
        self.assertEqual(self.categories("Yesterday I go to school.", "Yesterday I went to school."), [("VERB:TENSE", v2)])
        self.assertEqual(self.categories("I arrived at Monday.", "I arrived on Monday."), [("PREP", v2)])
        self.assertEqual(self.categories("hi Ken.", "Hi Ken."), [("ORTH", v2)])

    def test_messages_explain_the_kind_of_change_without_giving_the_answer(self):
        for original, suggestion, answer in (("My grandmother are ill.", "My grandmother is ill.", " is "),
                                             ("I arrived at Monday.", "I arrived on Monday.", " on ")):
            [item] = wx.explain_accepted_change(original, suggestion)
            self.assertNotIn(answer, f" {item['message']} ")
            self.assertTrue(item["message"])

    def test_missing_and_unnecessary_words_are_described_as_such(self):
        [missing] = wx.explain_accepted_change("I listen music every day.", "I listen to music every day.")
        self.assertEqual(missing["category"], "PREP")
        self.assertIn("thiếu", missing["message"])
        [extra] = wx.explain_accepted_change("We discussed about it.", "We discussed it.")
        self.assertEqual(extra["category"], "PREP")
        self.assertIn("thừa", extra["message"])

    def test_word_choice_needs_genuinely_different_words(self):
        self.assertEqual(self.categories("It was a big house.", "It was a large house."), [("ADJ", "vi-edit-templates-v2")])
        # Near-identical or broken suggestions are not presented as a better word choice.
        self.assertEqual(self.categories("He learn fast.", "He learnies fast."), [("OTHER", "vi-edit-templates-v1")])
        self.assertEqual(self.categories("They were funny.", "They were fun."), [("OTHER", "vi-edit-templates-v1")])

    def test_fragments_still_match_the_token_changes_used_by_the_frontend(self):
        [item] = wx.explain_accepted_change("Thank you for invite me.", "Thank you for inviting me.")
        self.assertEqual((item["original"], item["suggestion"]), ("invite", "inviting"))


if __name__ == "__main__":
    unittest.main()
