"""Regression tests for exact reference ownership; no audio predictions or scores."""
import json
import os
from pathlib import Path
import sys
import unittest

from reference_mapping import map_word_consensus, restore_boundaries


class ReferenceMappingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        default = Path(__file__).resolve().parents[2].parent / 'EnglishPronunciationTraining' / 'EnglishPronunciationTraining'
        root = Path(os.environ.get('SPEAKING_TRAINING_ROOT', default))
        sys.path.insert(0, str(root / 'scripts'))
        from phone_mapping import PhoneMapping
        doc = json.loads((root / 'configs/phone_mapping.json').read_text(encoding='utf-8'))
        snapshot = root / '.cache/huggingface/hub' / ('models--' + doc['model_id'].replace('/', '--')) / 'snapshots' / doc['model_revision']
        cls.mapping = PhoneMapping(doc, json.loads((snapshot / 'vocab.json').read_text(encoding='utf-8')))

    def test_bear_keeps_b_but_never_splits_rhotic_token(self):
        mapped = map_word_consensus([['B', 'EH1', 'R']], ['b', 'ɛɹ'], self.mapping)
        self.assertEqual([(i, p['base_phone']) for i, p in mapped], [(0, 'B')])
        self.assertEqual(mapped[0][1]['target_id'], self.mapping.vocab['b'])

    def test_token_position_after_a_merge_does_not_use_source_phone_index(self):
        mapped = map_word_consensus([['P', 'AA1', 'R', 'K']], ['p', 'ɑːɹ', 'k'], self.mapping)
        self.assertEqual([(i, p['source_index'], p['base_phone']) for i, p in mapped], [(0, 0, 'P'), (2, 3, 'K')])

    def test_syllabic_consonant_is_masked_without_losing_other_tokens(self):
        mapped = map_word_consensus([['P', 'IY1', 'P', 'AH0', 'L']], ['p', 'iː', 'p', 'əl'], self.mapping)
        self.assertEqual([i for i, _ in mapped], [0, 1, 2])

    def test_different_vowel_missing_phone_or_unknown_label_is_not_invented(self):
        for phones, reference in ((['N', 'AH0', 'T'], ['n', 'ɑː', 't']), (['HH', 'AE1', 'V'], ['ɐ', 'v']), (['R*'], ['ɹ'])):
            self.assertEqual(map_word_consensus([phones], reference, self.mapping), [])

    def test_d_and_t_flap_ambiguity_is_not_arbitrarily_resolved(self):
        self.assertEqual(map_word_consensus([['D'], ['T']], ['ɾ'], self.mapping), [])

    def test_alternative_pronunciations_are_checked(self):
        result = map_word_consensus([['W', 'AA1', 'Z'], ['W', 'AH0', 'Z']], ['w', 'ʌ', 'z'], self.mapping)
        self.assertEqual([p['base_phone'] for _, p in result], ['W', 'AH', 'Z'])

    def test_boundary_uses_all_variants_and_keeps_the_original_tokens(self):
        chunks = [['w', 'ʌ', 'z', 'ɐ']]
        actual = restore_boundaries([[['W', 'AA1', 'Z'], ['W', 'AH0', 'Z']], [['AH0'], ['EY1']]], chunks,
                                    [['w', 'ʌ', 'z'], ['eɪ']], self.mapping)
        self.assertEqual(actual, [['w', 'ʌ', 'z'], ['ɐ']])
        self.assertEqual(sum(actual, []), sum(chunks, []))

    def test_out_of_dictionary_boundary_evidence_never_creates_scored_phones(self):
        chunks = [['b', 'ɑː', 'w', 'iː']]
        actual = restore_boundaries([[], [['W', 'IY1']]], chunks, [['b', 'ɑː'], ['w', 'iː']], self.mapping)
        self.assertEqual(actual, [['b', 'ɑː'], ['w', 'iː']])
        self.assertEqual(map_word_consensus([], actual[0], self.mapping), [])

    def test_merged_word_with_rhotics_can_recover_boundaries_without_scoring_merge(self):
        result = restore_boundaries([[['DH', 'EH1', 'R']], [['W', 'ER1']]], [['ð', 'ɛɹ', 'w', 'ɜː']],
                                    [['ð', 'ɛɹ'], ['w', 'ɜː']], self.mapping)
        self.assertEqual(result, [['ð', 'ɛɹ'], ['w', 'ɜː']])

    def test_ambiguous_or_unexplained_word_merges_remain_rejected(self):
        words = [[['W']], [['W']], [['W']]]
        self.assertIsNone(restore_boundaries(words, [['w', 'w'], ['w', 'w']], [['w']] * 3, self.mapping))
        self.assertIsNone(restore_boundaries([[['IH0']], [['DH']]], [['ɪ', 's']], [['ɪ'], ['ð']], self.mapping))


if __name__ == '__main__':
    unittest.main()
