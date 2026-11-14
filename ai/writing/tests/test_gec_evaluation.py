import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gec_evaluation import m2_block
from audit_gec import choose_sample, score_files


class FixedAuditSampleTests(unittest.TestCase):
    def test_fixed_file_preserves_order_and_rejects_changed_holdout_or_repeated_examples(self):
        import json
        valid = [dict(id='one', text='A sentence.'), dict(id='two', text='Another sentence.')]
        self.assertEqual(choose_sample(valid, len(valid), 42), valid)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.jsonl'
            def write(rows):
                path.write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
            write(list(reversed(valid)))
            self.assertEqual(choose_sample(valid, 1, 42, path), list(reversed(valid)))
            for invalid in ([valid[0], valid[0]], [dict(valid[0], text='Changed.')], [dict(id='train', text='Other.')]):
                write(invalid)
                with self.assertRaisesRegex(ValueError, 'unique, unchanged, eligible'):
                    choose_sample(valid, 1, 42, path)


@unittest.skipUnless(importlib.util.find_spec('errant') and importlib.util.find_spec('en_core_web_sm'), 'Needs ERRANT model')
class RawEnglishScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import errant
        cls.annotator = errant.load('en')

    def test_raw_punctuation_and_verb_agreement_have_correct_word_offsets(self):
        block = m2_block(self.annotator, 'She go to school.', 'She goes to school.')
        self.assertTrue(block.startswith('S She go to school .\n'))
        self.assertIn('A 1 2|||R:VERB:SVA|||goes|||', block)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['hyp.m2', 'ref.m2']:
                (root / name).write_text(block, encoding='utf-8')
            scores = score_files(root / 'hyp.m2', root / 'ref.m2', root / 'errant.txt')
            self.assertEqual(scores['overall']['tp'], 1)
            self.assertEqual(scores['overall']['fp'], 0)
            self.assertEqual(scores['overall']['fn'], 0)
            self.assertEqual(scores['categories']['R:VERB:SVA']['f05'], 1)

    def test_contractions_are_tokenised_and_formatting_alone_is_not_an_edit(self):
        block = m2_block(self.annotator, "I  don't swim.", "I don't swim.")
        self.assertTrue(block.startswith("S I do n't swim .\n"))
        self.assertIn('noop', block)


if __name__ == '__main__':
    unittest.main()
