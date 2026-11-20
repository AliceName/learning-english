import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from relevance import (RelevanceThresholds, essay_sentences, matched_keywords, prompt_points, prompt_topic_text,
                       relevance_from_similarities)

THRESHOLDS = RelevanceThresholds(off_topic=0.20, weak=0.35, point=0.40, version="test")


class PromptParsingTests(unittest.TestCase):
    def test_bullet_prompts_give_their_points_and_drop_word_count_instructions(self):
        prompt = ("Your friend Alex has invited you to a party. Write an email to Alex. In your email: "
                  "* apologise to Alex * explain why you can't go * suggest another day when you could meet. "
                  "Write your email in about 100 words.")
        self.assertEqual(prompt_points(prompt), ["apologise to Alex", "explain why you can't go",
                                                 "suggest another day when you could meet."])
        self.assertNotIn("100 words", prompt_topic_text(prompt))

    def test_prompts_without_bullets_use_their_questions(self):
        prompt = "Hi, What do people do to celebrate birthdays in your country? Is it the same or different? Write soon!"
        self.assertEqual(prompt_points(prompt), ["What do people do to celebrate birthdays in your country?",
                                                 "Is it the same or different?"])

    def test_essay_is_split_into_sentences(self):
        self.assertEqual(essay_sentences("Hi Ken.  Thank you!\nSee you soon"), ["Hi Ken.", "Thank you!", "See you soon"])


class ScoreTests(unittest.TestCase):
    def test_clearly_unrelated_essays_score_zero_and_are_flagged(self):
        result = relevance_from_similarities(0.10, [0.9, 0.9], THRESHOLDS)
        self.assertEqual((result["score"], result["offTopic"]), (0, True))

    def test_weakly_related_essays_score_one(self):
        self.assertEqual(relevance_from_similarities(0.30, [0.9], THRESHOLDS)["score"], 1)

    def test_related_essays_score_two_to_five_by_points_covered(self):
        self.assertEqual(relevance_from_similarities(0.6, [0.1, 0.1, 0.1], THRESHOLDS)["score"], 2)
        self.assertEqual(relevance_from_similarities(0.6, [0.9, 0.1, 0.1], THRESHOLDS)["score"], 3)
        self.assertEqual(relevance_from_similarities(0.6, [0.9, 0.9, 0.1], THRESHOLDS)["score"], 4)
        self.assertEqual(relevance_from_similarities(0.6, [0.9, 0.9, 0.9], THRESHOLDS)["score"], 5)

    def test_without_points_a_related_essay_gets_at_most_four(self):
        result = relevance_from_similarities(0.6, [], THRESHOLDS)
        self.assertEqual(result["score"], 4)
        self.assertIsNone(result["pointsCovered"])


class KeywordTests(unittest.TestCase):
    def test_prompt_content_words_found_in_the_essay_are_reported_with_simple_stemming(self):
        words = matched_keywords("You went on a trip. Thank Ken for looking after your home.",
                                 "Thanks Ken! Our trips were great and my home is clean.")
        self.assertEqual(words, ["thanks", "ken", "trips", "home"])  # essay order, as written
        self.assertEqual(matched_keywords("Tell me about your class.", "My class is big."), ["class"])


class EmbeddingMathTests(unittest.TestCase):
    def test_essay_vector_is_the_normalised_mean_of_sentence_vectors(self):
        from relevance import mean_vector
        v = mean_vector(np.array([[1.0, 0.0], [0.0, 1.0]]))
        self.assertAlmostEqual(float(np.linalg.norm(v)), 1.0, places=6)
        self.assertAlmostEqual(float(v[0]), float(v[1]), places=6)


if __name__ == "__main__":
    unittest.main()
