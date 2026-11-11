"""Fixed balanced dev generation, ERRANT scoring, and training callbacks."""
import json
import importlib.metadata
import random
import subprocess
import sys
import time

ERRANT_PROTOCOL = "errant-3.0.2-raw-spacy-v2"


def m2_block(annotator, original, corrected):
    """Corpus pairs are raw English, not whitespace-tokenised M2 sentences."""
    source = annotator.parse(" ".join(original.split()), tokenise=True)
    target = annotator.parse(" ".join(corrected.split()), tokenise=True)
    edits = annotator.annotate(source, target)
    annotations = [e.to_m2() for e in edits] or ["A -1 -1|||noop|||-NONE-|||REQUIRED|||-NONE-|||0"]
    return "S " + " ".join(t.text for t in source) + "\n" + "\n".join(annotations) + "\n\n"


def sample_dev(rows, tokenizer, max_length, target_length, per_group, seed=2026):
    valid = [r for r in rows if len(tokenizer(r["text"])["input_ids"]) <= max_length
             and len(tokenizer(text_target=r["corrected_text"])["input_ids"]) <= target_length]
    rng = random.Random(seed)
    groups = {}
    for name, edited in (("requires_edit", True), ("already_correct", False)):
        candidates = [r for r in valid if (r["text"] != r["corrected_text"]) == edited]
        if len(candidates) < per_group:
            raise ValueError(f"Not enough {name} dev examples: need {per_group}, found {len(candidates)}")
        groups[name] = rng.sample(candidates, per_group)
    return groups


def score_model(model, tokenizer, groups, device, dtype, target_length, batch_size, annotator, output, seed=2026):
    import torch
    output.mkdir(parents=True, exist_ok=False)
    rows, predictions, counts = [], [], {}
    was_training = model.training
    model.eval()
    try:
        for name, examples in groups.items():
            unchanged = exact = incomplete = 0
            for start in range(0, len(examples), batch_size):
                batch = examples[start:start + batch_size]
                inputs = tokenizer([r["text"] for r in batch], padding=True, return_tensors="pt").to(device)
                with torch.inference_mode(), torch.autocast(device, dtype=torch.bfloat16, enabled=dtype == torch.bfloat16):
                    generated = model.generate(**inputs, do_sample=False, use_cache=True, max_new_tokens=target_length)
                for row, ids in zip(batch, generated, strict=True):
                    prediction = " ".join(tokenizer.decode(ids, skip_special_tokens=True).split())
                    completed = tokenizer.eos_token_id in ids.tolist()
                    incomplete += not completed
                    if not completed or not prediction:
                        # Raw-model benchmark fallback only. Application guards are evaluated separately.
                        prediction = row["text"]
                    unchanged += prediction == " ".join(row["text"].split())
                    exact += prediction == " ".join(row["corrected_text"].split())
                    rows.append(row)
                    predictions.append(prediction)
            counts[name] = dict(n=len(examples), left_input_unchanged=unchanged,
                                exact_reference_match=exact, incomplete_generations=incomplete)
        refs, hyps = [], []
        for row, prediction in zip(rows, predictions, strict=True):
            for destination, corrected in ((refs, row["corrected_text"]), (hyps, prediction)):
                destination.append(m2_block(annotator, row["text"], corrected))
        ref, hyp = output / "reference.m2", output / "hypothesis.m2"
        ref.write_text("".join(refs), encoding="utf-8")
        hyp.write_text("".join(hyps), encoding="utf-8")
        result = subprocess.run([sys.executable, "-m", "errant.commands.compare_m2", "-hyp", str(hyp), "-ref", str(ref)],
                                capture_output=True, text=True, encoding="utf-8", check=True)
        (output / "errant.txt").write_text(result.stdout, encoding="utf-8")
        values = next(line.split() for line in result.stdout.splitlines()
                      if len(line.split()) == 6 and all(x.isdigit() for x in line.split()[:3]))
        tp, fp, fn = map(int, values[:3])
        denominator = 1.25 * tp + fp + .25 * fn
        metrics = {"precision": tp / (tp + fp) if tp + fp else 0,
                   "recall": tp / (tp + fn) if tp + fn else 0,
                   "f05": 1.25 * tp / denominator if denominator else 0,
                   "tp": tp, "fp": fp, "fn": fn}
        report = {"kind": "balanced_dev_diagnostic_with_ERRANT_not_full_dev_or_test", "seed": seed,
                  "scoring_protocol": ERRANT_PROTOCOL,
                  "groups": counts, "metrics": metrics, "sample_ids": [r["id"] for r in rows],
                  "device": device, "precision": str(dtype), "batch_size": batch_size, "errant_output": result.stdout}
        report["versions"] = {name: importlib.metadata.version(name) for name in ("errant", "spacy", "en_core_web_sm")}
        report["generation"] = {"do_sample": False, "max_new_tokens": target_length}
        report["postprocessing"] = {"empty_or_incomplete": "keep_source", "application_safety_guards": False}
        (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    finally:
        model.train(was_training)


def make_generation_callback(rows, tokenizer, length, target_length, per_group, batch_size, device, dtype, output, seed=2026):
    import errant
    from transformers import TrainerCallback
    groups = sample_dev(rows, tokenizer, length, target_length, per_group, seed=seed)
    annotator = errant.load("en")

    class GenerationCallback(TrainerCallback):
        trainer = None

        def on_evaluate(self, args, state, control, metrics=None, model=None, **kwargs):
            directory = output / "evaluation" / f"step-{state.global_step}-{time.time_ns()}"
            report = score_model(model, tokenizer, groups, device, dtype, target_length, batch_size, annotator, directory, seed=seed)
            added = {f"eval_gec_{key}": value for key, value in report["metrics"].items()}
            metrics.update(added)
            snapshot = dict(metrics, epoch=state.epoch)
            (output / "evaluation" / f"metrics-step-{state.global_step}.json").write_text(
                json.dumps(snapshot, indent=2), encoding="utf-8")
            self.trainer.log(added)

    return GenerationCallback()


def make_periodic_checkpoint_callback(steps):
    from transformers import TrainerCallback

    class PeriodicCheckpoint(TrainerCallback):
        def on_step_end(self, args, state, control, **kwargs):
            if state.global_step % steps == 0:
                control.should_save = True

    return PeriodicCheckpoint()
