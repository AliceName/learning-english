"""Create a reproducible symbolic mapping and audit text references; no audio fitting."""
import csv
import json
from collections import Counter
from datetime import datetime, timezone

import yaml

from phone_mapping import PHONE_TOKENS, SOURCES, PhoneMapping, fingerprint, parse_phone, restore_word_boundaries
from project_env import ROOT, configure_environment


def main():
    configure_environment()
    config = yaml.safe_load((ROOT / 'configs/baseline.yaml').read_text(encoding='utf-8'))
    acoustic = config['acoustic_model']
    snapshot = (ROOT / '.cache/huggingface/hub' /
                ('models--' + acoustic['id'].replace('/', '--')) /
                'snapshots' / acoustic['revision'])
    vocab = json.loads((snapshot / 'vocab.json').read_text(encoding='utf-8'))
    model_config = json.loads((snapshot / 'config.json').read_text(encoding='utf-8'))
    if model_config['pad_token_id'] != vocab['<pad>']:
        raise ValueError('Model blank and tokenizer pad differ')
    phones = {}
    for base, variants in PHONE_TOKENS.items():
        phones[base] = {'canonical_token': variants[0], 'canonical_id': vocab[variants[0]],
                        'reference_variants': [{'token': v, 'id': vocab[v]} for v in variants]}
    document = {
        'schema_version': 1, 'mapping_version': 'arpabet-espeak-en-us-v1',
        'status': 'symbolic_mapping_acoustic_validation_pending',
        'model_id': acoustic['id'], 'model_revision': acoustic['revision'],
        'vocab_sha256': fingerprint(vocab), 'vocab_size': len(vocab),
        'ctc_blank_id': model_config['pad_token_id'],
        'special_tokens': {t: vocab[t] for t in ('<pad>', '<s>', '</s>', '<unk>')},
        'sources': SOURCES,
        'policy': {
            'stress': 'Preserve original suffix; do not infer reduced vowel from 0 alone.',
            'reference': 'Use frozen en-us text G2P to select permitted 1:1 variants.',
            'scores': 'Keep source score ownership and order; never use scores to select tokens.',
            'merges': 'Flag and block; do not split a joint token across teacher labels.',
            'unknown': 'Fail closed, never substitute <unk>, blank or a nearest phone.',
            'interpretation': 'Mapped means symbolic compatibility, not validated GOP accuracy.',
        }, 'phones': phones,
    }
    mapping = PhoneMapping(document, vocab)
    dataset = ROOT / config['dataset']['root']
    scores_path = dataset / config['dataset']['scores']
    scores = json.loads(scores_path.read_text(encoding='utf-8'))
    split_ids = {}
    for split in (config['dataset']['train_split'], config['dataset']['test_split']):
        ids = [line.split(maxsplit=1)[0] for line in (dataset / split / 'wav.scp').read_text().splitlines() if line.strip()]
        if len(ids) != len(set(ids)):
            raise ValueError(f'Duplicate utterance IDs in {split}')
        split_ids[split] = ids
    if set(split_ids['train']) & set(split_ids['test']):
        raise ValueError('Train/test utterance overlap')
    # Preserve sentence context: isolated "a" can become the letter /eɪ/.
    # Extra word separators must leave the actual tokenizer sequence unchanged.
    from transformers import Wav2Vec2PhonemeCTCTokenizer
    from phonemizer.separator import Separator
    tokenizer = Wav2Vec2PhonemeCTCTokenizer.from_pretrained(str(snapshot), local_files_only=True)
    if tokenizer.get_vocab() != vocab:
        raise ValueError('Loaded tokenizer differs from pinned vocabulary')
    all_ids = [uid for ids in split_ids.values() for uid in ids]
    texts = [' '.join(w['text'] for w in scores[uid]['words']).lower() for uid in all_ids]
    separated = tokenizer.backend.phonemize(texts, separator=Separator(phone=' ', word=' | ', syllable=''))
    plain = tokenizer.backend.phonemize(texts, separator=Separator(phone=' ', word='', syllable=''))
    if len(separated) != len(all_ids) or len(plain) != len(all_ids):
        raise ValueError('G2P lost utterance boundaries')
    references, sentence_issues, restored_ids = {}, {}, set()
    for uid, output, unseparated in zip(all_ids, separated, plain):
        chunks = [chunk.strip().split() for chunk in output.split('|') if chunk.strip()]
        issues = []
        if [t for chunk in chunks for t in chunk] != unseparated.strip().split():
            issues.append('g2p_separator_changed_tokens')
        resolved = restore_word_boundaries([w['phones'] for w in scores[uid]['words']], chunks)
        if resolved is None:
            issues.append('g2p_word_boundaries_mismatch')
        elif len(chunks) != len(resolved):
            restored_ids.add(uid)
        references[uid], sentence_issues[uid] = resolved, issues
    inventory, summaries, examples, review_rows = Counter(), {}, [], {}
    for split, ids in split_ids.items():
        counts, reasons = Counter(), Counter()
        for uid in ids:
            row = scores[uid]
            for wi, word in enumerate(row['words']):
                raw = word['phones']; teacher = word['phones-accuracy']
                ref = None if sentence_issues[uid] else references[uid][wi]
                result = mapping.map_word(raw, teacher, ref)
                if sentence_issues[uid]:
                    result['issues'] = sentence_issues[uid]
                inventory.update(raw)
                counts['word_occurrences'] += 1; counts['phoneme_occurrences'] += len(raw)
                counts[result['status'] + '_words'] += 1
                counts[result['status'] + '_phones'] += len(raw)
                if result['merged_token_candidates']:
                    counts['words_with_possible_merged_tokens'] += 1
                reasons.update(issue.split(':')[0] for issue in set(result['issues']))
                if result['status'] != 'mapped':
                    key = (word['text'], tuple(raw), tuple(result['reference_tokens'] or []), tuple(result['issues']))
                    if key not in review_rows:
                        review_rows[key] = {'word': word['text'], 'source_phones': ' '.join(raw),
                            'reference_tokens': ' '.join(result['reference_tokens'] or []),
                            'issues': ';'.join(result['issues']), 'train_occurrences': 0,
                            'test_occurrences': 0, 'example_utterance': uid, 'word_index': wi,
                            'merged_candidates': json.dumps(result['merged_token_candidates'], ensure_ascii=False)}
                    review_rows[key][split + '_occurrences'] += 1
                if split == 'train' and (word['text'] in ('WE', 'BEAR', 'BUT', 'ABOUT', 'BIRD', 'CAR', 'FOR') or len(examples) < 8):
                    if not any(e['word'] == word['text'] for e in examples):
                        examples.append({'utterance_id': uid, 'word': word['text'], 'word_index': wi, **result})
        counts['utterances'] = len(ids)
        counts['utterances_with_exact_word_boundary_restoration'] = len(set(ids) & restored_ids)
        summaries[split] = {**dict(counts), 'review_reasons': dict(reasons),
            'mapped_word_percent': round(100 * counts['mapped_words'] / counts['word_occurrences'], 2)}
    mapping_path = ROOT / 'configs/phone_mapping.json'
    mapping_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with (ROOT / 'reports/phone-inventory.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f); writer.writerow(['source_phone', 'base_phone', 'stress', 'occurrences', 'canonical_token', 'canonical_id', 'permitted_reference_variants'])
        for label, count in sorted(inventory.items()):
            base, stress = parse_phone(label)
            writer.writerow([label, base, stress, count, phones[base]['canonical_token'], phones[base]['canonical_id'], ' | '.join(PHONE_TOKENS[base])])
    rows = list(review_rows.values())
    with (ROOT / 'reports/phone-mapping-review.csv').open('w', encoding='utf-8-sig', newline='') as f:
        fields = list(rows[0]) if rows else ['word', 'source_phones', 'reference_tokens', 'issues']
        writer = csv.DictWriter(f, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    audit = {'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'status': 'structural_checks_passed_review_items_remain' if rows else 'structural_checks_passed',
        'scope': 'Vocabulary, text G2P and teacher-label ownership; no acoustic validation.',
        'mapping_version': document['mapping_version'], 'vocab_sha256': document['vocab_sha256'],
        'source_label_count': len(inventory), 'base_phone_count': len({parse_phone(p)[0] for p in inventory}),
        'unmapped_source_labels': [], 'splits': summaries, 'unique_review_cases': len(rows),
        'variant_selection': 'Sentence-context text G2P only; no fitting or threshold selection on train or test labels.',
        'examples': examples}
    (ROOT / 'reports/phone-mapping-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in audit.items() if k != 'examples'}, ensure_ascii=False, indent=2))
    print(f'Mapping: {mapping_path}')


if __name__ == '__main__':
    main()
