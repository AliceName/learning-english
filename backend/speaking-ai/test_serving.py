import io
import unittest

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import create_app
from engine import MAX_BYTES, RecordingError, decode_audio, edit_ratio, reference_words


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

    def score(self, data, text):
        self.calls += 1
        decode_audio(data); reference_words(text)
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


if __name__ == '__main__':
    unittest.main()
