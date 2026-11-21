import io
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import create_app
from engine import (MAX_BYTES, RecordingError, decode_audio, edit_ratio, load_model_for_device,
                    mark_words_with_recording_evidence, reference_words)
from read_pronunciation import phonetic_spellings


def wav(seconds=1, rate=16000, silent=False, stereo=False):
    data = np.zeros(round(seconds * rate)) if silent else .1 * np.sin(2 * np.pi * 200 * np.arange(round(seconds * rate)) / rate)
    if stereo:
        data = np.stack((data, data), axis=1)
    stream = io.BytesIO(); sf.write(stream, data, rate, format='WAV', subtype='PCM_16')
    return stream.getvalue()


class FakeEngine:
    model_version = 'test-only'

    def __init__(self):
        self.calls = 0

    def score(self, data, text, sentence_text=None, start_word_index=0):
        self.calls += 1
        decode_audio(data); reference_words(text)
        self.context = (sentence_text, start_word_index)
        return {'status': 'scored', 'testOnly': True}


class DevicePlacementTests(unittest.TestCase):
    class CudaOutOfMemoryError(RuntimeError):
        pass

    def setUp(self):
        self.model = Mock()
        self.load_model = Mock(return_value=self.model)
        self.cuda = SimpleNamespace(is_available=Mock(return_value=True),
                                    OutOfMemoryError=self.CudaOutOfMemoryError, empty_cache=Mock())
        self.torch = SimpleNamespace(cuda=self.cuda)

    def test_auto_reloads_on_cpu_after_cuda_oom(self):
        cpu_model = Mock()
        self.load_model.side_effect = [self.model, cpu_model]
        self.model.to.side_effect = self.CudaOutOfMemoryError()
        with self.assertLogs('engine', level='WARNING'):
            self.assertEqual(load_model_for_device(self.load_model, self.torch, 'auto'), (cpu_model, 'cpu'))
        self.model.to.assert_called_once_with('cuda')
        cpu_model.to.assert_not_called()
        self.assertEqual(self.load_model.call_count, 2)
        self.cuda.empty_cache.assert_called_once_with()

    def test_cpu_override_skips_cuda_and_auto_prefers_available_cuda(self):
        self.assertEqual(load_model_for_device(self.load_model, self.torch, 'cpu'), (self.model, 'cpu'))
        self.cuda.is_available.assert_not_called()
        self.assertEqual(load_model_for_device(self.load_model, self.torch, 'auto'), (self.model, 'cuda'))
        self.cuda.is_available.return_value = False
        self.assertEqual(load_model_for_device(self.load_model, self.torch, 'auto'), (self.model, 'cpu'))
        self.model.to.assert_called_once_with('cuda')

    def test_explicit_cuda_oom_and_other_load_errors_are_reported(self):
        for preference, error in (('cuda', self.CudaOutOfMemoryError()), ('auto', RuntimeError('model load failed'))):
            with self.subTest(preference=preference):
                self.model.reset_mock()
                self.model.to.side_effect = error
                with self.assertRaises(type(error)):
                    load_model_for_device(self.load_model, self.torch, preference)
                self.model.to.assert_called_once_with('cuda')
                self.cuda.empty_cache.assert_not_called()


class ServingTests(unittest.TestCase):
    def test_silence_and_wrong_container_rejected(self):
        for data in (wav(silent=True), b'not wav' * 100):
            with self.assertRaises(RecordingError):
                decode_audio(data)

    def test_stereo_48k_is_resampled_without_truncation(self):
        audio, duration, clipped_at, has_clipping = decode_audio(wav(rate=48000, stereo=True))
        self.assertEqual(len(audio), 16000)
        self.assertEqual(duration, 1)
        self.assertTrue(np.isfinite(audio).all())
        self.assertEqual(len(clipped_at), 0)
        self.assertFalse(has_clipping)

    def test_clipping_times_use_original_sample_rate(self):
        waveform = np.full(48000, .1, dtype=np.float32)
        waveform[12000:12960] = 1
        stream = io.BytesIO()
        sf.write(stream, waveform, 48000, format='WAV', subtype='PCM_16')
        _, _, clipped_at, has_clipping = decode_audio(stream.getvalue())
        self.assertTrue(has_clipping)
        self.assertEqual(len(clipped_at), 960)
        self.assertEqual(clipped_at[0], .25)
        self.assertLess(clipped_at[-1], .27)

    def test_word_feedback_requires_unclipped_acoustic_evidence_for_every_phone(self):
        words = [
            {'reason': None, 'phones': [{'startSeconds': .2, 'endSeconds': .3}]},
            {'reason': None, 'phones': [{'startSeconds': .4, 'endSeconds': .5},
                                       {'startSeconds': .5, 'endSeconds': .6}]},
            {'reason': None, 'phones': [{'startSeconds': .6, 'endSeconds': .8}]},
            {'reason': 'partial', 'phones': [{'startSeconds': .8, 'endSeconds': .9}]},
            {'reason': None, 'phones': []},
        ]
        aligned = [{'word_index': word, 'token_id': 1, 'start_frame': frame, 'end_frame_exclusive': frame + 1}
                   for frame, word in enumerate([0, 1, 1, 2, 3])]
        log_probs = np.log([[.05, .95], [.01, .99], [.6, .4], [.1, .9], [.15, .85]])
        mark_words_with_recording_evidence(words, aligned, log_probs, np.array([.05, .7]))
        self.assertEqual([word.get('feedbackEligible', False) for word in words], [True, False, False, False, False])

    def test_long_recording_rejected_before_inference(self):
        with self.assertRaises(RecordingError):
            decode_audio(wav(seconds=12.5))

    def test_reference_constraints_and_edit_heuristic(self):
        self.assertEqual(reference_words("I'm here."), ["I'm", 'here'])
        for text in ('', 'I have 21 books', 'a ' * 36):
            with self.assertRaises(RecordingError):
                reference_words(text)
        self.assertEqual(edit_ratio(['a', 'b'], ['a', 'b']), 0)
        self.assertEqual(edit_ratio(['a'], ['z']), 1)

    def test_api_health_multipart_errors_and_body_limit(self):
        engine = FakeEngine()
        with TestClient(create_app(engine)) as client:
            self.assertEqual(client.get('/health').json()['modelVersion'], 'test-only')
            response = client.post('/score', data={'text': 'We call it bear'}, files={'file': ('x.wav', wav(), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            response = client.post('/score', data={'text': 'We call it bear'}, files={'file': ('x.wav', wav(silent=True), 'audio/wav')})
            self.assertEqual(response.status_code, 422)
            before = engine.calls
            response = client.post('/score', data={'text': 'We'}, files={'file': ('x.wav', b'x' * (MAX_BYTES + 1), 'audio/wav')})
            self.assertIn(response.status_code, (400, 413))
            self.assertEqual(engine.calls, before)

    def test_protected_score_requires_token_before_parsing_audio(self):
        engine = FakeEngine()
        with TestClient(create_app(engine, api_token='test-token')) as client:
            self.assertEqual(client.get('/health').status_code, 200)
            self.assertEqual(client.post('/score').status_code, 401)
            wrong_token = {'Authorization': 'Bearer wrong-token'}
            self.assertEqual(client.post('/score', headers=wrong_token).status_code, 401)
            self.assertEqual(engine.calls, 0)
            response = client.post('/score', headers={'Authorization': 'Bearer test-token'},
                                   data={'text': 'We call it bear'}, files={'file': ('x.wav', wav(), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(engine.calls, 1)

    def test_read_uses_tense_cues_without_changing_the_written_word(self):
        cases = [
            ('I read a book yesterday.', 'red'),
            ('Yesterday, I read a book.', 'red'),
            ('I read a book last week.', 'red'),
            ('I have already read it.', 'red'),
            ('I’ve read it.', 'red'),
            ('I did read a book yesterday.', 'reed'),
            ('What did you read yesterday?', 'reed'),
            ('Have you already read it?', 'red'),
            ('Will you have read it by then?', 'red'),
            ('I read every day.', 'read'),
            ('I read every day, but she left yesterday.', 'read'),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                words = reference_words(text)
                index = words.index('read')
                self.assertEqual(phonetic_spellings(words, text)[index], expected)
                self.assertEqual(words[index], 'read')

    def test_phrase_uses_original_sentence_cue_and_matching_word_offset(self):
        sentence = 'Yesterday, I read a book.'
        words = reference_words('read a book')
        self.assertEqual(phonetic_spellings(words, sentence, 2), ['red', 'a', 'book'])
        with self.assertRaises(ValueError):
            phonetic_spellings(words, sentence, 0)

        engine = FakeEngine()
        with TestClient(create_app(engine)) as client:
            response = client.post('/score', data={'text': 'read a book', 'sentenceText': sentence, 'startWordIndex': '2'},
                                   files={'file': ('x.wav', wav(), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(engine.context, (sentence, 2))


if __name__ == '__main__':
    unittest.main()
