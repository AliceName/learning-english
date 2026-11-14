"""Optional bounded class balancing, calculated only from human-labelled train rows."""
import math


def class_weights(counts, cap=5.0):
    if not counts or any(n <= 0 for n in counts) or cap < 1:
        raise ValueError('Positive class counts and cap >= 1 are required')
    largest = max(counts)
    weights = [min(cap, math.sqrt(largest / n)) for n in counts]
    average = sum(n * w for n, w in zip(counts, weights, strict=True)) / sum(counts)
    return [w / average for w in weights]


def weighted_classification_loss(logits, labels, weights):
    import torch
    # A per-example mean preserves weighting for microbatches of size one.
    losses = torch.nn.functional.cross_entropy(logits.float(), labels, reduction='none')
    return (losses * weights.to(logits.device)[labels]).mean()


def weighted_trainer_class(weights):
    import torch
    from transformers import Trainer

    class WeightedCefrTrainer(Trainer):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.model_accepts_loss_kwargs = False
            self.cefr_weights = torch.tensor(weights, dtype=torch.float32)

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            labels = inputs['labels']
            outputs = model(**{k: v for k, v in inputs.items() if k != 'labels'})
            loss = weighted_classification_loss(outputs.logits, labels, self.cefr_weights)
            return (loss, outputs) if return_outputs else loss

    return WeightedCefrTrainer
