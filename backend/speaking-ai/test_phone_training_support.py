import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from phone_training_support import load_phone_support, supported_matches


class TrainingSupportTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads((Path(__file__).parent / 'configs/phone-training-support.json').read_text(encoding='utf-8'))

    def load(self, document):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'support.json'
            path.write_text(json.dumps(document), encoding='utf-8')
            return load_phone_support(path, scorer_sha256=self.document['scorer_sha256'],
                mapping_sha256=self.document['mapping_sha256'], feature_signature=self.document['feature_signature'],
                base_phones=list(self.document['train_phone_counts']))

    def repin(self, document):
        payload = {key: value for key, value in document.items() if key != 'support_id'}
        document['support_id'] = 'support1-' + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]

    def test_artifact_uses_actual_train_counts_and_unseen_phone_is_not_scored(self):
        document = self.load(self.document)
        self.assertEqual(document['train_phone_counts']['ZH'], 0)
        matches = [(0, {'base_phone': 'M'}), (2, {'base_phone': 'ZH'}), (3, {'base_phone': 'ER'})]
        self.assertEqual([index for index, _ in supported_matches(matches, document['train_phone_counts'])], [0, 3])
        self.assertEqual(matches[1][1]['base_phone'], 'ZH')

    def test_tampered_or_other_checkpoint_support_is_rejected(self):
        changed = copy.deepcopy(self.document); changed['train_phone_counts']['ZH'] = 10
        with self.assertRaises(ValueError): self.load(changed)
        changed = copy.deepcopy(self.document); changed['scorer_sha256'] = '0' * 64; self.repin(changed)
        with self.assertRaises(ValueError): self.load(changed)

    def test_negative_boolean_missing_and_empty_counts_are_rejected(self):
        for value in (-1, True, 1.5):
            changed = copy.deepcopy(self.document); changed['train_phone_counts']['ZH'] = value; self.repin(changed)
            with self.assertRaises(ValueError): self.load(changed)
        changed = copy.deepcopy(self.document); changed['train_phone_counts'].pop('ZH'); self.repin(changed)
        with self.assertRaises(ValueError): self.load(changed)
        changed = copy.deepcopy(self.document); changed['train_phone_counts'] = dict.fromkeys(changed['train_phone_counts'], 0); self.repin(changed)
        with self.assertRaises(ValueError): self.load(changed)


if __name__ == '__main__': unittest.main()
