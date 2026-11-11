"""Optional edit-weighted supervision. An experiment, not a quality guarantee."""
from difflib import SequenceMatcher


def edit_weights(source, target, weight):
    weights = [1.0] * len(target)
    for tag, _, _, start, end in SequenceMatcher(None, source, target, autojunk=False).get_opcodes():
        if tag in ("insert", "replace"):
            weights[start:end] = [weight] * (end - start)
        elif tag == "delete" and target:
            # A deletion has no target token: supervise its next token (including EOS).
            weights[min(start, len(target) - 1)] = weight
    return weights


class EditCollator:
    def __init__(self, base):
        self.base = base

    def __call__(self, examples):
        import torch
        weights = [item["loss_weights"] for item in examples]
        batch = self.base([{k: v for k, v in item.items() if k != "loss_weights"} for item in examples])
        length = batch["labels"].shape[1]
        batch["loss_weights"] = torch.tensor([w + [0.0] * (length - len(w)) for w in weights])
        return batch


def weighted_token_loss(logits, labels, weights):
    import torch.nn.functional as functional
    per_token = functional.cross_entropy(logits.float().reshape(-1, logits.shape[-1]),
                                         labels.reshape(-1), ignore_index=-100, reduction="none")
    weights = weights.to(per_token.dtype).reshape(-1) * labels.ne(-100).reshape(-1)
    return (per_token * weights).sum() / weights.sum().clamp_min(1)


def edit_trainer_class():
    from transformers import Seq2SeqTrainer

    class EditTrainer(Seq2SeqTrainer):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.model_accepts_loss_kwargs = False

        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            weights = inputs.pop("loss_weights")
            outputs = model(**inputs)
            loss = weighted_token_loss(outputs.logits, inputs["labels"], weights)
            return (loss, outputs) if return_outputs else loss

    return EditTrainer
