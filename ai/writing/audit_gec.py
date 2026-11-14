"""Compare the frozen adapter's input pipelines on a private, fixed dev sample.

Never reads test references or modifies a model. ERRANT tokenises raw English
before extracting edits; this protocol differs from legacy whitespace scoring.
"""
import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import random
import re
import subprocess
import sys
import time

from data import ROOT, read_jsonl
from gec_data_paths import verified_data_paths
from gec_evaluation import ERRANT_PROTOCOL as PROTOCOL, m2_block

os.environ.setdefault("HF_HOME", str(ROOT / ".cache/huggingface"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

def metrics(tp, fp, fn):
    denominator = 1.25 * tp + fp + .25 * fn
    return dict(tp=tp, fp=fp, fn=fn, precision=tp / (tp + fp) if tp + fp else 0,
                recall=tp / (tp + fn) if tp + fn else 0,
                f05=1.25 * tp / denominator if denominator else 0)

def score_files(hyp, ref, output):
    result = subprocess.run([sys.executable, "-m", "errant.commands.compare_m2", "-hyp", str(hyp),
                             "-ref", str(ref), "-cat", "3"], capture_output=True, text=True,
                            encoding="utf-8", check=True)
    output.write_text(result.stdout, encoding="utf-8")
    overall, categories = None, {}
    for line in result.stdout.splitlines():
        values = line.split()
        if len(values) == 6 and all(x.isdigit() for x in values[:3]):
            overall = metrics(*map(int, values[:3]))
        elif len(values) == 7 and all(x.isdigit() for x in values[1:4]):
            categories[values[0]] = metrics(*map(int, values[1:4]))
    if overall is None:
        raise ValueError("Could not parse ERRANT counts")
    return dict(overall=overall, categories=categories)

def legacy_output(text, detokenizer):
    text = detokenizer.detokenize(text.split())
    return re.sub(r"\b(do|does|did|is|are|was|were|has|have|had|ca|could|wo|would|should|must|need|dare|sha|ai|might|may)\s+n\s*(['’])t\b",
                  r"\1n\2t", text, flags=re.IGNORECASE)

def choose_sample(valid, size, seed, sample_file=None):
    if sample_file is None:
        return list(valid) if size >= len(valid) else random.Random(seed).sample(valid, size)
    selected = read_jsonl(sample_file)
    by_id = {r['id']: r for r in valid}
    if len({r['id'] for r in selected}) != len(selected) or any(by_id.get(r['id']) != r for r in selected):
        raise ValueError('Fixed sample must contain unique, unchanged, eligible development rows')
    return selected


def rescore_existing(directory):
    """Recompute scores from saved generations, without loading GPU weights."""
    import errant
    report_path = directory / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    selected = read_jsonl(directory / "sample.jsonl")
    if [r["id"] for r in selected] != report["sample_ids"]:
        raise ValueError("Saved audit sample differs from its manifest")
    annotator = errant.load("en")
    ref = directory / "reference.m2"
    ref.write_text("".join(m2_block(annotator, r["text"], r["corrected_text"]) for r in selected), encoding="utf-8")
    for pipeline, value in report["pipelines"].items():
        predictions = read_jsonl(directory / f"{pipeline}-predictions.jsonl")
        if [r["id"] for r in predictions] != report["sample_ids"]:
            raise ValueError("Incomplete or misaligned saved predictions")
        hyp = directory / f"{pipeline}.m2"
        hyp.write_text("".join(m2_block(annotator, r["text"], pred["prediction"]) for r, pred in zip(selected, predictions, strict=True)), encoding="utf-8")
        value.update(score_files(hyp, ref, directory / f"{pipeline}-errant.txt"))
    report["protocol"] = PROTOCOL
    report["scoring_whitespace"] = "collapse whitespace before spaCy tokenisation; preserve text for generation"
    report["scoring_source_sha256"] = hashlib.sha256((ROOT / "gec_evaluation.py").read_bytes()).hexdigest()
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v["overall"] for k, v in report["pipelines"].items()}), flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run", type=Path, required=True)
    p.add_argument("--data-root", type=Path, help="Find the manifest's train and dev filenames under this directory")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--sample-size", type=int, default=1024)
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--seed", type=int, default=20261025)
    p.add_argument("--sample-file", type=Path, help="Reuse an exact ordered dev sample, including identical batch composition")
    p.add_argument("--pipelines", nargs="+", choices=("raw", "legacy_spacy"), default=["raw", "legacy_spacy"])
    p.add_argument("--rescore", action="store_true", help="Rescore complete saved generations; no GPU load")
    p.add_argument("--allow-experiment", action="store_true", help="Offline-only opt-in for completed integrity-checked experiments")
    args = p.parse_args()
    if args.rescore:
        if args.data_root is not None:
            p.error("--data-root applies to fresh evaluations, not --rescore")
        rescore_existing(args.output)
        return
    if args.sample_size < 1 or args.batch_size < 1 or args.output.exists():
        p.error("Use positive sizes and a fresh output directory")
    from training_state import validate_loadable_run
    try:
        if args.data_root is not None and args.allow_experiment:
            # Experiment loading validates all recorded paths again inside Adapter.
            kind = json.loads((args.run / "run.json").read_text(encoding="utf-8")).get("kind")
            if kind == "experiment":
                p.error("--data-root supports completed training runs; experiment integrity checks use recorded paths")
        manifest = validate_loadable_run(args.run, "gec", allow_experiment=args.allow_experiment)
        splits = ("train", "dev") if args.data_root is not None else ("dev",)
        dev_path = verified_data_paths(manifest, splits, args.data_root)["dev"]
    except (ValueError, OSError) as error:
        p.error(str(error))
    import torch
    import errant
    import spacy
    from sacremoses import MosesDetokenizer
    from inference import Adapter
    torch.set_num_threads(2)
    adapter = Adapter(args.run, "gec", "cuda", allow_experiment=args.allow_experiment)
    tokenizer, model = adapter.tokenizer, adapter.model
    rows = read_jsonl(dev_path)
    valid = [r for r in rows if len(tokenizer(r["text"])["input_ids"]) <= manifest["max_input_length"]
             and len(tokenizer(text_target=r["corrected_text"])["input_ids"]) <= manifest["max_target_length"]]
    selected = choose_sample(valid, args.sample_size, args.seed, args.sample_file)
    args.output.mkdir(parents=True)
    (args.output / "sample.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in selected), encoding="utf-8")
    annotator = errant.load("en")
    nlp = spacy.blank("en")
    detokenizer = MosesDetokenizer(lang="en")
    ref_path = args.output / "reference.m2"
    ref_path.write_text("".join(m2_block(annotator, r["text"], r["corrected_text"]) for r in selected), encoding="utf-8")
    report = {"protocol": PROTOCOL, "kind": "fixed_representative_dev_sample_not_test",
              "run": str(args.run.resolve()), "seed": args.seed, "batch_size": args.batch_size,
              "adapter_sha256": hashlib.sha256((args.run / "best/adapter_model.safetensors").read_bytes()).hexdigest(),
              "dev_sha256": manifest["data_sha256"]["dev"], "available_dev": len(rows), "eligible_dev": len(valid),
              "sample_ids": [r["id"] for r in selected],
              "sample_sha256": hashlib.sha256((args.output / "sample.jsonl").read_bytes()).hexdigest(),
              "device": "cuda", "precision": str(adapter.dtype),
              "generation": {"do_sample": False, "use_cache": True, "max_new_tokens": manifest["max_target_length"]},
              "postprocessing": {"empty_or_incomplete": "keep_source", "application_safety_guards": False},
              "fixed_sample_file": str(args.sample_file.resolve()) if args.sample_file else None,
              "sample_groups": dict(Counter("requires_edit" if r["text"] != r["corrected_text"] else "already_correct" for r in selected)),
              "versions": {v: importlib.metadata.version(v) for v in ("torch", "transformers", "peft", "errant", "spacy", "en_core_web_sm")},
              "pipelines": {}, "limitations": ["One human correction per source; valid alternative edits may be penalised.",
                  "Error types are automatically extracted, not the official gold M2 annotations.",
                  "This dev sample is used for development, not an independent final test.",
                  "Legacy historical F0.5 values used a different whitespace-token protocol and are not directly comparable."]}
    for pipeline in args.pipelines:
        started = time.perf_counter()
        predictions, details = [], []
        counts = {g: Counter() for g in ("requires_edit", "already_correct")}
        texts = [r["text"] if pipeline == "raw" else " ".join(t.text for t in nlp(r["text"]) if not t.is_space) for r in selected]
        with (args.output / f"{pipeline}-predictions.jsonl").open("w", encoding="utf-8") as stream:
            for start in range(0, len(selected), args.batch_size):
                batch = selected[start:start + args.batch_size]
                batch_text = texts[start:start + args.batch_size]
                usable = [i for i, text in enumerate(batch_text) if len(tokenizer(text)["input_ids"]) <= manifest["max_input_length"]]
                generated = {}
                if usable:
                    inputs = tokenizer([batch_text[i] for i in usable], padding=True, return_tensors="pt").to("cuda")
                    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=adapter.dtype == torch.bfloat16):
                        ids = model.generate(**inputs, do_sample=False, use_cache=True, max_new_tokens=manifest["max_target_length"])
                    for i, tokens in zip(usable, ids, strict=True):
                        complete = tokenizer.eos_token_id in tokens.tolist()
                        value = tokenizer.decode(tokens, skip_special_tokens=True).strip()
                        generated[i] = (value, complete)
                for i, row in enumerate(batch):
                    value, complete = generated.get(i, (row["text"], False))
                    if i not in generated or not complete or not value:
                        prediction = row["text"]
                    elif pipeline == "legacy_spacy":
                        prediction = row["text"] if " ".join(value.split()) == " ".join(batch_text[i].split()) else legacy_output(value, detokenizer)
                    else:
                        prediction = value
                    group = "requires_edit" if row["text"] != row["corrected_text"] else "already_correct"
                    counts[group].update(n=1, unchanged=prediction == row["text"], exact_reference=prediction == row["corrected_text"],
                                         incomplete=not complete, over_budget=i not in generated)
                    detail = {"id": row["id"], "group": group, "text": row["text"], "reference": row["corrected_text"],
                              "prediction": prediction, "complete": complete, "input_over_budget": i not in generated,
                              "decoded_output": value}
                    stream.write(json.dumps(detail, ensure_ascii=False) + "\n")
                    predictions.append(prediction)
                if start % 128 == 0:
                    stream.flush()
                    print(json.dumps({"pipeline": pipeline, "generated": min(start + len(batch), len(selected)), "total": len(selected)}, ensure_ascii=False), flush=True)
        hyp_path = args.output / f"{pipeline}.m2"
        hyp_path.write_text("".join(m2_block(annotator, r["text"], pred) for r, pred in zip(selected, predictions, strict=True)), encoding="utf-8")
        scores = score_files(hyp_path, ref_path, args.output / f"{pipeline}-errant.txt")
        report["pipelines"][pipeline] = {**scores, "groups": {g: dict(c) for g, c in counts.items()}, "elapsed_seconds": time.perf_counter() - started,
                                          "transformed_input_count": sum(a != b["text"] for a, b in zip(texts, selected, strict=True))}
        (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"pipeline": pipeline, "overall": scores["overall"], "groups": report["pipelines"][pipeline]["groups"]}), flush=True)
    print("Saved private audit to", args.output / "report.json", flush=True)

if __name__ == "__main__":
    main()
