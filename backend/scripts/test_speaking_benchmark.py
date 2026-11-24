"""Synthetic fixtures verify tools, not Vietnamese pronunciation accuracy."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import wave

from speaking_benchmark import (cases, consensus, evaluate, fit_gate, gate_metrics, predictions,
    prepare, read_csv, score, sha, validate_wav, WORD, write_csv, write_jsonl, GATE_FIELDS, LABEL_FIELDS)
from evaluate_speaking_human import DEFAULT_CALIBRATION, load_calibration


def wav():
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
        output.writeframes(b'\0\1' * 8000)
    return stream.getvalue()


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name) / 'collection'
        self.rows = prepare(self.workspace, 10)
        self.calibration = load_calibration(DEFAULT_CALIBRATION)

    def annotate(self, ids, correct=True):
        for rid in ids:
            (self.workspace / 'audio' / (rid + '.wav')).write_bytes(wav())
        for reviewer in ('1', '2'):
            gate = read_csv(self.workspace / f'content-rater-{reviewer}.csv')
            words = read_csv(self.workspace / f'words-rater-{reviewer}.csv')
            for row in gate:
                if row['recordingId'] in ids:
                    row.update(readMatch='yes' if correct else 'no', usableAudio='yes', audioSha256=sha(wav()))
            for row in words:
                if row['recordingId'] in ids: row.update(score='2', audioSha256=sha(wav()))
            write_csv(self.workspace / f'content-rater-{reviewer}.csv', gate, GATE_FIELDS)
            write_csv(self.workspace / f'words-rater-{reviewer}.csv', words, LABEL_FIELDS)

    def result(self, rid, ratio=.2):
        case = next(row for row in self.rows if row['recordingId'] == rid)
        return {'recordingId': rid, 'referenceText': case['referenceText'], 'audioSha256': sha(wav()),
            'modelVersion': 'synthetic-fixture-only', 'status': 'scored',
            'trace': {'phonemeEditRatio': ratio, 'hasClipping': False, 'decodedTokenCount': 5},
            'assessment': {'interpretation': {'feedbackMode': 'normal', 'calibrationVersion': self.calibration['calibration_id']},
                'words': [{'index': index, 'text': text, 'status': 'scored', 'score': 1.8, 'reason': None}
                          for index, text in enumerate(WORD.findall(case['referenceText']))]}}

    def test_planned_tasks_are_blank_and_speaker_disjoint(self):
        self.assertEqual(len(self.rows), 150)
        self.assertTrue(all(not row['score'] for row in read_csv(self.workspace / 'words-rater-1.csv')))
        self.assertFalse(list((self.workspace / 'audio').iterdir()))
        speakers = {split: {row['speakerId'] for row in self.rows if row['split'] == split} for split in ('train', 'calibration', 'test')}
        self.assertFalse(speakers['train'] & speakers['test'])
        with self.assertRaises(FileExistsError): prepare(self.workspace)

    def test_no_audio_or_labels_is_insufficient_data_without_model_loading(self):
        output = self.workspace / 'results.jsonl'
        result = score(self.workspace, output, Path('/missing-model'))
        self.assertEqual(result['status'], 'insufficient_data')
        report = evaluate(self.workspace, output, self.workspace / 'evaluation.json')
        self.assertEqual(report['status'], 'insufficient_data')
        self.assertEqual(report['human_review']['pending_recordings'], 150)

    def test_wav_validation_rejects_invalid_container_and_truncated_frames(self):
        validate_wav(wav())
        for data in (b'not wav' * 100, wav()[:100], wav()[:-2]):
            with self.assertRaises(ValueError): validate_wav(data)

    def test_two_raters_are_required_and_disagreements_are_kept_out(self):
        rid = 'vi009_p01'; self.annotate([rid])
        gate, words, pending = consensus(self.workspace)
        self.assertEqual(len(gate), 1); self.assertTrue(words)
        rows = read_csv(self.workspace / 'content-rater-2.csv')
        next(row for row in rows if row['recordingId'] == rid)['readMatch'] = 'no'
        write_csv(self.workspace / 'content-rater-2.csv', rows, GATE_FIELDS)
        gate, words, pending = consensus(self.workspace)
        self.assertFalse(gate); self.assertFalse(words)
        self.assertEqual(pending['disagreements_requiring_review'], 1)

    def test_labels_and_predictions_are_pinned_to_the_same_audio(self):
        rid = 'vi009_p01'; self.annotate([rid])
        output = self.workspace / 'results.jsonl'; write_jsonl(output, [self.result(rid)])
        (self.workspace / 'audio' / (rid + '.wav')).write_bytes(wav() + b'changed')
        with self.assertRaises(ValueError): consensus(self.workspace)
        with self.assertRaises(ValueError): predictions(self.workspace, output)

    def test_word_exports_and_test_only_metrics_are_not_sentence_percentages(self):
        self.annotate(['vi009_p01', 'vi007_p01'])
        output = self.workspace / 'results.jsonl'
        write_jsonl(output, [self.result('vi009_p01'), self.result('vi007_p01')])
        report = evaluate(self.workspace, output, self.workspace / 'evaluation.json')
        metrics = report['models']['synthetic-fixture-only']['vietnamese_test']['word']
        self.assertAlmostEqual(metrics['mae'], .2)
        self.assertIsNone(metrics['practice_decisions'])
        self.assertEqual(metrics['recordings'], 1)
        self.assertEqual(report['models']['synthetic-fixture-only']['vietnamese_test']['phoneme']['status'], 'insufficient_data')

    def test_content_metrics_keep_clipping_and_missing_evidence_out_of_gate_fit(self):
        rows = [{'recordingId': 'a', 'usableAudio': True, 'readMatch': True},
                {'recordingId': 'b', 'usableAudio': True, 'readMatch': False}]
        results = {rid: {'trace': {'phonemeEditRatio': ratio, 'decodedTokenCount': 5, 'hasClipping': False}}
                   for rid, ratio in [('a', .8), ('b', .2)]}
        report = gate_metrics(rows, results)
        self.assertEqual(report['false_rejections'], 1); self.assertEqual(report['false_acceptances'], 1)
        results['a']['trace']['hasClipping'] = True
        self.assertEqual(gate_metrics(rows, results)['measured_recordings'], 1)

    def test_gate_candidate_uses_only_calibration_speakers_and_never_deploys(self):
        self.annotate(['vi007_p01', 'vi008_p01', 'vi009_p01', 'vi010_p01'])
        self.annotate(['vi007_p14', 'vi008_p14', 'vi009_p14', 'vi010_p14'], correct=False)
        results = [self.result(f'vi{speaker:03d}_p{prompt:02d}', .8 if prompt == 1 else .9)
                   for speaker in (7, 8, 9, 10) for prompt in (1, 14)]
        output = self.workspace / 'results.jsonl'; write_jsonl(output, results)
        candidate = self.workspace / 'gate.json'
        fit = fit_gate(self.workspace, output, candidate)
        self.assertEqual(fit['status'], 'candidate_only'); self.assertFalse(fit['production_modified'])
        self.assertEqual(fit['fit_speakers'], ['vi007', 'vi008'])
        self.assertEqual(fit['reject_threshold'], .8)
        mutated = copy.deepcopy(results)
        for row in mutated:
            if row['recordingId'].startswith(('vi009', 'vi010')): row['trace']['phonemeEditRatio'] = 0
        write_jsonl(output, mutated)
        after = fit_gate(self.workspace, output, self.workspace / 'gate-after.json')
        self.assertEqual(after['reject_threshold'], fit['reject_threshold'])
        report = evaluate(self.workspace, output, self.workspace / 'evaluation.json', candidate)
        self.assertEqual(report['content_gate']['candidate_test']['wrong_sentence_recordings'], 2)

    def test_manifest_and_label_ownership_or_nan_scores_cannot_silently_change(self):
        self.annotate(['vi009_p01'])
        path = self.workspace / 'words-rater-1.csv'; rows = read_csv(path)
        next(row for row in rows if row['recordingId'] == 'vi009_p01')['score'] = 'nan'
        write_csv(path, rows, LABEL_FIELDS)
        with self.assertRaises(ValueError): consensus(self.workspace)
        altered = copy.deepcopy(self.rows); altered[0]['speakerId'] = 'vi009'
        write_jsonl(self.workspace / 'manifest.jsonl', altered)
        with self.assertRaises(ValueError): cases(self.workspace)


if __name__ == '__main__': unittest.main()
