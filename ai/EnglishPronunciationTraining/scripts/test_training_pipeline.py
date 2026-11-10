"""Check CTC math against exhaustive paths and protect split/label ownership."""
import itertools
import unittest

import numpy as np

from gop_ctc import phoneme_features, viterbi_align
from prepare_manifests import partition_speakers
from training_common import FEATURE_NAMES


def collapse(path):
    return [x for i, x in enumerate(path) if x != 0 and (i == 0 or path[i - 1] != x)]


class CtcMathTests(unittest.TestCase):
    def test_viterbi_matches_exhaustive_ctc_paths_including_repeated_targets(self):
        rng = np.random.default_rng(42)
        for targets in ([1], [1, 2], [1, 1], [2, 1, 2]):
            logits = rng.normal(size=(5, 3))
            lp = logits - np.logaddexp.reduce(logits, axis=1)[:, None]
            candidates = [sum(lp[i, token] for i, token in enumerate(path))
                          for path in itertools.product(range(3), repeat=5) if collapse(path) == list(targets)]
            states, spans, score = viterbi_align(lp, targets)
            self.assertAlmostEqual(score, max(candidates), places=10)
            sequence = np.zeros(2 * len(targets) + 1, dtype=int); sequence[1::2] = targets
            self.assertEqual(collapse(sequence[states]), list(targets))
            self.assertEqual(len(spans), len(targets))

    def test_repeated_target_requires_a_blank_frame(self):
        with self.assertRaisesRegex(ValueError, 'Too few'):
            viterbi_align(np.log(np.full((2, 3), 1 / 3)), [1, 1])
        states, _, _ = viterbi_align(np.log(np.array([[.05, .9, .05], [.9, .05, .05], [.05, .9, .05]])), [1, 1])
        self.assertEqual(states.tolist(), [1, 2, 3])

    def test_gop_excludes_blank_frames_and_never_uses_teacher_score_as_input(self):
        probs = np.full((3, 50), .001)
        probs[0, 0] = probs[2, 0] = .9; probs[1, 32] = .9
        probs /= probs.sum(axis=1, keepdims=True); lp = np.log(probs)
        states, spans, _ = viterbi_align(lp, [32])
        phone = {'target_index': 0, 'target_id': 32, 'base_phone': 'W', 'teacher_score': 0.0}
        x, y, _ = phoneme_features(lp, states, spans, [phone], list(range(4, 43)), {0, 1, 2, 3})
        other_x, other_y, _ = phoneme_features(lp, states, spans, [{**phone, 'teacher_score': 2.0}], list(range(4, 43)), {0, 1, 2, 3})
        self.assertAlmostEqual(float(x[0, 0]), float(lp[1, 32]), places=6)
        np.testing.assert_array_equal(x, other_x)
        self.assertEqual(y[0], 0); self.assertEqual(other_y[0], 2)
        self.assertEqual(x.shape, (1, len(FEATURE_NAMES)))

    def test_invalid_ctc_inputs_stop(self):
        for lp, targets in ((np.full((3, 4), np.nan), [1]), (np.zeros((3, 4)), [0]), (np.zeros((3, 4)), [])):
            with self.assertRaises(ValueError):
                viterbi_align(lp, targets)


class SpeakerSplitTests(unittest.TestCase):
    def test_split_is_order_independent_disjoint_and_reproducible(self):
        speakers = [f'{i:04}' for i in range(125)]
        train, val = partition_speakers(speakers, .2, 42)
        other_train, other_val = partition_speakers(reversed(speakers), .2, 42)
        self.assertEqual((train, val), (other_train, other_val))
        self.assertFalse(train & val)
        self.assertEqual(len(val), 25)
        self.assertEqual(train | val, set(speakers))


class ScorerEvaluationTests(unittest.TestCase):
    def test_constant_prediction_has_undefined_correlation(self):
        from train_scorer import metrics
        result = metrics([0., 1., 2.], [1., 1., 1.])
        self.assertIsNone(result['pearson'])
        self.assertIsNone(result['spearman'])
        self.assertAlmostEqual(result['mae'], 2 / 3)

    def test_metric_shape_mismatch_cannot_broadcast(self):
        from train_scorer import metrics
        with self.assertRaises(ValueError):
            metrics([0., 1.], [[0.], [1.]])


if __name__ == '__main__':
    unittest.main()
