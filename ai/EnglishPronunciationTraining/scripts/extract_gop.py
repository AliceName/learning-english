"""Resumable frozen acoustic inference, forced CTC alignment and cached features."""
import argparse
import json
import os
import random
import time
from collections import Counter

import numpy as np

from gop_ctc import phoneme_features, viterbi_align
from phone_mapping import PhoneMapping
from project_env import ROOT, configure_environment
from training_common import (BASE_PHONES, FEATURE_NAMES, METHOD, config, digest,
    file_digest, read_jsonl, snapshot_path, write_json)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--splits', nargs='+', choices=['train', 'validation', 'test'], default=['train', 'validation', 'test'])
    parser.add_argument('--limit', type=int, help='Pilot limit per split; always use a separate output directory.')
    parser.add_argument('--output-dir', default='features/' + METHOD)
    parser.add_argument('--report', default='reports/gop-extraction.json')
    args = parser.parse_args()
    if args.limit is not None and (args.limit <= 0 or args.output_dir == 'features/' + METHOD):
        raise ValueError('A positive pilot limit requires a separate output directory')
    configure_environment()
    import soundfile as sf
    import torch
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    cfg = config(); torch.set_num_threads(2)
    snapshot = snapshot_path(cfg)
    processor = Wav2Vec2Processor.from_pretrained(str(snapshot), local_files_only=True)
    mapping = PhoneMapping.load(ROOT / cfg['features']['phone_mapping'], processor.tokenizer.get_vocab())
    manifest_root = ROOT / cfg['paths']['manifests']
    manifest_meta = json.loads((manifest_root / 'metadata.json').read_text(encoding='utf-8'))
    if manifest_meta['config_sha256'] != digest(cfg) or manifest_meta['mapping_sha256'] != file_digest(ROOT / cfg['features']['phone_mapping']):
        raise ValueError('Config/mapping changed. Rebuild manifests before extraction.')
    signature = digest({'method': METHOD, 'config': cfg, 'features': FEATURE_NAMES,
                        'mapping': manifest_meta['mapping_sha256']})
    all_rows = {}
    for split in args.splits:
        path = manifest_root / (split + '.jsonl')
        if file_digest(path) != manifest_meta['splits'][split]['manifest_sha256']:
            raise ValueError('Manifest content changed without metadata update')
        all_rows[split] = read_jsonl(path)
    device = cfg['acoustic_model']['device']
    if device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA is required for the configured extraction')
    print('Loading frozen pinned acoustic model on ' + device, flush=True)
    model = Wav2Vec2ForCTC.from_pretrained(str(snapshot), local_files_only=True,
        dtype=torch.float32, low_cpu_mem_usage=True, use_safetensors=False,
        attn_implementation=cfg['acoustic_model']['attention_implementation']).to(device)
    model.eval(); model.requires_grad_(False)
    canonical = [mapping.phones[p]['canonical_id'] for p in BASE_PHONES]
    special = set(mapping.document['special_tokens'].values())
    stride, receptive = 1, 1
    for kernel, step in zip(model.config.conv_kernel, model.config.conv_stride):
        receptive += (kernel - 1) * stride; stride *= step
    output = ROOT / args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'metadata.json', {'method': METHOD, 'signature': signature,
        'features': FEATURE_NAMES, 'base_phones': BASE_PHONES, 'config': cfg,
        'manifest_metadata': manifest_meta, 'pilot_limit': args.limit,
        'frame_stride_samples': stride, 'frame_receptive_samples': receptive,
        'definition': 'Mean target log posterior on forced Viterbi non-blank label-state frames.',
        'additional_features': 'Project baseline features, not published alignment-free GOP vectors.'})
    report = {'method': METHOD, 'signature': signature, 'pilot_limit': args.limit,
              'scope': 'Acoustic CTC alignment and feature extraction; alignment timing is not human verified.', 'splits': {}}
    started = time.perf_counter()
    for split, rows in all_rows.items():
        directory = output / split; directory.mkdir(exist_ok=True)
        eligible = [r for r in rows if r['eligible']]
        if args.limit:
            random.Random(cfg['seed']).shuffle(eligible); eligible = eligible[:args.limit]
        statuses, failures = Counter(), []
        supported_phones = 0
        for position, row in enumerate(eligible, 1):
            uid = row['utterance_id']; npz_path = directory / (uid + '.npz'); meta_path = directory / (uid + '.json')
            try:
                audio_path = ROOT / row['audio_path']
                if audio_path.stat().st_size != row['audio_bytes'] or audio_path.stat().st_mtime_ns != row['audio_mtime_ns']:
                    raise ValueError('Audio changed since manifest preparation')
                cached = None
                if npz_path.is_file() and meta_path.is_file():
                    cached = json.loads(meta_path.read_text(encoding='utf-8'))
                if cached and cached.get('signature') == signature and cached.get('record_sha256') == row['record_sha256']:
                    with np.load(npz_path, allow_pickle=False) as saved:
                        if saved['X'].shape != (len(row['supervised_phones']), len(FEATURE_NAMES)) or not np.isfinite(saved['X']).all():
                            raise ValueError('Corrupt cached feature array')
                    supported_phones += len(row['supervised_phones']); statuses['cached'] += 1
                else:
                    audio, sr = sf.read(audio_path, dtype='float32')
                    if sr != cfg['audio']['sample_rate'] or audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
                        raise ValueError('Invalid/nonfinite audio')
                    if len(audio) / sr > cfg['acoustic_model']['max_audio_seconds']:
                        raise ValueError('Audio exceeds configured maximum; never truncate')
                    inputs = processor(audio, sampling_rate=sr, return_tensors='pt')
                    with torch.inference_mode():
                        logits = model(inputs.input_values.to(device=device, dtype=torch.float32)).logits[0]
                        lp = logits.log_softmax(dim=-1).cpu().numpy()
                    states, spans, path_score = viterbi_align(lp, row['target_ids'], mapping.document['ctc_blank_id'])
                    x, y, phone_meta = phoneme_features(lp, states, spans, row['supervised_phones'], canonical, special)
                    if len(y) != len(row['supervised_phones']) or not np.isfinite(y).all():
                        raise ValueError('Invalid teacher-score ownership')
                    for span in spans:
                        span['support_start_seconds'] = span['start_frame'] * stride / sr
                        span['support_end_seconds'] = min(len(audio), (span['end_frame_exclusive'] - 1) * stride + receptive) / sr
                    metadata = {'utterance_id': uid, 'speaker_id': row['speaker_id'], 'split': split,
                        'signature': signature, 'record_sha256': row['record_sha256'],
                        'feature_count': len(y), 'ctc_path_log_probability': path_score,
                        'frames': len(lp), 'blank_fraction': float(np.mean(states % 2 == 0)),
                        'reference_tokens': row['reference_tokens'], 'alignment': spans,
                        'supervised_phones': phone_meta, 'masked_words': row['masked_words']}
                    temp = npz_path.with_suffix('.npz.tmp')
                    with temp.open('wb') as f:
                        np.savez_compressed(f, X=x, y=y,
                            phone_ids=np.asarray([BASE_PHONES.index(p['base_phone']) for p in phone_meta], dtype=np.int16),
                            target_indices=np.asarray([p['target_index'] for p in phone_meta], dtype=np.int16))
                    os.replace(temp, npz_path)
                    write_json(meta_path, metadata)
                    supported_phones += len(y); statuses['extracted'] += 1
                    if args.limit and position <= 3:
                        plot_alignment(lp, spans, row, ROOT / 'reports' / ('pilot-alignment-' + uid + '.png'))
            except Exception as exc:
                statuses['failed'] += 1
                failures.append({'utterance_id': uid, 'error': f'{type(exc).__name__}: {exc}'})
                if device == 'cuda':
                    torch.cuda.empty_cache()
                print(json.dumps({'event': 'failure', **failures[-1]}), flush=True)
            if position % 25 == 0 or position == len(eligible):
                print(json.dumps({'event': 'progress', 'split': split, 'done': position, 'total': len(eligible),
                    'phones': supported_phones, 'statuses': dict(statuses), 'elapsed_seconds': round(time.perf_counter() - started, 1)}), flush=True)
                interim = {**report, 'running_split': split, 'running_done': position, 'running_total': len(eligible),
                           'running_phones': supported_phones, 'running_statuses': dict(statuses)}
                write_json(ROOT / args.report, interim)
        report['splits'][split] = {'manifest_utterances': len(rows), 'eligible_utterances': sum(r['eligible'] for r in rows),
            'attempted_utterances': len(eligible), 'supervised_phones': supported_phones,
            'source_phones': sum(r['source_phone_count'] for r in rows), 'statuses': dict(statuses),
            'failures': failures, 'attempted_ids': [r['utterance_id'] for r in eligible],
            'preprocessing_skips': dict(Counter(reason for r in rows for reason in r['skip_reasons']))}
        write_json(ROOT / args.report, report)
    report['elapsed_seconds'] = round(time.perf_counter() - started, 2)
    report['status'] = 'completed_with_failures' if any(s['statuses'].get('failed') for s in report['splits'].values()) else 'completed'
    write_json(ROOT / args.report, report)
    print(json.dumps({k: v for k, v in report.items() if k != 'splits'}, indent=2), flush=True)


def plot_alignment(lp, spans, row, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    ids = row['target_ids']
    fig, ax = plt.subplots(figsize=(12, max(3, len(ids) * 0.18)))
    ax.imshow(np.exp(lp[:, ids]).T, aspect='auto', origin='lower', vmin=0, vmax=1)
    ax.set_yticks(range(len(ids)), [f'{i}: token {token}' for i, token in enumerate(ids)], fontsize=6)
    for i, span in enumerate(spans):
        ax.plot([span['start_frame'], span['end_frame_exclusive'] - 1], [i, i], color='red', linewidth=2)
    ax.set_xlabel('Model output frame (not verified phoneme boundaries)')
    ax.set_title(row['utterance_id'] + ': ' + row['text'])
    fig.tight_layout(); fig.savefig(path, dpi=140); plt.close(fig)


if __name__ == '__main__':
    main()
