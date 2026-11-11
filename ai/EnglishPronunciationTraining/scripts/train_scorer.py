"""Train-only preprocessing, validation selection, one final supported-subset test."""
import argparse
import csv
import json
import os
import random
import time

import numpy as np

from project_env import ROOT, configure_environment
from training_common import (BASE_PHONES, FEATURE_NAMES, METHOD, config, digest,
    file_digest, read_jsonl, write_json)


def metrics(y, prediction):
    from scipy.stats import pearsonr, spearmanr
    y, prediction = np.asarray(y), np.asarray(prediction)
    if y.ndim != 1 or prediction.shape != y.shape:
        raise ValueError('Expected matching one-dimensional evaluation arrays')
    if not len(y) or not np.isfinite(y).all() or not np.isfinite(prediction).all():
        raise ValueError('Invalid evaluation values')
    variable = len(y) > 1 and np.std(y) > 1e-10 and np.std(prediction) > 1e-10
    return {'count': len(y), 'mae': float(np.abs(y - prediction).mean()),
        'rmse': float(np.sqrt(np.mean((y - prediction) ** 2))),
        'pearson': float(pearsonr(y, prediction).statistic) if variable else None,
        'spearman': float(spearmanr(y, prediction).statistic) if variable else None}


def load_split(split, directory, feature_meta, extraction_report):
    cfg = config(); manifest_root = ROOT / cfg['paths']['manifests']
    manifest_path = manifest_root / (split + '.jsonl')
    expected_hash = feature_meta['manifest_metadata']['splits'][split]['manifest_sha256']
    if file_digest(manifest_path) != expected_hash:
        raise ValueError('Manifest changed after extraction')
    rows = read_jsonl(manifest_path)
    eligible = [r for r in rows if r['eligible']]
    extraction = extraction_report['splits'].get(split)
    if not extraction or set(extraction['attempted_ids']) != {r['utterance_id'] for r in eligible}:
        raise ValueError(f'{split}: Full extraction has not finished')
    failed = {r['utterance_id'] for r in extraction['failures']}
    arrays, labels, ids, speakers, utterances, indices = [], [], [], [], [], []
    for row in eligible:
        uid = row['utterance_id']
        if uid in failed:
            continue
        metadata = json.loads((directory / split / (uid + '.json')).read_text(encoding='utf-8'))
        if metadata['signature'] != feature_meta['signature'] or metadata['record_sha256'] != row['record_sha256']:
            raise ValueError('Stale cached features')
        with np.load(directory / split / (uid + '.npz'), allow_pickle=False) as saved:
            x, y, p = saved['X'], saved['y'], saved['phone_ids']
            target = saved['target_indices']
            source = row['supervised_phones']
            if x.shape != (len(source), len(FEATURE_NAMES)) or not np.isfinite(x).all() or not np.isfinite(y).all():
                raise ValueError('Invalid features or labels')
            if y.shape != (len(source),) or not np.allclose(y, [item['teacher_score'] for item in source], atol=1e-6):
                raise ValueError('Teacher-score ownership changed')
            if not np.array_equal(p, [BASE_PHONES.index(item['base_phone']) for item in source]):
                raise ValueError('Source phone identity changed')
            if not np.array_equal(target, [item['target_index'] for item in source]):
                raise ValueError('Target-token ownership changed')
            arrays.append(x); labels.append(y); ids.append(p); indices.extend(target.tolist())
            speakers.extend([row['speaker_id']] * len(y)); utterances.extend([uid] * len(y))
    if not arrays:
        raise ValueError(f'No usable {split} features')
    x, y, phone_ids = np.concatenate(arrays), np.concatenate(labels), np.concatenate(ids)
    return {'X': x, 'y': y, 'phone_ids': phone_ids, 'speakers': speakers, 'utterances': utterances,
        'target_indices': indices, 'coverage': {'official_utterances': len(rows), 'supported_utterances': len(arrays),
            'official_phonemes': sum(r['source_phone_count'] for r in rows), 'supported_phonemes': len(y),
            'supported_phoneme_percent': round(100 * len(y) / sum(r['source_phone_count'] for r in rows), 2),
            'acoustic_failures': len(failed), 'preprocessing_skips': extraction['preprocessing_skips']}}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--feature-dir', default='features/' + METHOD)
    args = parser.parse_args(); configure_environment()
    os.environ.setdefault('CUBLAS_WORKSPACE_CONFIG', ':4096:8')
    import torch
    from torch.utils.data import DataLoader, TensorDataset
    from torch.utils.tensorboard import SummaryWriter
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    from scorer_model import ScoreMLP, predict_package
    cfg = config(); directory = ROOT / args.feature_dir
    feature_meta = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    extraction_report = json.loads((ROOT / 'reports/gop-extraction.json').read_text(encoding='utf-8'))
    if feature_meta['pilot_limit'] is not None or feature_meta['features'] != FEATURE_NAMES:
        raise ValueError('Pilot/unknown features cannot be used for final training')
    if extraction_report.get('status') not in ('completed', 'completed_with_failures') or extraction_report['signature'] != feature_meta['signature']:
        raise ValueError('Extraction not complete or fingerprint mismatch')
    if feature_meta['config'] != cfg or feature_meta['manifest_metadata']['mapping_sha256'] != file_digest(ROOT / cfg['features']['phone_mapping']):
        raise ValueError('Config/mapping has changed since extraction')
    data = {split: load_split(split, directory, feature_meta, extraction_report) for split in ('train', 'validation', 'test')}
    for a, b in (('train', 'validation'), ('train', 'test'), ('validation', 'test')):
        if set(data[a]['speakers']) & set(data[b]['speakers']) or set(data[a]['utterances']) & set(data[b]['utterances']):
            raise ValueError('Speaker/utterance leakage')
    train, val = data['train'], data['validation']; settings = cfg['scorer']
    if settings['score_range'] != [0.0, 2.0]:
        raise ValueError('This baseline is defined for teacher scores in [0, 2]')
    seed = cfg['seed']; random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(2); torch.use_deterministic_algorithms(True)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    scaler = StandardScaler().fit(train['X'])
    z_train = scaler.transform(train['X']).astype(np.float32)
    z_val = scaler.transform(val['X']).astype(np.float32)
    mean = float(train['y'].mean())
    phone_means = [float(train['y'][train['phone_ids'] == i].mean()) if np.any(train['phone_ids'] == i) else mean for i in range(len(BASE_PHONES))]
    ridge = Ridge(alpha=1.0).fit(z_train, train['y'])
    validation_metrics = {
        'global_mean': metrics(val['y'], np.full(len(val['y']), mean)),
        'phone_mean': metrics(val['y'], np.asarray(phone_means)[val['phone_ids']]),
        'ridge': metrics(val['y'], np.clip(ridge.predict(z_val), 0, 2))}
    model = ScoreMLP(len(FEATURE_NAMES), settings['hidden_sizes'], settings['dropout']).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings['learning_rate'])
    if settings['loss'] != 'huber' or settings['optimizer'] != 'adamw':
        raise ValueError('Unsupported baseline training settings')
    loader = DataLoader(TensorDataset(torch.from_numpy(z_train), torch.from_numpy(train['y'])),
        batch_size=settings['batch_size'], shuffle=True, num_workers=settings['num_workers'],
        generator=torch.Generator().manual_seed(seed))
    x_val = torch.from_numpy(z_val).to(device)
    best_mae, best_state, best_epoch, patience, history = float('inf'), None, None, 0, []
    started = time.perf_counter()
    with SummaryWriter(str(ROOT / cfg['paths']['logs'] / METHOD)) as writer:
        for epoch in range(1, settings['max_epochs'] + 1):
            model.train(); total_loss = 0
            for x, y in loader:
                x, y = x.to(device), y.to(device)
                optimizer.zero_grad(set_to_none=True)
                loss = torch.nn.functional.huber_loss(model(x), y)
                if not torch.isfinite(loss):
                    raise ValueError('Nonfinite training loss')
                loss.backward(); optimizer.step(); total_loss += float(loss.detach()) * len(y)
            model.eval()
            with torch.inference_mode():
                predictions = model(x_val).cpu().numpy()
            result = metrics(val['y'], predictions)
            record = {'epoch': epoch, 'train_huber': total_loss / len(train['y']), 'validation_mae': result['mae'],
                      'validation_pearson': result['pearson']}
            history.append(record); writer.add_scalar('loss/train_huber', record['train_huber'], epoch)
            writer.add_scalar('validation/mae', result['mae'], epoch)
            print(json.dumps(record), flush=True)
            if result['mae'] < best_mae:
                best_mae, best_epoch, patience = result['mae'], epoch, 0
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            else:
                patience += 1
                if patience >= settings['early_stopping_patience']:
                    break
    model.load_state_dict(best_state); model.eval()
    with torch.inference_mode():
        validation_metrics['mlp'] = metrics(val['y'], model(x_val).cpu().numpy())
    selected = min(validation_metrics, key=lambda name: validation_metrics[name]['mae'])
    package = {'schema_version': 1, 'method': METHOD, 'status': 'research_baseline',
        'selected_model': selected, 'feature_names': FEATURE_NAMES, 'base_phones': BASE_PHONES,
        'scaler_mean': scaler.mean_.tolist(), 'scaler_scale': scaler.scale_.tolist(),
        'train_global_mean': mean, 'train_phone_means': phone_means,
        'ridge_coef': ridge.coef_.tolist(), 'ridge_intercept': float(ridge.intercept_),
        'hidden_sizes': settings['hidden_sizes'], 'dropout': settings['dropout'], 'mlp_state_dict': best_state,
        'best_mlp_epoch': best_epoch, 'feature_signature': feature_meta['signature'],
        'seed': seed, 'validation_metrics': validation_metrics,
        'acoustic_model': cfg['acoustic_model'], 'score_range': [0, 2],
        'mapping_sha256': feature_meta['manifest_metadata']['mapping_sha256'],
        'manifest_hashes': {s: feature_meta['manifest_metadata']['splits'][s]['manifest_sha256'] for s in data}}
    checkpoint = ROOT / cfg['paths']['checkpoints'] / 'pronunciation_scorer.pt'
    torch.save(package, checkpoint)
    # Test is read for metrics only after architecture, preprocessing and selection are fixed.
    test = data['test']; z_test = scaler.transform(test['X']).astype(np.float32)
    with torch.inference_mode():
        mlp_test = model(torch.from_numpy(z_test).to(device)).cpu().numpy()
    test_predictions = {'global_mean': np.full(len(test['y']), mean),
        'phone_mean': np.asarray(phone_means)[test['phone_ids']],
        'ridge': np.clip(ridge.predict(z_test), 0, 2), 'mlp': mlp_test}
    test_metrics = {name: metrics(test['y'], p) for name, p in test_predictions.items()}
    # Verify that the exported CPU package reproduces the chosen scorer.
    exported = torch.load(checkpoint, map_location='cpu', weights_only=True)
    prediction = predict_package(exported, test['X'])
    if not np.allclose(prediction, test_predictions[selected], atol=2e-5):
        raise ValueError('Exported scorer differs from evaluated scorer')
    per_phone = {}
    for i, phone in enumerate(BASE_PHONES):
        mask = test['phone_ids'] == i
        if mask.any():
            per_phone[phone] = {**metrics(test['y'][mask], prediction[mask]),
                                'train_count': int(np.sum(train['phone_ids'] == i))}
    report = {'status': 'completed', 'scope': 'Phoneme scoring only on explicitly supported subset; not a full official benchmark.',
        'method': METHOD, 'feature_signature': feature_meta['signature'], 'seed': seed, 'training_device': device,
        'elapsed_training_seconds': round(time.perf_counter() - started, 2),
        'best_mlp_epoch': best_epoch, 'epochs_run': len(history),
        'selection_rule': 'Lowest validation MAE among four fixed candidates; no test tuning.',
        'selected_model': selected, 'validation': validation_metrics, 'test': test_metrics,
        'coverage': {s: d['coverage'] for s, d in data.items()}, 'selected_model_test_per_phone': per_phone,
        'checkpoint': str(checkpoint.relative_to(ROOT)),
        'limitations': ['No manual verification of alignment timestamps.', 'Masking of unresolved mappings changes sample distribution.',
                       'No Vietnamese learner validation.', 'Scores do not identify a specific phoneme substitution or assess fluency/prosody.']}
    write_json(ROOT / 'reports/scorer-evaluation.json', report)
    with (ROOT / 'reports/training-history.csv').open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(history[0])); writer.writeheader(); writer.writerows(history)
    np.savez_compressed(ROOT / 'reports/test-predictions.npz', y=test['y'], selected_prediction=prediction,
        phone_ids=test['phone_ids'], utterance_ids=np.asarray(test['utterances']), target_indices=np.asarray(test['target_indices']))
    print(json.dumps({k: report[k] for k in ('selected_model', 'best_mlp_epoch', 'validation', 'test', 'coverage')}, indent=2), flush=True)
    print('Saved: ' + str(checkpoint), flush=True)


if __name__ == '__main__':
    main()
