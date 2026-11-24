"""Audit active cached training provenance and export train-only phone support.

Does not run training, read test audio, change the checkpoint or use test labels
to decide which phones are supported. Output is a separate pinned artifact.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys


DEFAULT_TRAINING = Path(__file__).resolve().parents[3] / 'EnglishPronunciationTraining/EnglishPronunciationTraining'


def audit(training):
    import numpy as np
    import torch
    sys.path.insert(0, str(training / 'scripts'))
    from training_common import BASE_PHONES, FEATURE_NAMES, file_digest
    from train_scorer import load_split
    directory = training / 'features/gop_ctc_align_v1'
    metadata = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    extraction = json.loads((training / 'reports/gop-extraction.json').read_text(encoding='utf-8'))
    checkpoint = training / 'checkpoints/pronunciation_scorer.pt'
    package = torch.load(checkpoint, map_location='cpu', weights_only=True)
    if metadata.get('pilot_limit') is not None or extraction.get('signature') != metadata['signature']:
        raise ValueError('Training feature extraction is incomplete or stale')
    if package['feature_signature'] != metadata['signature'] or package['feature_names'] != FEATURE_NAMES:
        raise ValueError('Checkpoint and extracted feature schema differ')
    if package['base_phones'] != BASE_PHONES or metadata['features'] != FEATURE_NAMES:
        raise ValueError('Phone inventory/feature schema differ')
    if package['mapping_sha256'] != metadata['manifest_metadata']['mapping_sha256']:
        raise ValueError('Checkpoint and feature mapping differ')
    for split, digest in package['manifest_hashes'].items():
        if digest != metadata['manifest_metadata']['splits'][split]['manifest_sha256']:
            raise ValueError('Checkpoint and manifest provenance differ: ' + split)
    train = load_split('train', directory, metadata, extraction)
    one_hot = train['X'][:, -len(BASE_PHONES):]
    if not np.array_equal(one_hot.argmax(axis=1), train['phone_ids']) or not np.all(
            (one_hot == 0) | (one_hot == 1)) or not np.all(one_hot.sum(axis=1) == 1):
        raise ValueError('Source-phone feature ownership differs')
    counts = Counter(train['phone_ids'].tolist())
    support = {'schema_version': 1, 'scorer_sha256': file_digest(checkpoint),
        'mapping_sha256': package['mapping_sha256'], 'feature_signature': package['feature_signature'],
        'train_manifest_sha256': package['manifest_hashes']['train'],
        'train_phone_counts': {phone: counts[index] for index, phone in enumerate(BASE_PHONES)}}
    fingerprint = hashlib.sha256(json.dumps(support, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    support['support_id'] = 'support1-' + fingerprint[:16]
    serving = Path(__file__).resolve().parents[1] / 'speaking-ai'
    ref = file_digest(serving / 'reference_mapping.py')
    calibration = json.loads((serving / 'configs/scoring-calibration.json').read_text(encoding='utf-8'))
    report = {'status': 'audited_train_provenance', 'training_root': str(training),
        'support_id': support['support_id'], 'training_rows': len(train['y']),
        'training_speakers': len(set(train['speakers'])), 'phone_train_counts': support['train_phone_counts'],
        'zero_training_phones': [p for p, n in support['train_phone_counts'].items() if n == 0],
        'phones_below_50_training_examples': {p: n for p, n in support['train_phone_counts'].items() if n < 50},
        'reference_mapping_sha256': ref,
        'calibration_matches_serving_reference': calibration.get('reference_mapping_sha256') == ref,
        'feature_names_match': True, 'manifest_and_label_ownership_match': True,
        'active_gop_implementation_sha256': file_digest(training / 'scripts/gop_ctc.py'),
        'cached_implementation_provenance': 'Source implementation hash was not recorded in the old feature cache.',
        'limitations': ['No Vietnamese accuracy measurement or manual acoustic-alignment audit.',
            'Feature names and ownership checks do not prove identical historical feature computation; cached source-code provenance is unavailable.',
            'Positive train count is not evidence of reliable scoring; rare phones still need labeled evaluation.',
            'Existing calibration uses cached ref-v1 supported features; ref2-specific coverage still needs independent evaluation.']}
    return report, support


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--training-root', type=Path, default=DEFAULT_TRAINING)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--support-output', type=Path, required=True)
    args = parser.parse_args()
    training = args.training_root.resolve()
    protected = training / 'checkpoints'
    if args.output.resolve().is_relative_to(protected) or args.support_output.resolve().is_relative_to(protected):
        parser.error('Audit output must not overwrite a checkpoint')
    if args.output.resolve() == args.support_output.resolve():
        parser.error('Report and artifact need different paths')
    for path in (args.output, args.support_output):
        if path.exists():
            parser.error('Output already exists; choose a new path: ' + str(path))
    report, support = audit(training)
    for path, value in ((args.output, report), (args.support_output, support)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'zero_training_phones': report['zero_training_phones'],
                      'output': str(args.output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
