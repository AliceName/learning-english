"""Run one trained adapter locally; input comes from a UTF-8 file, not shell history."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from data import ROOT, LEVELS, read_jsonl, validate_splits
from modeling import classification_metrics, feedback_tokens, load_base

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "true")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--input", type=Path, help="UTF-8 essay; feedback task expects JSON with prompt/text/corrected_text")
    parser.add_argument("--evaluate-test", action="store_true", help="CEFR only, after model selection is finished")
    parser.add_argument("--output", type=Path, required=True, help="Private JSON file; do not publish corpus derivatives")
    args = parser.parse_args()
    if bool(args.input) == args.evaluate_test:
        parser.error("Choose exactly one of --input or --evaluate-test")
    if args.output.exists():
        parser.error("Output already exists; choose another file")
    manifest = json.loads((args.run / "run.json").read_text(encoding="utf-8"))
    if not manifest.get("completed"):
        parser.error("This training run did not finish successfully")
    task = manifest["task"]
    if args.evaluate_test and task != "cefr":
        parser.error("This archive has no GEC test references; use a separate reviewed feedback evaluation")
    import torch
    from peft import PeftModel
    from transformers import AutoTokenizer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    adapter_path = args.run / "best"
    tokenizer = AutoTokenizer.from_pretrained(adapter_path, use_fast=False)
    model = PeftModel.from_pretrained(load_base(manifest["model_id"], task, dtype,
                                               revision=manifest.get("base_revision")), adapter_path)
    model.to(device).eval()
    length = manifest["max_input_length"]

    def classify(text):
        inputs = tokenizer(text, return_tensors="pt", truncation=False)
        if inputs["input_ids"].shape[1] > length:
            raise ValueError("Essay exceeds the trained input budget; do not silently score only its prefix")
        with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16,
                                                    enabled=dtype == torch.bfloat16):
            logits = model(**inputs.to(device)).logits[0].float().cpu()
        return logits

    if args.evaluate_test:
        if manifest["kind"] == "smoke":
            parser.error("Do not use the held-out test to evaluate smoke runs")
        test_file = Path(manifest.get("held_out_file", Path(manifest["data_files"]["train"]).parent / "cefr-test.jsonl"))
        with test_file.open("rb") as stream:
            test_hash = hashlib.file_digest(stream, "sha256").hexdigest()
        if manifest.get("held_out_sha256") and manifest["held_out_sha256"] != test_hash:
            raise ValueError("Held-out test data changed after this run was fitted")
        rows = read_jsonl(test_file)
        training_parts = {}
        for split in ("train", "dev"):
            path = Path(manifest["data_files"][split])
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != manifest["data_sha256"][split]:
                    raise ValueError("Training data has changed since this checkpoint was fitted")
            training_parts[split] = read_jsonl(path)
        train, dev = training_parts["train"], training_parts["dev"]
        validate_splits({"train": train, "dev": dev, "test": rows}, "cefr")
        logits, labels = [], []
        skipped = 0
        for row in rows:
            if len(tokenizer(row["text"])["input_ids"]) > length:
                skipped += 1
                continue
            logits.append(classify(row["text"]).numpy())
            labels.append(LEVELS.index(row["cefr"]))
        import numpy as np
        if not labels:
            raise ValueError("No test essays fit the input budget")
        result = classification_metrics((np.array(logits), np.array(labels)))
        from sklearn.metrics import confusion_matrix
        result["label_order"] = list(LEVELS)
        result["confusion_matrix"] = confusion_matrix(labels, np.argmax(logits, axis=-1),
                                                      labels=list(range(len(LEVELS)))).tolist()
        majority = max(manifest["tokenization"]["train"]["labels"],
                       key=manifest["tokenization"]["train"]["labels"].get)
        baseline_logits = np.zeros((len(labels), len(LEVELS)))
        baseline_logits[:, LEVELS.index(majority)] = 1
        result["majority_baseline"] = classification_metrics((baseline_logits, np.array(labels)))
        result.update(evaluated=len(labels), over_length_skipped=skipped,
                      test_file=str(test_file.resolve()), test_sha256=test_hash)
    else:
        text = args.input.read_text(encoding="utf-8-sig")
        if not text.strip():
            parser.error("Input is empty")
        if task == "cefr":
            probabilities = classify(text).softmax(-1).tolist()
            result = {"cefr": LEVELS[max(range(len(LEVELS)), key=probabilities.__getitem__)],
                      "class_probabilities_uncalibrated": dict(zip(LEVELS, probabilities)),
                      "run_kind": manifest["kind"]}
        else:
            if task == "feedback":
                row = json.loads(text)
                inputs = feedback_tokens(row, tokenizer, length, training=False)
                inputs = {k: torch.tensor([v], device=device) for k, v in inputs.items()}
            else:
                inputs = tokenizer(text, return_tensors="pt", truncation=False).to(device)
                if inputs["input_ids"].shape[1] > length:
                    parser.error("ByT5 operates on bytes; provide a sentence within the input budget")
            with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16,
                                                        enabled=dtype == torch.bfloat16):
                generated = model.generate(**inputs, do_sample=False,
                                           max_new_tokens=manifest["max_target_length"],
                                           pad_token_id=tokenizer.pad_token_id)
            tokens = generated[0, inputs["input_ids"].shape[1]:] if task == "feedback" else generated[0]
            result = {"feedback" if task == "feedback" else "corrected_text":
                      tokenizer.decode(tokens, skip_special_tokens=True), "run_kind": manifest["kind"]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved private result to {args.output}")


if __name__ == "__main__":
    main()
