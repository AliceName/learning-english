import hashlib
import json
from pathlib import Path
import unittest
import numpy as np

from score_interpretation import ScoreCalibration, build_feedback


class ScoreInterpretationTests(unittest.TestCase):
    def document(self, **changes):
        doc = json.loads(Path(__file__).with_name('configs').joinpath('scoring-calibration.json').read_text(encoding='utf-8'))
        doc.pop('calibration_id'); doc.update(changes)
        doc['calibration_id'] = 'cal1-' + hashlib.sha256(json.dumps(doc, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        return doc

    def test_selected_identity_keeps_original_points(self):
        calibration = ScoreCalibration(self.document())
        self.assertEqual(calibration.spec['kind'], 'identity')
        np.testing.assert_array_equal(calibration.apply([.1, 1.1, 1.5, 2]), [.1, 1.1, 1.5, 2])
        self.assertEqual(calibration.threshold, 1.1)

    def test_calibrators_are_bounded_and_monotone(self):
        for spec in ({'kind': 'affine', 'slope': 1.5, 'intercept': -.2}, {'kind': 'isotonic', 'x': [0, 1, 2], 'y': [0, .8, 2]}):
            result = ScoreCalibration(self.document(transform=spec)).apply(np.linspace(0, 2, 100))
            self.assertTrue(np.all(np.diff(result) >= 0)); self.assertTrue(np.all((0 <= result) & (result <= 2)))

    def test_corrupt_or_non_monotone_calibration_is_rejected(self):
        bad = self.document(); bad['practice_threshold'] = .9
        with self.assertRaises(ValueError): ScoreCalibration(bad)
        for spec in ({'kind': 'affine', 'slope': -1, 'intercept': 2}, {'kind': 'isotonic', 'x': [0, 1, 2], 'y': [0, 2, 1]}):
            with self.assertRaises(ValueError): ScoreCalibration(self.document(transform=spec))
        with self.assertRaises(ValueError): ScoreCalibration(self.document()).apply([float('nan')])

    def test_recording_and_coverage_modes_are_distinct(self):
        calibration = ScoreCalibration(self.document())
        self.assertEqual(calibration.interpretation(.79, False)['feedbackMode'], 'limited_coverage')
        self.assertEqual(calibration.interpretation(.8, False)['feedbackMode'], 'normal')
        self.assertEqual(calibration.interpretation(1, True)['feedbackMode'], 'record_again')
        self.assertEqual(calibration.interpretation(.2, True)['feedbackMode'], 'record_again')

    def test_unscored_words_are_not_called_errors_and_borderline_is_tentative(self):
        calibration = ScoreCalibration(self.document())
        words = [{'text': 'unknown', 'phones': []}, {'text': 'playing', 'phones': [{'score': 1.3}]}]
        message = build_feedback(words, .9, calibration.interpretation(.9, False))
        self.assertIn('nghe lại', message); self.assertNotIn('Ưu tiên', message)
        words[1]['phones'][0]['score'] = .9
        self.assertIn('playing', build_feedback(words, .9, calibration.interpretation(.9, False)))
        rerecord = build_feedback(words, 1, calibration.interpretation(1, True))
        self.assertIn('ghi âm lại', rerecord); self.assertNotIn('playing', rerecord)
        self.assertIn('chưa đủ', build_feedback(words, .5, calibration.interpretation(.5, False)))


if __name__ == '__main__': unittest.main()
