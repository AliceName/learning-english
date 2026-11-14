"""Conservative ARPAbet -> pinned eSpeak-token references, preserving label ownership.

Vocabulary coverage is structural evidence only. Word references come from text
G2P, never from acoustic predictions or teacher scores. Merged token boundaries
remain unresolved: one model token must not inherit two independent labels.
"""
import hashlib
import json
import math
import re
from functools import lru_cache
from pathlib import Path


# First item is a canonical display reference, not a universal context rule.
# Alternatives are explicitly permitted text-reference representations, not
# automatic equivalences for scoring acoustic substitutions.
PHONE_TOKENS = {
    'AA': ['ɑː', 'ɑ'], 'AE': ['æ'], 'AH': ['ʌ', 'ə', 'ɐ'],
    'AO': ['ɔː', 'ɔ'], 'AW': ['aʊ'], 'AY': ['aɪ'], 'B': ['b'],
    'CH': ['tʃ'], 'D': ['d', 'ɾ'], 'DH': ['ð'], 'EH': ['ɛ'],
    'ER': ['ɚ', 'ɜː'], 'EY': ['eɪ'], 'F': ['f'], 'G': ['ɡ'],
    'HH': ['h'], 'IH': ['ɪ', 'ᵻ'], 'IY': ['iː', 'i'], 'JH': ['dʒ'],
    'K': ['k'], 'L': ['l', 'ɫ'], 'M': ['m'], 'N': ['n'], 'NG': ['ŋ'],
    'OW': ['oʊ'], 'OY': ['ɔɪ'], 'P': ['p'], 'R': ['ɹ'], 'S': ['s'],
    'SH': ['ʃ'], 'T': ['t', 'ɾ'], 'TH': ['θ'], 'UH': ['ʊ'],
    'UW': ['uː', 'u'], 'V': ['v'], 'W': ['w'], 'Y': ['j'],
    'Z': ['z'], 'ZH': ['ʒ'],
}
VOWELS = set('AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW'.split())
SOURCES = [
    'https://github.com/cmusphinx/cmudict',
    'https://github.com/jimbozhang/speechocean762',
    'https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft',
    'https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme',
]


def parse_phone(label):
    """Do not silently normalize R*, <DEL>, unknown phones or position suffixes."""
    match = re.fullmatch(r'([A-Z]+)([012])?', label)
    if not match or match[1] not in PHONE_TOKENS:
        raise ValueError(f'Unsupported canonical phone: {label!r}')
    base, stress = match.groups()
    if stress is not None and base not in VOWELS:
        raise ValueError(f'Stress suffix on consonant: {label!r}')
    return base, int(stress) if stress is not None else None


def fingerprint(vocab):
    raw = json.dumps(vocab, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def restore_word_boundaries(source_words, chunks):
    """Recover only a unique partition of exact, length-preserving word merges.

    Single chunks can still have lexical disagreements (checked by map_word).
    Joining multiple source words is permitted only if EVERY source phone has a
    matching permitted token. No gaps, edit-distance guesses or score fitting.
    Multiple complete partitions are ambiguous and are rejected.
    """
    if len(chunks) == len(source_words):
        return chunks
    if len(chunks) > len(source_words) or not chunks:
        return None
    bases = [[parse_phone(p)[0] for p in word] for word in source_words]

    @lru_cache(None)
    def partitions(wi, ci):
        if ci == len(chunks):
            return [()] if wi == len(source_words) else []
        paths = []
        # Leave at least one word per remaining chunk.
        maximum = len(source_words) - wi - (len(chunks) - ci - 1)
        for count in range(1, maximum + 1):
            if count > 1:
                group = [p for word in bases[wi:wi + count] for p in word]
                if len(group) != len(chunks[ci]) or not all(
                        token in PHONE_TOKENS[p] for p, token in zip(group, chunks[ci])):
                    continue
            for suffix in partitions(wi + count, ci + 1):
                paths.append((count,) + suffix)
                if len(paths) == 2:
                    return paths  # Only uniqueness matters; avoid exponential work.
        return paths

    paths = partitions(0, 0)
    if len(paths) != 1:
        return None
    result, wi = [], 0
    for chunk, count in zip(chunks, paths[0]):
        if count == 1:
            result.append(chunk)
        else:
            offset = 0
            for source in source_words[wi:wi + count]:
                result.append(chunk[offset:offset + len(source)])
                offset += len(source)
        wi += count
    return result


class PhoneMapping:
    def __init__(self, document, vocab):
        if document.get('schema_version') != 1:
            raise ValueError('Unsupported phone-mapping schema')
        if document['vocab_sha256'] != fingerprint(vocab):
            raise ValueError('Mapping does not match checkpoint vocabulary')
        if document['ctc_blank_id'] != 0 or vocab.get('<pad>') != 0:
            raise ValueError('Unexpected CTC blank; verify the pinned model config')
        self.document, self.vocab = document, vocab
        self.phones = document['phones']
        if set(self.phones) != set(PHONE_TOKENS):
            raise ValueError('Incomplete source phone inventory')
        special = {vocab[t] for t in ['<pad>', '<s>', '</s>', '<unk>']}
        for base, item in self.phones.items():
            if base not in PHONE_TOKENS:
                raise ValueError(f'Unknown source inventory entry: {base}')
            actual = [v['token'] for v in item['reference_variants']]
            if actual != PHONE_TOKENS[base]:
                raise ValueError(f'Unreviewed variant change for {base}')
            if (item['canonical_token'] != actual[0]
                    or item['canonical_id'] != vocab[actual[0]]):
                raise ValueError(f'Invalid canonical reference for {base}')
            for variant in item['reference_variants']:
                token, token_id = variant['token'], variant['id']
                if vocab.get(token) != token_id or token_id in special:
                    raise ValueError(f'Invalid token/ID in mapping: {base}: {variant}')

    @classmethod
    def load(cls, path, vocab):
        return cls(json.loads(Path(path).read_text(encoding='utf-8')), vocab)

    def map_word(self, phones, scores=None, reference_tokens=None):
        if not phones:
            raise ValueError('Empty source phone sequence')
        parsed = [parse_phone(p) for p in phones]
        if scores is not None:
            if len(phones) != len(scores):
                raise ValueError('Phone and teacher-score lengths differ')
            if any(isinstance(s, bool) or not isinstance(s, (int, float))
                   or not math.isfinite(s) or not 0 <= s <= 2 for s in scores):
                raise ValueError('Teacher phoneme scores must be finite in [0, 2]')
        records = []
        for index, (raw, (base, stress)) in enumerate(zip(phones, parsed)):
            records.append({
                'source_index': index, 'source_phone': raw, 'base_phone': base,
                'stress': stress, 'teacher_score': scores[index] if scores is not None else None,
                'canonical_token': self.phones[base]['canonical_token'],
                'target_token': None, 'target_id': None,
            })
        result = {'status': 'review_required', 'phones': records, 'issues': [],
                  'reference_tokens': reference_tokens, 'merged_token_candidates': []}
        if reference_tokens is None:
            result['issues'].append('reference_context_not_checked')
            return result
        if any(t not in self.vocab or t in ('<pad>', '<s>', '</s>', '<unk>')
               for t in reference_tokens):
            result['issues'].append('unknown_or_special_reference_token')
        if len(reference_tokens) != len(phones):
            result['issues'].append('reference_length_mismatch')
            # Diagnostic only; never duplicate or average teacher labels here.
            for i in range(len(parsed) - 1):
                left, right = parsed[i][0], parsed[i + 1][0]
                for a in PHONE_TOKENS[left]:
                    for b in PHONE_TOKENS[right]:
                        joined = a + b
                        if joined in reference_tokens and joined in self.vocab:
                            result['merged_token_candidates'].append({
                                'source_indices': [i, i + 1], 'token': joined,
                                'id': self.vocab[joined],
                            })
        if result['issues']:
            return result
        for record, token in zip(records, reference_tokens):
            if token not in PHONE_TOKENS[record['base_phone']]:
                result['issues'].append(
                    f"unapproved_reference_variant:{record['source_index']}:{token}")
        if result['issues']:
            return result
        for record, token in zip(records, reference_tokens):
            record['target_token'], record['target_id'] = token, self.vocab[token]
        result['status'] = 'mapped'
        return result

    def require_target_ids(self, phones, scores=None, reference_tokens=None):
        result = self.map_word(phones, scores, reference_tokens)
        if result['status'] != 'mapped':
            raise ValueError('Mapping needs review: ' + ', '.join(result['issues']))
        return [record['target_id'] for record in result['phones']]
