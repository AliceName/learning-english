"""Generate a fixed balanced dev diagnostic and score edits with ERRANT 3.0.2.

This selected sample is not the full dev set and must not be reported as test accuracy.
All sentences, references and outputs stay inside the private output directory.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import random
import subprocess
import sys
from pathlib import Path

from data import ROOT, read_jsonl, validate_splits
from gec_evaluation import ERRANT_PROTOCOL, m2_block

os.environ.setdefault("HF_HOME", str(ROOT / ".cache/huggingface"))
os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "true")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-group", type=int, default=128)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args()
    if args.per_group < 1 or args.batch_size < 1:
        parser.error("Sample count and batch size must be positive")
    if args.output.exists():
        parser.error("Output directory already exists")
    manifest = json.loads((args.run / "run.json").read_text(encoding="utf-8"))
    if not manifest.get("completed") or manifest["kind"] != "training" or manifest["task"] != "gec":
        parser.error("A completed full GEC run is required")
    parts = {}
    for split in ("train", "dev"):
        path = Path(manifest["data_files"][split])
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != manifest["data_sha256"][split]:
                raise ValueError("Training data changed after model fitting")
        parts[split] = read_jsonl(path)
    validate_splits(parts, "gec")
    import torch
    import errant
    from peft import PeftModel
    from transformers import AutoTokenizer
    from modeling import load_base
    device = args.device if args.device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
    if device == "cpu":
        torch.set_num_threads(2)
    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(args.run / "best", use_fast=False)
    model = PeftModel.from_pretrained(load_base(manifest["model_id"], "gec", dtype,
                                               revision=manifest.get("base_revision")), args.run / "best")
    model.to(device).eval()
    model.config.use_cache = True
    valid = [r for r in parts["dev"] if len(tokenizer(r["text"])["input_ids"]) <= manifest["max_input_length"]
             and len(tokenizer(text_target=r["corrected_text"])["input_ids"]) <= manifest["max_target_length"]]
    rng = random.Random(args.seed)
    groups = {"requires_edit": rng.sample([r for r in valid if r["text"] != r["corrected_text"]], args.per_group),
              "already_correct": rng.sample([r for r in valid if r["text"] == r["corrected_text"]], args.per_group)}
    args.output.mkdir(parents=True)
    rows, predictions, report_groups = [], [], {}
    for name, examples in groups.items():
        unchanged = exact = incomplete = 0
        for start in range(0, len(examples), args.batch_size):
            batch = examples[start:start + args.batch_size]
            inputs = tokenizer([r["text"] for r in batch], padding=True, return_tensors="pt").to(device)
            with torch.inference_mode(), torch.autocast(device, dtype=torch.bfloat16, enabled=dtype == torch.bfloat16):
                generated = model.generate(**inputs, do_sample=False, max_new_tokens=manifest["max_target_length"])
            for row, ids in zip(batch, generated, strict=True):
                output = " ".join(tokenizer.decode(ids, skip_special_tokens=True).split())
                completed = tokenizer.eos_token_id in ids.tolist()
                incomplete += not completed
                if not completed or not output:
                    output = row["text"]
                unchanged += output == " ".join(row["text"].split())
                exact += output == " ".join(row["corrected_text"].split())
                rows.append(row)
                predictions.append(output)
        report_groups[name] = {"n": len(examples), "left_input_unchanged": unchanged,
                               "exact_reference_match": exact, "incomplete_generations": incomplete}
        print(json.dumps({name: report_groups[name]}), flush=True)
    # Identical word-tokenised source/reference/hypothesis for both compared models.
    annotator = errant.load("en")
    reference, hypothesis = [], []
    for row, prediction in zip(rows, predictions, strict=True):
        for target, value in ((reference, row["corrected_text"]), (hypothesis, prediction)):
            target.append(m2_block(annotator, row["text"], value))
    reference_path, hypothesis_path = args.output / "reference.m2", args.output / "hypothesis.m2"
    reference_path.write_text("".join(reference), encoding="utf-8")
    hypothesis_path.write_text("".join(hypothesis), encoding="utf-8")
    command = [sys.executable, "-m", "errant.commands.compare_m2", "-hyp", str(hypothesis_path), "-ref", str(reference_path)]
    comparison = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=True)
    (args.output / "errant.txt").write_text(comparison.stdout, encoding="utf-8")
    report = {"kind": "balanced_dev_diagnostic_with_ERRANT_not_full_dev_or_test", "seed": args.seed,
              "scoring_protocol": ERRANT_PROTOCOL,
              "run": args.run.name, "device": device, "precision": str(dtype),
              "batch_size": args.batch_size, "generation": "greedy",
              "per_group": args.per_group, "groups": report_groups,
              "errant_version": importlib.metadata.version("errant"),
              "spacy_version": importlib.metadata.version("spacy"),
              "spacy_model_version": importlib.metadata.version("en_core_web_sm"),
              "sample_ids": [r["id"] for r in rows], "errant_output": comparison.stdout}
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(comparison.stdout, flush=True)


if __name__ == "__main__":
    main()
