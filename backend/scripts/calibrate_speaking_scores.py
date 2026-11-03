"""Validation-only selection of bounded monotone score calibration and practice threshold.

The official supported-subset test is evaluated once AFTER selection, never used
to choose the transform/threshold. This is not Vietnamese-speaker validation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import numpy as np


def metrics(y, prediction):
    return {'count': len(y), 'mae': float(np.abs(y - prediction).mean()),
            'rmse': float(np.sqrt(np.mean((y - prediction) ** 2)))}


def flags(y, prediction, threshold):
    target, flagged = y < 1.5, prediction < threshold
    tp = int(np.sum(target & flagged)); fp = int(np.sum(~target & flagged)); fn = int(np.sum(target & ~flagged))
    n = tp + fp; positive = tp + fn
    precision = tp / n if n else 0.; recall = tp / positive if positive else 0.
    z = 1.96
    lower = ((precision + z*z/(2*n) - z*np.sqrt(precision*(1-precision)/n + z*z/(4*n*n))) / (1+z*z/n)) if n else 0.
    return {'flagged': n, 'teacher_below_1_5': positive, 'true_positive': tp, 'false_positive': fp,
            'precision': precision, 'recall': recall, 'f1': 2*precision*recall/(precision+recall) if precision+recall else 0.,
            'precision_wilson95_lower': float(lower)}


def fit_transform(kind, prediction, y):
    if kind == 'identity':
        return {'kind': kind}
    if kind == 'affine':
        slope, intercept = np.polyfit(prediction, y, 1)
        return {'kind': kind, 'slope': float(max(0, slope)), 'intercept': float(intercept)}
    from sklearn.isotonic import IsotonicRegression
    fitted = IsotonicRegression(y_min=0, y_max=2, increasing=True, out_of_bounds='clip').fit(prediction, y)
    return {'kind': kind, 'x': fitted.X_thresholds_.tolist(), 'y': fitted.y_thresholds_.tolist()}


def transform(spec, prediction):
    if spec['kind'] == 'identity':
        result = prediction
    elif spec['kind'] == 'affine':
        result = spec['slope'] * prediction + spec['intercept']
    else:
        result = np.interp(prediction, spec['x'], spec['y'])
    return np.clip(result, 0, 2)


def main(training, output, artifact_path):
    sys.path.insert(0, str(training / 'scripts'))
    import torch
    from sklearn.model_selection import GroupKFold
    from train_scorer import load_split
    from training_common import file_digest, FEATURE_NAMES
    from scorer_model import predict_package
    torch.set_num_threads(2)
    directory = training / 'features/gop_ctc_align_v1'
    metadata = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    extraction = json.loads((training / 'reports/gop-extraction.json').read_text(encoding='utf-8'))
    package_path = training / 'checkpoints/pronunciation_scorer.pt'
    package = torch.load(package_path, map_location='cpu', weights_only=True)
    assert package['feature_names'] == FEATURE_NAMES == metadata['features']
    validation = load_split('validation', directory, metadata, extraction)
    raw = predict_package(package, validation['X']).astype(np.float64)
    y = validation['y'].astype(np.float64)
    groups = np.asarray(validation['speakers'])
    methods = ('identity', 'affine', 'isotonic')
    oof = {kind: np.zeros_like(raw) for kind in methods}
    splits = []
    for train_index, holdout in GroupKFold(n_splits=5).split(raw, y, groups):
        assert not set(groups[train_index]) & set(groups[holdout])
        splits.append({'fit_speakers': sorted(set(groups[train_index])), 'holdout_speakers': sorted(set(groups[holdout]))})
        for kind in methods:
            spec = fit_transform(kind, raw[train_index], y[train_index])
            oof[kind][holdout] = transform(spec, raw[holdout])
    scores = {kind: metrics(y, oof[kind]) for kind in methods}
    best = min(methods, key=lambda kind: scores[kind]['mae'])
    # A transform must improve speaker-held-out validation MAE by at least 0.002/2.
    selected = best if scores[best]['mae'] <= scores['identity']['mae'] - .002 else 'identity'
    grid = []
    for threshold in np.round(np.arange(.25, 1.951, .025), 3):
        result = flags(y, oof[selected], float(threshold))
        grid.append({'threshold': float(threshold), **result})
    eligible = [r for r in grid if r['flagged'] >= 30 and r['precision'] >= .8 and r['precision_wilson95_lower'] >= .7]
    chosen = max(eligible, key=lambda r: (r['recall'], r['f1'], -r['threshold'])) if eligible else {'threshold': 1.5, **flags(y, oof[selected], 1.5)}
    selected_transform = fit_transform(selected, raw, y)
    reference = Path(__file__).resolve().parents[1] / 'speaking-ai/reference_mapping.py'
    artifact = {'schema_version': 1, 'scorer_sha256': file_digest(package_path),
                'mapping_sha256': metadata['manifest_metadata']['mapping_sha256'],
                'feature_signature': metadata['signature'], 'reference_mapping_sha256': file_digest(reference),
                'transform': selected_transform, 'practice_threshold': chosen['threshold'],
                'threshold_fitted': bool(eligible), 'minimum_coverage': .8,
                'evidence_scope': 'speechocean762-supported-subset',
                'validation_rows': len(y), 'validation_speakers': len(set(groups)),
                'label_definition': 'mean expert phoneme score < 1.5/2: practice suggestion, not substitution diagnosis',
                'limitations': 'Same validation split previously used for MLP model selection. Cached reference-v1 supported phonemes. Ref2-only phones and Vietnamese speakers are not independently calibrated.'}
    artifact['calibration_id'] = 'cal1-' + hashlib.sha256(json.dumps(artifact, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    # Test loading/prediction occurs only after the complete configuration above is frozen.
    test = load_split('test', directory, metadata, extraction)
    assert not set(test['speakers']) & set(validation['speakers'])
    test_raw = predict_package(package, test['X']).astype(np.float64)
    test_adjusted = transform(selected_transform, test_raw)
    report = {'selection': 'Lowest speaker-grouped OOF validation MAE, minimum improvement 0.002. Test never used for selection.',
              'calibration_id': artifact['calibration_id'], 'selected_transform': selected,
              'oof_validation': scores, 'group_folds': splits,
              'threshold_selection': 'Max recall subject to >=30 flagged, precision>=0.8 and Wilson95 lower>=0.7 on OOF validation.',
              'threshold': chosen, 'threshold_fitted': bool(eligible),
              'test_supported_subset': {'raw': metrics(test['y'], test_raw), 'adjusted': metrics(test['y'], test_adjusted),
                                        'old_threshold_1_5': flags(test['y'], test_raw, 1.5),
                                        'new_threshold': flags(test['y'], test_adjusted, chosen['threshold'])},
              'scorer_sha256': artifact['scorer_sha256'], 'validation_manifest_sha256': file_digest(training / 'data/manifests/validation.jsonl'),
              'test_manifest_sha256': file_digest(training / 'data/manifests/test.jsonl'),
              'limitations': artifact['limitations'], 'human_vietnamese_validated': False}
    output.mkdir(parents=True, exist_ok=True)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'calibration-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'threshold-grid.json').write_text(json.dumps(grid, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('group_folds',)}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--training-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--artifact', type=Path, required=True)
    args = parser.parse_args()
    main(args.training_root, args.output, args.artifact)
