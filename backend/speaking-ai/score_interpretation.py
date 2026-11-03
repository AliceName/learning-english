"""Bounded continuous-score calibration and conservative recording feedback."""
import json
import hashlib
import math
from pathlib import Path

import numpy as np


class ScoreCalibration:
    def __init__(self, document):
        if document.get('schema_version') != 1 or not str(document.get('calibration_id', '')).startswith('cal1-'):
            raise ValueError('Unknown score calibration artifact')
        payload = {k: v for k, v in document.items() if k != 'calibration_id'}
        expected_id = 'cal1-' + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        if document['calibration_id'] != expected_id:
            raise ValueError('Calibration artifact fingerprint mismatch')
        self.document = document
        self.spec = document['transform']
        self.threshold = float(document['practice_threshold'])
        self.minimum_coverage = float(document['minimum_coverage'])
        if not .25 <= self.threshold <= 1.95 or not 0 < self.minimum_coverage <= 1:
            raise ValueError('Invalid feedback thresholds')
        if self.spec['kind'] not in ('identity', 'affine', 'isotonic'):
            raise ValueError('Unsupported score calibration')
        if self.spec['kind'] == 'affine' and (not math.isfinite(self.spec['slope']) or self.spec['slope'] < 0 or not math.isfinite(self.spec['intercept'])):
            raise ValueError('Non-monotone affine calibration')
        if self.spec['kind'] == 'isotonic':
            x, y = np.asarray(self.spec['x']), np.asarray(self.spec['y'])
            if x.ndim != 1 or len(x) < 2 or x.shape != y.shape or not np.isfinite(x).all() or not np.isfinite(y).all() or not (np.diff(x) > 0).all() or not (np.diff(y) >= 0).all() or not ((0 <= y) & (y <= 2)).all():
                raise ValueError('Invalid monotone calibration knots')

    @classmethod
    def load(cls, path, *, scorer_sha256, mapping_sha256, reference_mapping_sha256, feature_signature):
        document = json.loads(Path(path).read_text(encoding='utf-8'))
        for key, expected in (('scorer_sha256', scorer_sha256), ('mapping_sha256', mapping_sha256), ('reference_mapping_sha256', reference_mapping_sha256), ('feature_signature', feature_signature)):
            if document.get(key) != expected:
                raise ValueError('Score calibration does not match the loaded scorer/reference: ' + key)
        return cls(document)

    def apply(self, values):
        values = np.asarray(values, dtype=np.float64)
        if values.ndim != 1 or not np.isfinite(values).all():
            raise ValueError('Invalid raw phoneme predictions')
        if self.spec['kind'] == 'affine':
            values = self.spec['slope'] * values + self.spec['intercept']
        elif self.spec['kind'] == 'isotonic':
            values = np.interp(values, self.spec['x'], self.spec['y'])
        return np.clip(values, 0, 2)

    def interpretation(self, coverage, recording_issue):
        return {'calibrationVersion': self.document['calibration_id'], 'calibrationMethod': self.spec['kind'],
                'practiceThreshold': self.threshold, 'reviewThreshold': max(1.5, self.threshold), 'thresholdFitted': self.document['threshold_fitted'],
                'minimumCoverage': self.minimum_coverage,
                'feedbackMode': 'record_again' if recording_issue else 'limited_coverage' if coverage < self.minimum_coverage else 'normal',
                'evidenceScope': self.document['evidence_scope']}


def build_feedback(words, coverage, interpretation):
    if interpretation['feedbackMode'] == 'record_again':
        return 'Bản ghi có dấu hiệu chưa khớp rõ câu mẫu hoặc âm thanh bị quá lớn. Hãy nghe lại và ghi âm lại trước khi kết luận về phát âm.'
    threshold = interpretation['practiceThreshold']
    targets = sorted((w for w in words if w['phones'] and min(p['score'] for p in w['phones']) < threshold),
                     key=lambda w: min(p['score'] for p in w['phones']))[:3]
    listen = [w for w in words if w['phones'] and threshold <= min(p['score'] for p in w['phones']) < 1.5]
    advice = ('Ưu tiên nghe mẫu và luyện lại: ' + ', '.join(w['text'] for w in targets) + '.') if targets else (
        'Có âm ở vùng cần nghe lại và so sánh với mẫu, chưa đủ căn cứ kết luận sai.' if listen else
        'Chưa có âm đã chấm nào dưới ngưỡng gợi ý luyện lại. Bạn có thể nghe mẫu và đọc lại cả câu.')
    if interpretation['feedbackMode'] == 'limited_coverage':
        advice = f'Chỉ đánh giá được {coverage:.0%} số âm tham chiếu; chưa đủ phần được chấm để nhận xét toàn câu. ' + advice
    return advice + ' Phần chưa hỗ trợ không được xem là phát âm sai; điểm không xác định lỗi thay âm cụ thể.'
