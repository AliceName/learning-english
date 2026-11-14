"""Regression checks for failures that could corrupt teacher-label ownership."""
import copy
import json
import unittest

from phone_mapping import PhoneMapping, parse_phone, restore_word_boundaries
from project_env import ROOT


class MappingSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = json.loads((ROOT / 'configs/phone_mapping.json').read_text(encoding='utf-8'))
        model = cls.document['model_id'].replace('/', '--')
        snapshot = ROOT / '.cache/huggingface/hub' / ('models--' + model) / 'snapshots' / cls.document['model_revision']
        cls.vocab = json.loads((snapshot / 'vocab.json').read_text(encoding='utf-8'))
        cls.mapping = PhoneMapping(cls.document, cls.vocab)

    def test_dataset_but_ah0_is_not_forced_to_schwa(self):
        result = self.mapping.map_word(['B', 'AH0', 'T'], [2, 1.2, 0.4], ['b', 'ʌ', 't'])
        self.assertEqual(result['status'], 'mapped')
        self.assertEqual(result['phones'][1]['stress'], 0)
        self.assertEqual([p['teacher_score'] for p in result['phones']], [2, 1.2, 0.4])
        self.assertEqual([p['target_id'] for p in result['phones']], [26, 33, 6])

    def test_text_reference_not_teacher_score_selects_variant(self):
        first = self.mapping.require_target_ids(['AH0'], [0.0], ['ɐ'])
        second = self.mapping.require_target_ids(['AH0'], [2.0], ['ɐ'])
        self.assertEqual(first, second)
        self.assertEqual(first, [20])

    def test_bear_joint_token_cannot_take_two_teacher_labels(self):
        result = self.mapping.map_word(['B', 'EH0', 'R'], [2, 1, 0.4], ['b', 'ɛɹ'])
        self.assertEqual(result['status'], 'review_required')
        self.assertTrue(result['merged_token_candidates'])
        self.assertEqual(len(result['phones']), 3)
        self.assertTrue(all(p['target_id'] is None for p in result['phones']))
        with self.assertRaisesRegex(ValueError, 'needs review'):
            self.mapping.require_target_ids(['B', 'EH0', 'R'], [2, 1, 0.4], ['b', 'ɛɹ'])

    def test_different_lexical_vowel_is_not_silently_accepted(self):
        result = self.mapping.map_word(['N', 'AH0', 'T'], [2, 2, 2], ['n', 'ɑː', 't'])
        self.assertEqual(result['status'], 'review_required')
        self.assertTrue(all(p['target_id'] is None for p in result['phones']))

    def test_uncertain_or_deletion_labels_are_not_normalized(self):
        for phone in ('R*', '<DEL>', '<unk>', 'AX', 'SIL', 'T1'):
            with self.subTest(phone=phone), self.assertRaises(ValueError):
                parse_phone(phone)

    def test_bad_teacher_labels_stop_before_mapping(self):
        for scores in ([2], [2, float('nan')], [2, 2.1], [2, True]):
            with self.subTest(scores=scores), self.assertRaises(ValueError):
                self.mapping.map_word(['W', 'IY0'], scores, ['w', 'iː'])

    def test_unchanged_vocabulary_and_non_special_targets_required(self):
        wrong_vocab = dict(self.vocab); wrong_vocab['w'] = 391
        with self.assertRaisesRegex(ValueError, 'vocabulary'):
            PhoneMapping(self.document, wrong_vocab)
        wrong_document = copy.deepcopy(self.document)
        wrong_document['phones']['W']['reference_variants'][0]['id'] = 0
        with self.assertRaisesRegex(ValueError, 'Invalid token'):
            PhoneMapping(wrong_document, self.vocab)
        for tokens in (['<unk>'], ['<pad>'], ['not-a-real-phone']):
            self.assertEqual(self.mapping.map_word(['W'], [2], tokens)['status'], 'review_required')

    def test_missing_context_does_not_claim_verified_mapping(self):
        with self.assertRaisesRegex(ValueError, 'reference_context_not_checked'):
            self.mapping.require_target_ids(['W', 'IY0'], [2, 2])

    def test_exact_joined_in_the_keeps_word_and_teacher_boundaries(self):
        restored = restore_word_boundaries([['IH0', 'N'], ['DH', 'AH0']], [['ɪ', 'n', 'ð', 'ə']])
        self.assertEqual(restored, [['ɪ', 'n'], ['ð', 'ə']])
        self.assertEqual(self.mapping.require_target_ids(['DH', 'AH0'], [0.2, 1.8], restored[1]), [22, 7])

    def test_ambiguous_or_nonmatching_word_merges_fail_closed(self):
        self.assertIsNone(restore_word_boundaries([['W'], ['W'], ['W']], [['w', 'w'], ['w', 'w']]))
        self.assertIsNone(restore_word_boundaries([['IH0'], ['DH']], [['ɪ', 's']]))


if __name__ == '__main__':
    unittest.main()
