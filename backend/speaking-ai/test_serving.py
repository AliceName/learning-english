import io
import unittest

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import create_app
from engine import MAX_BYTES, RecordingError, decode_audio, edit_ratio, reference_words
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


class ServingTests(unittest.TestCase):
    def test_silence_and_wrong_container_rejected(self):
        for data in (wav(silent=True), b'not wav' * 100):
            with self.assertRaises(RecordingError):
                decode_audio(data)

    def test_stereo_48k_is_resampled_without_truncation(self):
        audio, duration, _ = decode_audio(wav(rate=48000, stereo=True))
        self.assertEqual(len(audio), 16000)
        self.assertEqual(duration, 1)
        self.assertTrue(np.isfinite(audio).all())

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
