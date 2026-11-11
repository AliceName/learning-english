"""CTC Viterbi alignment and GOP-CTC-align (non-blank mean log posterior).

Definition follows section 3.1 of Cao et al., Interspeech 2024. Additional
features are this project's baseline, not a reproduction of their AF vectors.
State 2*i+1 belongs to reference token i; even states emit the CTC blank.
"""
import numpy as np

from training_common import BASE_PHONES, FEATURE_NAMES


def viterbi_align(log_probs, targets, blank=0):
    lp = np.asarray(log_probs, dtype=np.float64)
    ids = np.asarray(targets, dtype=np.int64)
    if lp.ndim != 2 or not np.isfinite(lp).all() or len(lp) == 0:
        raise ValueError('Expected a finite, non-empty [frames, vocabulary] matrix')
    if ids.ndim != 1 or len(ids) == 0 or np.any(ids == blank) or np.any(ids < 0) or np.any(ids >= lp.shape[1]):
        raise ValueError('Invalid CTC reference tokens')
    required = len(ids) + int(np.sum(ids[1:] == ids[:-1]))
    if len(lp) < required:
        raise ValueError('Too few CTC frames for reference including repeated tokens')
    sequence = np.full(2 * len(ids) + 1, blank, dtype=np.int64)
    sequence[1::2] = ids
    size = len(sequence)
    previous = np.full(size, -np.inf)
    previous[0], previous[1] = lp[0, blank], lp[0, ids[0]]
    back = np.zeros((len(lp), size), dtype=np.uint8)
    can_skip = np.zeros(size, dtype=bool)
    can_skip[2:] = (sequence[2:] != blank) & (sequence[2:] != sequence[:-2])
    for t in range(1, len(lp)):
        advance = np.full(size, -np.inf); advance[1:] = previous[:-1]
        skip = np.full(size, -np.inf); skip[2:] = previous[:-2]
        skip[~can_skip] = -np.inf
        options = np.stack((previous, advance, skip))
        choice = np.argmax(options, axis=0)
        previous = options[choice, np.arange(size)] + lp[t, sequence]
        back[t] = choice
    state = size - 1 if previous[-1] > previous[-2] else size - 2
    score = float(previous[state])
    if not np.isfinite(score):
        raise ValueError('No finite CTC alignment')
    states = np.empty(len(lp), dtype=np.int32)
    for t in range(len(lp) - 1, -1, -1):
        states[t] = state
        if t:
            state -= int(back[t, state])
    if state not in (0, 1):
        raise ValueError('Invalid CTC alignment start')
    spans = []
    for i, token in enumerate(ids):
        frames = np.flatnonzero(states == 2 * i + 1)
        if not len(frames):
            raise ValueError('Alignment skipped a reference token')
        spans.append({'target_index': i, 'token_id': int(token), 'start_frame': int(frames[0]),
                      'end_frame_exclusive': int(frames[-1] + 1), 'active_frames': int(len(frames))})
    return states, spans, score


def phoneme_features(log_probs, states, spans, supervised, canonical_ids, special_ids):
    lp = np.asarray(log_probs, dtype=np.float64)
    allowed = np.ones(lp.shape[1], dtype=bool)
    allowed[list(special_ids)] = False
    x, y, metadata = [], [], []
    for phone in supervised:
        i = phone['target_index']; token = phone['target_id']
        if spans[i]['token_id'] != token:
            raise ValueError('Teacher label points to the wrong aligned token')
        frames = np.flatnonzero(states == 2 * i + 1)
        values = lp[frames]
        target_mean = float(values[:, token].mean())
        competitors = allowed.copy(); competitors[token] = False
        best_other = float(values[:, competitors].max(axis=1).mean())
        entropy = float(-(np.exp(values) * values).sum(axis=1).mean())
        start, end = spans[i]['start_frame'], spans[i]['end_frame_exclusive']
        scalars = [target_mean, best_other, target_mean - best_other, entropy,
                   np.log1p(len(frames)), float(values[:, token].max()), float(np.mean(states % 2 == 0)),
                   (start + end) / (2 * len(lp))]
        source = np.zeros(len(BASE_PHONES)); source[BASE_PHONES.index(phone['base_phone'])] = 1
        feature = np.concatenate((scalars, values[:, canonical_ids].mean(axis=0), source))
        if len(feature) != len(FEATURE_NAMES) or not np.isfinite(feature).all():
            raise ValueError('Invalid extracted feature vector')
        x.append(feature); y.append(phone['teacher_score']); metadata.append({**phone, **spans[i], 'gop': target_mean})
    return np.asarray(x, dtype=np.float32).reshape(-1, len(FEATURE_NAMES)), np.asarray(y, dtype=np.float32), metadata
