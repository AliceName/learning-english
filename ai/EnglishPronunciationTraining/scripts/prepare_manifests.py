"""Speaker-disjoint splits and text-only label ownership for full CTC targets."""
import random
import wave
from collections import Counter

from phone_mapping import PhoneMapping, restore_word_boundaries
from project_env import ROOT, configure_environment
from training_common import config, digest, file_digest, snapshot_path, write_json, write_jsonl


def partition_speakers(speakers, fraction, seed):
    ordered = sorted(set(speakers))
    if not 0 < fraction < 1 or len(ordered) < 2:
        raise ValueError('Invalid validation speaker fraction/inventory')
    random.Random(seed).shuffle(ordered)
    count = min(len(ordered) - 1, max(1, round(len(ordered) * fraction)))
    return set(ordered[count:]), set(ordered[:count])


def main():
    configure_environment()
    import json
    from transformers import Wav2Vec2PhonemeCTCTokenizer
    from phonemizer.separator import Separator
    cfg = config(); dataset = ROOT / cfg['dataset']['root']; model_path = snapshot_path(cfg)
    tokenizer = Wav2Vec2PhonemeCTCTokenizer.from_pretrained(str(model_path), local_files_only=True)
    vocab = tokenizer.get_vocab()
    mapping = PhoneMapping.load(ROOT / cfg['features']['phone_mapping'], vocab)
    scores = json.loads((dataset / cfg['dataset']['scores']).read_text(encoding='utf-8'))
    source = {}
    for split in ('train', 'test'):
        wav = dict(line.split(maxsplit=1) for line in (dataset / split / 'wav.scp').read_text().splitlines() if line.strip())
        speaker = dict(line.split() for line in (dataset / split / 'utt2spk').read_text().splitlines() if line.strip())
        if set(wav) != set(speaker) or set(wav) - scores.keys():
            raise ValueError('Missing speakers/labels')
        source[split] = (wav, speaker)
    train_speakers, val_speakers = partition_speakers(source['train'][1].values(),
        cfg['dataset']['validation_speaker_fraction'], cfg['seed'])
    test_speakers = set(source['test'][1].values())
    if (train_speakers | val_speakers) & test_speakers or set(source['train'][0]) & set(source['test'][0]):
        raise ValueError('Official train/test overlaps')
    ids = list(source['train'][0]) + list(source['test'][0])
    texts = [' '.join(w['text'] for w in scores[uid]['words']).lower() for uid in ids]
    separator = Separator(phone=' ', word=' | ', syllable='')
    outputs = tokenizer.backend.phonemize(texts, separator=separator)
    plain = tokenizer.backend.phonemize(texts, separator=Separator(phone=' ', word='', syllable=''))
    if len(ids) != len(outputs) or len(ids) != len(plain):
        raise ValueError('G2P utterance count mismatch')
    rows = {split: [] for split in ('train', 'validation', 'test')}
    special = set(mapping.document['special_tokens'].values())
    for uid, output, raw in zip(ids, outputs, plain):
        original = 'train' if uid in source['train'][0] else 'test'
        wav, speakers = source[original]; speaker = speakers[uid]
        split = 'test' if original == 'test' else ('validation' if speaker in val_speakers else 'train')
        words = scores[uid]['words']; chunks = [p.strip().split() for p in output.split('|') if p.strip()]
        tokens = raw.strip().split(); reasons, masked, labelled = [], [], []
        if not tokens or any(t not in vocab or vocab[t] in special for t in tokens):
            reasons.append('invalid_full_reference_tokens')
        restored = restore_word_boundaries([w['phones'] for w in words], chunks)
        if [t for chunk in chunks for t in chunk] != tokens:
            reasons.append('separator_changed_reference')
        if restored is None:
            reasons.append('unresolved_word_boundaries')
        else:
            offset = 0
            for wi, (word, reference) in enumerate(zip(words, restored)):
                result = mapping.map_word(word['phones'], word['phones-accuracy'], reference)
                if result['status'] == 'mapped':
                    for phone in result['phones']:
                        labelled.append({**phone, 'word_index': wi, 'word_text': word['text'],
                                         'target_index': offset + phone['source_index']})
                else:
                    masked.append({'word_index': wi, 'word_text': word['text'],
                                   'source_phone_count': len(word['phones']), 'issues': result['issues']})
                offset += len(reference)
            if offset != len(tokens):
                raise ValueError('Restored labels do not cover the full reference')
        if not labelled:
            reasons.append('no_supervised_phones')
        path = dataset / wav[uid]
        with wave.open(str(path), 'rb') as f:
            duration = f.getnframes() / f.getframerate()
            if f.getframerate() != cfg['audio']['sample_rate'] or f.getnchannels() != 1:
                reasons.append('unsupported_audio_format')
        if duration > cfg['acoustic_model']['max_audio_seconds']:
            reasons.append('audio_over_max_seconds_not_truncated')
        row = {'utterance_id': uid, 'speaker_id': speaker, 'split': split, 'source_split': original,
            'audio_path': path.relative_to(ROOT).as_posix(), 'audio_bytes': path.stat().st_size,
            'audio_mtime_ns': path.stat().st_mtime_ns, 'duration_seconds': duration,
            'text': scores[uid]['text'], 'reference_tokens': tokens,
            'target_ids': [vocab[t] for t in tokens] if 'invalid_full_reference_tokens' not in reasons else [],
            'source_phone_count': sum(len(w['phones']) for w in words),
            'source_word_count': len(words), 'supervised_phones': labelled,
            'masked_words': masked, 'eligible': not reasons, 'skip_reasons': reasons}
        row['record_sha256'] = digest(row)
        rows[split].append(row)
    out = ROOT / cfg['paths']['manifests']
    summary = {'schema_version': 1, 'seed': cfg['seed'], 'config_sha256': digest(cfg),
        'mapping_sha256': file_digest(ROOT / cfg['features']['phone_mapping']),
        'scores_sha256': file_digest(dataset / cfg['dataset']['scores']),
        'model_id': cfg['acoustic_model']['id'], 'model_revision': cfg['acoustic_model']['revision'],
        'split_policy': 'Validation speakers sampled only from official train. Official test untouched.',
        'supervision_policy': 'Align full G2P sequence; attach scores only to text-verified 1:1 source phones.',
        'splits': {}}
    for split, items in rows.items():
        write_jsonl(out / (split + '.jsonl'), items)
        reasons = Counter(reason for r in items for reason in r['skip_reasons'])
        summary['splits'][split] = {'utterances': len(items), 'speakers': len({r['speaker_id'] for r in items}),
            'eligible_utterances': sum(r['eligible'] for r in items),
            'source_phones': sum(r['source_phone_count'] for r in items),
            'eligible_supervised_phones': sum(len(r['supervised_phones']) for r in items if r['eligible']),
            'skip_reasons': dict(reasons), 'manifest_sha256': file_digest(out / (split + '.jsonl'))}
    write_json(out / 'metadata.json', summary)
    write_json(ROOT / 'reports/manifest-summary.json', summary)
    print(json.dumps(summary['splits'], ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
