"""Opt-in original-sublevel weighting. Default CEFR training is unchanged."""
from collections import Counter
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import random

from data import LEVELS, cefr_band
from modeling import encode_row

VERSION = 'cefr-original-boundary-mean-v1'
MODES = ('none', 'uniform', 'focus2')


def weight_table(rows, mode):
    if mode not in ('uniform', 'focus2') or not rows:
        raise ValueError('Expected nonempty training population and explicit boundary mode')
    for row in rows:
        if row.get('label_source') != 'human_final' or cefr_band(row['original_cefr']) != row['cefr']:
            raise ValueError('Boundary weighting requires consistent human original sublevels')
    counts = Counter(row['original_cefr'] for row in rows)
    factors = {label: 2 if mode == 'focus2' and label in ('B1+', 'B2') else 1 for label in counts}
    result = {}
    for band in LEVELS:
        labels = [label for label in counts if cefr_band(label) == band]
        if not labels:
            continue
        total = sum(counts[label] for label in labels)
        normalizer = Fraction(sum(counts[label]*factors[label] for label in labels), total)
        for label in labels:
            weight = Fraction(factors[label], 1)/normalizer
            result[label] = {'count': counts[label], 'exact': str(weight), 'weight': float(weight)}
    return result


def bind_examples(source, encoded, tokenizer, budget, target_length, limit, seed, mode, table=None):
    """Reconcile every cached item to its source before attaching metadata to that item."""
    if limit:
        source = random.Random(seed).sample(source, min(limit, len(source)))
    eligible = []
    for row in source:
        item = encode_row(row, 'cefr', tokenizer, budget, target_length)
        if item is not None:
            eligible.append((row, item))
    if len(eligible) != len(encoded):
        raise ValueError('Boundary metadata/tokenized population differs')
    table = table or weight_table([r for r, _ in eligible], mode)
    metadata, result = [], []
    for index, ((row, expected), actual) in enumerate(zip(eligible, encoded, strict=True)):
        if actual != expected:
            raise ValueError('Boundary token/source alignment differs before shuffling')
        weight = table[row['original_cefr']]['weight']
        result.append({**actual, 'example_weight': weight, 'example_index': index})
        metadata.append({'index': index, 'id': row['id'], 'user_id': row['user_id'],
            'prompt_id': row['prompt_id'], 'reference': row['cefr'], 'original_cefr': row['original_cefr'],
            'text_sha256': hashlib.sha256(row['text'].encode()).hexdigest(),
            'input_ids_sha256': hashlib.sha256(json.dumps(actual['input_ids'], separators=(',', ':')).encode()).hexdigest(),
            'tokens': len(actual['input_ids']), 'weight': weight})
    return result, metadata, table


class BoundaryCollator:
    def __init__(self, base):
        self.base = base

    def __call__(self, items):
        import torch
        weights = [item['example_weight'] for item in items]
        if any(not math.isfinite(w) or w <= 0 for w in weights):
            raise ValueError('Invalid boundary example weight')
        batch = self.base([{k: v for k, v in item.items() if k not in ('example_weight', 'example_index')}
                           for item in items])
        batch['example_weight'] = torch.tensor(weights, dtype=torch.float32)
        batch['example_index'] = torch.tensor([item['example_index'] for item in items], dtype=torch.long)
        return batch


def example_loss(logits, labels, weights):
    import torch
    if weights.ndim != 1 or weights.shape != labels.shape or logits.shape[0] != len(labels):
        raise ValueError('One scalar weight per example is required')
    if not torch.isfinite(weights).all() or not (weights > 0).all():
        raise ValueError('Weights must be finite and positive')
    losses = torch.nn.functional.cross_entropy(logits.float(), labels, reduction='none')
    # Dividing by sum(weights) would cancel weighting for a single-example microbatch.
    return (losses*weights.to(device=logits.device, dtype=torch.float32)).mean()


def trainer_class(trace_path):
    from transformers import Trainer
    trace_path = Path(trace_path)
    with trace_path.open('x', encoding='utf-8'):
        pass

    class BoundaryTrainer(Trainer):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.model_accepts_loss_kwargs = False

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            labels = inputs['labels']
            outputs = model(**{k: v for k, v in inputs.items()
                               if k not in ('labels', 'example_weight', 'example_index')})
            loss = example_loss(outputs.logits, labels, inputs['example_weight'])
            if model.training:
                item = {'step': self.state.global_step,
                        'indices': inputs['example_index'].detach().cpu().tolist(),
                        'weights': inputs['example_weight'].detach().cpu().tolist()}
                with trace_path.open('a', encoding='utf-8') as stream:
                    stream.write(json.dumps(item)+'\n')
            return (loss, outputs) if return_outputs else loss

    return BoundaryTrainer
