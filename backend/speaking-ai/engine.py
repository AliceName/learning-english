"""Audio + reference text inference using the frozen, already-trained baseline.

No dataset labels or dataset lookup are used at inference. CMUdict supplies
candidate canonical phones; only unambiguous text-G2P matches receive scores.
"""
import io
import math
import os
from pathlib import Path
import re
import sys
import threading

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from read_pronunciation import WORD_PATTERN, phonetic_spellings

MAX_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 12


class RecordingError(ValueError):
    pass


class EngineBusyError(RuntimeError):
    pass


def decode_audio(data):
    if not 44 <= len(data) <= MAX_BYTES or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise RecordingError('Vui lòng dùng tệp WAV, tối đa 2 MB.')
    try:
        with sf.SoundFile(io.BytesIO(data)) as source:
            if source.format != 'WAV' or not 8000 <= source.samplerate <= 96000 or source.channels not in (1, 2):
                raise RecordingError('WAV cần có 1–2 kênh và tần số lấy mẫu 8–96 kHz.')
            duration = len(source) / source.samplerate
            if not .3 <= duration <= MAX_SECONDS + .02:
                raise RecordingError('Bản ghi cần dài từ 0,3 đến 12 giây. Hãy ghi lại câu ngắn hơn.')
            audio = source.read(dtype='float32', always_2d=True).mean(axis=1)
            sample_rate = source.samplerate
    except (sf.LibsndfileError, RuntimeError) as exc:
        raise RecordingError('Không đọc được nội dung WAV. Hãy ghi âm lại.') from exc
    if not np.isfinite(audio).all():
        raise RecordingError('Bản ghi chứa giá trị âm thanh không hợp lệ.')
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    if rms < 1e-4 or float(np.std(audio)) < 1e-5:
        raise RecordingError('Bản ghi im lặng hoặc quá nhỏ. Hãy kiểm tra microphone và ghi lại.')
    warnings = []
    if float(np.mean(np.abs(audio) >= .999)) > .01:
        warnings.append('Âm thanh có dấu hiệu quá lớn; nên đặt microphone xa hơn.')
    if sample_rate != 16000:
        divisor = math.gcd(sample_rate, 16000)
        audio = resample_poly(audio, 16000 // divisor, sample_rate // divisor).astype(np.float32)
    return audio, duration, warnings


def reference_words(text):
    if not text or len(text) > 300 or re.search(r"[^A-Za-z\s'’.,!?;:\-\"()]", text):
        raise RecordingError('Câu mẫu cần là tiếng Anh, tối đa 300 ký tự; hãy viết số thành chữ.')
    words = WORD_PATTERN.findall(text)
    if not 1 <= len(words) <= 35:
        raise RecordingError('Hãy chọn câu mẫu từ 1 đến 35 từ.')
    return [w.replace('’', "'") for w in words]


def edit_ratio(expected, decoded):
    previous = list(range(len(decoded) + 1))
    for i, x in enumerate(expected, 1):
        current = [i]
        for j, y in enumerate(decoded, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1] / max(1, len(expected), len(decoded))


class SpeakingEngine:
    def __init__(self, training_root=None):
        default = Path(__file__).resolve().parents[2].parent / 'EnglishPronunciationTraining' / 'EnglishPronunciationTraining'
        self.root = Path(training_root or os.environ.get('SPEAKING_TRAINING_ROOT', default)).resolve()
        scripts = self.root / 'scripts'
        if not (scripts / 'gop_ctc.py').is_file():
            raise RuntimeError('Set SPEAKING_TRAINING_ROOT to the prepared training project.')
        sys.path.insert(0, str(scripts))
        from project_env import configure_environment
        configure_environment()
        import cmudict
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        from phone_mapping import PhoneMapping
        from training_common import config, snapshot_path, FEATURE_NAMES, BASE_PHONES, file_digest
        from score_interpretation import ScoreCalibration
        self.torch = torch
        cfg = config(); snapshot = snapshot_path(cfg)
        self.processor = Wav2Vec2Processor.from_pretrained(str(snapshot), local_files_only=True)
        self.mapping = PhoneMapping.load(self.root / cfg['features']['phone_mapping'], self.processor.tokenizer.get_vocab())
        self.package = torch.load(self.root / 'checkpoints/pronunciation_scorer.pt', map_location='cpu', weights_only=True)
        if self.package['feature_names'] != FEATURE_NAMES or self.package['mapping_sha256'] != file_digest(self.root / cfg['features']['phone_mapping']):
            raise RuntimeError('Scorer feature schema/mapping mismatch; use the matching training artifacts.')
        for field in ('id', 'revision'):
            if self.package['acoustic_model'][field] != cfg['acoustic_model'][field]:
                raise RuntimeError('Scorer and acoustic checkpoint differ')
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(2)
        self.model = Wav2Vec2ForCTC.from_pretrained(str(snapshot), local_files_only=True,
            dtype=torch.float32, low_cpu_mem_usage=True, use_safetensors=False,
            attn_implementation='eager').to(self.device)
        self.model.eval(); self.model.requires_grad_(False)
        self.lexicon = cmudict.dict()
        self.base_phones = BASE_PHONES
        self.canonical = [self.mapping.phones[p]['canonical_id'] for p in BASE_PHONES]
        self.special = set(self.mapping.document['special_tokens'].values())
        self.model_version = ('gop-ctc-mlp-' + file_digest(self.root / 'checkpoints/pronunciation_scorer.pt')[:16]
                              + '-ref2-' + file_digest(Path(__file__).with_name('reference_mapping.py'))[:12])
        self.calibration = ScoreCalibration.load(Path(__file__).parent / 'configs/scoring-calibration.json',
            scorer_sha256=file_digest(self.root / 'checkpoints/pronunciation_scorer.pt'),
            mapping_sha256=self.package['mapping_sha256'], feature_signature=self.package['feature_signature'],
            reference_mapping_sha256=file_digest(Path(__file__).with_name('reference_mapping.py')))
        self.model_version += '-' + self.calibration.document['calibration_id']
        self.model_version += '-readctx1-' + file_digest(Path(__file__).with_name('read_pronunciation.py'))[:12]
        self.lock = threading.Lock()
        self.stride, self.receptive = 1, 1
        for kernel, stride in zip(self.model.config.conv_kernel, self.model.config.conv_stride):
            self.receptive += (kernel - 1) * self.stride; self.stride *= stride

    def build_reference(self, text, sentence_text=None, start_word_index=0):
        from reference_mapping import restore_boundaries, map_word_consensus
        from phonemizer.separator import Separator
        words = reference_words(text)
        try:
            spellings = phonetic_spellings(words, text if sentence_text is None else sentence_text, start_word_index)
        except ValueError as exc:
            raise RecordingError('Cụm luyện nói không khớp với câu mẫu. Hãy tải lại bài học.') from exc
        source = ' '.join(spellings)
        tokenizer = self.processor.tokenizer
        raw = tokenizer.phonemize(source).split()
        output = tokenizer.backend.phonemize([source], separator=Separator(phone=' ', word=' | ', syllable=''))[0]
        chunks = [p.strip().split() for p in output.split('|') if p.strip()]
        vocab = tokenizer.get_vocab()
        if not raw or len(raw) > 140 or any(t not in vocab or vocab[t] in self.special for t in raw):
            raise RecordingError('Câu mẫu có âm chưa được bộ chấm hỗ trợ. Vui lòng chọn câu khác.')
        if [t for chunk in chunks for t in chunk] != raw:
            raise RecordingError('Chưa tách được âm vị của câu mẫu. Vui lòng chọn câu khác.')
        candidates = [self.lexicon.get(word.lower(), []) for word in words]
        if len(chunks) != len(words):
            isolated = [p.split() for p in tokenizer.backend.phonemize(
                spellings, separator=Separator(phone=' ', word='', syllable=''))]
            try:
                chunks = restore_boundaries(candidates, chunks, isolated, self.mapping)
            except ValueError:
                chunks = None
            if chunks is None:
                raise RecordingError('Chưa tách được ranh giới từ của câu mẫu này.')
        supervised, results, offset = [], [], 0
        for wi, (word, reference, pronunciations) in enumerate(zip(words, chunks, candidates)):
            matches = map_word_consensus(pronunciations, reference, self.mapping)
            word_result = {'index': wi, 'text': word, 'status': 'unsupported', 'score': None,
                           'phones': [], 'reason': 'Chưa đối chiếu được âm vị của từ này.'}
            if matches:
                word_result['status'], word_result['reason'] = 'scored', None
                if len(matches) < len(reference):
                    word_result['reason'] = 'Từ này chỉ được chấm một phần; các âm gộp hoặc chưa đủ chắc chắn chưa được đánh giá.'
                for local_index, p in matches:
                    supervised.append({**p, 'teacher_score': 0.0, 'word_index': wi,
                                       'target_index': offset + local_index})
            results.append(word_result); offset += len(reference)
        if not supervised:
            raise RecordingError('Câu này chưa có âm đối chiếu đủ chắc chắn để chấm điểm.')
        return raw, [vocab[t] for t in raw], supervised, results

    def score(self, data, text, sentence_text=None, start_word_index=0):
        if not self.lock.acquire(blocking=False):
            raise EngineBusyError('Bộ chấm đang xử lý một bản ghi khác. Vui lòng thử lại sau.')
        try:
            return self._score(data, text, sentence_text, start_word_index)
        finally:
            self.lock.release()

    def _score(self, data, text, sentence_text=None, start_word_index=0):
        from gop_ctc import viterbi_align, phoneme_features
        from scorer_model import predict_package
        audio, duration, warnings = decode_audio(data)
        recording_issue = bool(warnings)
        tokens, targets, labelled, words = self.build_reference(text, sentence_text, start_word_index)
        inputs = self.processor(audio, sampling_rate=16000, return_tensors='pt')
        with self.torch.inference_mode():
            logits = self.model(inputs.input_values.to(self.device)).logits[0]
            lp = logits.log_softmax(-1).cpu().numpy()
        # Engineering rejection heuristic, not a calibrated speech/transcript detector.
        greedy = logits.argmax(-1).cpu().tolist()
        decoded_ids = [t for i, t in enumerate(greedy) if t not in self.special and (i == 0 or greedy[i - 1] != t)]
        decoded = self.processor.tokenizer.convert_ids_to_tokens(decoded_ids)
        ratio = edit_ratio(tokens, decoded)
        if not decoded or ratio > .7:
            raise RecordingError('Bản ghi chưa khớp rõ với câu mẫu hoặc có nhiều tiếng ồn. Hãy đọc lại toàn bộ câu.')
        if ratio > .4:
            recording_issue = True
            warnings.append('Một số âm trong bản ghi chưa khớp rõ với câu mẫu; điểm chỉ mang tính tham khảo.')
        try:
            states, spans, _ = viterbi_align(lp, targets)
        except ValueError as exc:
            raise RecordingError('Chưa căn chỉnh được bản ghi với câu mẫu. Hãy đọc lại toàn bộ câu.') from exc
        x, _, metadata = phoneme_features(lp, states, spans, labelled, self.canonical, self.special)
        raw_prediction = predict_package(self.package, x)
        prediction = self.calibration.apply(raw_prediction)
        for phone, score, raw_score in zip(metadata, prediction, raw_prediction):
            i = phone['target_index']; span = spans[i]
            words[phone['word_index']]['phones'].append({
                'sourcePhone': phone['source_phone'], 'symbol': tokens[i], 'score': round(float(score), 4), 'rawScore': round(float(raw_score), 4),
                'startSeconds': round(span['start_frame'] * self.stride / 16000, 4),
                'endSeconds': round(min(len(audio), (span['end_frame_exclusive'] - 1) * self.stride + self.receptive) / 16000, 4)})
        for word in words:
            if word['phones']:
                word['score'] = round(float(np.mean([p['score'] for p in word['phones']])), 4)
        coverage = len(prediction) / len(targets)
        if coverage < 1:
            warnings.append('Một số từ chưa được hỗ trợ; điểm tổng chỉ tính các âm đã được đánh giá.')
        from score_interpretation import build_feedback
        interpretation = self.calibration.interpretation(coverage, recording_issue)
        return {'status': 'scored' if coverage == 1 else 'partial', 'modelVersion': self.model_version,
            'durationSeconds': round(duration, 4), 'overallScore': round(float(np.mean(prediction)) * 50, 2),
            'coverage': round(coverage, 6), 'referenceTokenCount': len(targets), 'words': words,
            'warnings': warnings, 'feedback': build_feedback(words, coverage, interpretation), 'interpretation': interpretation}
