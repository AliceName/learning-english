"""Train-only evidence for the frozen scorer; absence is never a low score."""
import hashlib
import json
from pathlib import Path


def load_phone_support(path, *, scorer_sha256, mapping_sha256, feature_signature, base_phones):
    document = json.loads(Path(path).read_text(encoding='utf-8'))
    payload = {key: value for key, value in document.items() if key != 'support_id'}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if document.get('schema_version') != 1 or document.get('support_id') != 'support1-' + fingerprint[:16]:
        raise ValueError('Invalid training-support fingerprint')
    for field, expected in (('scorer_sha256', scorer_sha256), ('mapping_sha256', mapping_sha256),
                            ('feature_signature', feature_signature)):
        if document.get(field) != expected:
            raise ValueError('Training support does not match scorer: ' + field)
    counts = document.get('train_phone_counts')
    if not isinstance(counts, dict) or set(counts) != set(base_phones) or any(
            type(count) is not int or count < 0 for count in counts.values()) or sum(counts.values()) == 0:
        raise ValueError('Invalid train-only phone counts')
    return document


def supported_matches(matches, counts):
    """Preserve original token positions; drop phones with no training examples."""
    return [(index, phone) for index, phone in matches if counts.get(phone['base_phone'], 0) > 0]
