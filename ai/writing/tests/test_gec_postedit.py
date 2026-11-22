import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gec_postedit import add_rule_fixes, keep_safe_edits
from writing_explanations import errant_available


class KeepSafeEditsTests(unittest.TestCase):
    # Sentences and model outputs come from the 50-prompt end-to-end run.
    def test_risky_edits_are_dropped_and_the_learner_text_is_kept(self):
        cases = (
            ("She is afraid of the dark.", "She is afraid of dark.", "article_deletion"),
            ("Companies can create meeting rooms and common area for discussions.",
             "Companies can create a common area for discussions.", "content_deletion"),
            ("I have many reasons for learning it.", "I have many reasons for learning.", "pronoun_deletion"),
            ("At weddings and festivals, music makes people dance.",
             "Weddings and festivals, music makes people dance.", "leading_preposition"),
            ("We travelled by plane.", "We travelled by a plane.", "transport_article"),
            ("We went up by cable car.", "We went up by a cable car.", "transport_article"),
        )
        for original, proposed, reason in cases:
            with self.subTest(reason=reason):
                self.assertEqual(keep_safe_edits(original, proposed), (original, [reason]))

    def test_one_invented_word_does_not_remove_other_good_edits(self):
        original = "It is a animation film. His father try to find him and the colours is beautiful."
        proposed = "It is an animation film. His father trys to find him and the colours are beautiful."
        self.assertEqual(keep_safe_edits(original, proposed),
                         ("It is an animation film. His father try to find him and the colours are beautiful.", ["nonword"]))

    def test_safe_suggestions_pass_through_unchanged(self):
        for original, proposed in (("In my free time I like listen to music.", "In my free time, I like listening to music."),
                                   ("We go to restaurant.", "We go to a restaurant."),
                                   ("It was written by friend.", "It was written by a friend."),
                                   ("My mother usually cook a big meal.", "My mother usually cooks a big meal.")):
            with self.subTest(original=original):
                self.assertEqual(keep_safe_edits(original, proposed), (proposed, []))

    def test_content_swaps_and_inserted_phrases_are_dropped(self):
        # Fictional sentences modelled on dev-set patterns: a content word replaced by an unrelated one,
        # and a phrase from the same sentence inserted a second time.
        cases = (
            ("The main reason is money.", "The real reason is money.", "word_substitution"),
            ("But I sometimes a little bit worried.",
             "But I sometimes a little bit worried because this website is a little bit worried.", "content_insertion"),
        )
        for original, proposed, reason in cases:
            with self.subTest(reason=reason):
                self.assertEqual(keep_safe_edits(original, proposed), (original, [reason]))

    def test_spelling_inflection_and_grammar_word_swaps_are_not_content_swaps(self):
        for original, proposed in (("She is very beautifull.", "She is very beautiful."),
                                   ("I am interesting in music.", "I am interested in music."),
                                   ("My dream job is a docter.", "My dream job is a doctor."),
                                   ("He have two book.", "He has two books."),
                                   ("I am good in English.", "I am good at English."),
                                   ("It is a important day.", "It is an important day.")):
            with self.subTest(original=original):
                self.assertEqual(keep_safe_edits(original, proposed), (proposed, []))

    @unittest.skipUnless(errant_available(), "needs ERRANT and en_core_web_sm")
    def test_irregular_tense_changes_share_a_lemma(self):
        for original, proposed in (("Last month I make a cake.", "Last month I made a cake."),
                                   ("I go to school yesterday.", "I went to school yesterday.")):
            with self.subTest(original=original):
                self.assertEqual(keep_safe_edits(original, proposed), (proposed, []))

    def test_whitespace_of_the_learner_text_is_preserved_around_kept_edits(self):
        original = "I   like the dark  and she go home."
        proposed = "I like dark and she goes home."
        self.assertEqual(keep_safe_edits(original, proposed)[0], "I   like the dark  and she goes home.")

    @unittest.skipUnless(errant_available(), "needs ERRANT and en_core_web_sm")
    def test_singular_verb_is_not_forced_on_a_plural_subject(self):
        for original, proposed in (
                ("The smell of milk flowers, which only bloom in autumn, is sweet.",
                 "The smell of milk flowers, which only blooms in autumn, is sweet."),
                ("My brother and my sister play football.", "My brother and my sister plays football."),
                ("The students often help each other.", "The students often helps each other.")):
            with self.subTest(original=original):
                self.assertEqual(keep_safe_edits(original, proposed), (original, ["plural_subject"]))
        self.assertEqual(keep_safe_edits("My father help me.", "My father helps me."), ("My father helps me.", []))


class RuleFixTests(unittest.TestCase):
    def test_over_regularised_past_forms_use_past_or_participle(self):
        self.assertEqual(add_rule_fixes("After that we drinked juice and swimmed."), "After that we drank juice and swam.")
        self.assertEqual(add_rule_fixes("We have spended a lot. I had never eated it."), "We have spent a lot. I had never eaten it.")
        self.assertEqual(add_rule_fixes("Buyed it."), "Bought it.")

    @unittest.skipUnless(errant_available(), "needs ERRANT and en_core_web_sm")
    def test_much_and_less_with_plural_nouns(self):
        self.assertEqual(add_rule_fixes("There are less schools and too much doctors."),
                         "There are fewer schools and too many doctors.")
        for unchanged in ("It costs less than ten dollars.", "I do not have much time.", "We need less sugar."):
            with self.subTest(unchanged=unchanged):
                self.assertEqual(add_rule_fixes(unchanged), unchanged)

    def test_text_without_targets_is_returned_as_is(self):
        self.assertEqual(add_rule_fixes("I seed the garden with care."), "I seed the garden with care.")


if __name__ == "__main__":
    unittest.main()
