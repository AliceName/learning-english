"""Run the validation-selected exported scorer on one compatible feature file."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from project_env import ROOT
from scorer_model import predict_package


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('features', type=Path)
    parser.add_argument('--checkpoint', type=Path, default=ROOT / 'checkpoints/pronunciation_scorer.pt')
    args = parser.parse_args()
    package = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    meta = json.loads(args.features.with_suffix('.json').read_text(encoding='utf-8'))
    if meta['signature'] != package['feature_signature']:
        raise ValueError('Feature signature does not match trained scorer')
    with np.load(args.features, allow_pickle=False) as data:
        x = data['X']
        if x.shape != (len(meta['supervised_phones']), len(package['feature_names'])) or not np.isfinite(x).all():
            raise ValueError('Invalid feature dimensions/metadata')
        prediction = predict_package(package, x)
    rows = [{'word': p['word_text'], 'source_phone': p['source_phone'], 'target_index': p['target_index'],
             'predicted_score_0_to_2': round(float(value), 4)} for p, value in zip(meta['supervised_phones'], prediction)]
    print(json.dumps({'model': package['selected_model'], 'utterance_id': meta['utterance_id'], 'phones': rows}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
