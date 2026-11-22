"""Score the served GEC pipeline (model + post-processing + safety guard) on the fixed dev sample.

Unlike evaluate_gec.py, which scores raw model output, this runs the same
``WritingEngine.analyze`` code path that the /writing page uses, so the guard,
sentence splitting and contraction repair are included. CEFR is stubbed out: it
does not affect corrections. Optional ``--passes`` and ``--num-beams`` are
offline experiments only; they do not change the serving configuration.

The sample is the same balanced dev diagnostic as evaluate_gec.py (same seed and
filter), so numbers are paired with the raw baseline. Outputs stay private.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import subprocess
import sys
import threading
from collections import Counter
from functools import partial
from pathlib import Path

from data import ROOT, read_jsonl, validate_splits
from gec_evaluation import ERRANT_PROTOCOL, m2_block, full_dev, sample_dev

os.environ.setdefault("HF_HOME", str(ROOT / ".cache/huggingface"))
os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "true")
os.environ.setdefault("HF_HUB_OFFLINE", "1")


class _FixedCefr:
    """CEFR is irrelevant to corrections; avoid loading DeBERTa."""
    run_name = adapter_sha256 = None
    manifest = {"max_input_length": 10 ** 9}

    def classify(self, text, prompt=None):
        return "B1"


def build_engine(run: Path, device: str, num_beams: int):
    import spacy
    from inference import Adapter, WritingEngine
    engine = object.__new__(WritingEngine)
    engine.cefr = _FixedCefr()
    engine.gec = Adapter(run, "gec", device)
    if num_beams > 1:
        engine.gec.model.generate = partial(engine.gec.model.generate, num_beams=num_beams)
    engine.nlp = spacy.blank("en")
    engine.nlp.add_pipe("sentencizer")
    engine.lock = threading.Lock()
    return engine


def record_raw(adapter) -> dict:
    """Wrap ``adapter.correct`` so every raw model output (None = incomplete) is kept for offline re-scoring."""
    from inference import IncompleteGenerationError
    raw, generate = {}, adapter.correct

    def correct(text):
        try:
            raw[text] = generate(text)
        except IncompleteGenerationError:
            raw[text] = None
            raise
        return raw[text]

    adapter.correct = correct
    return raw


def run_pipeline(engine, text: str, passes: int):
    """Return (prediction, coverage Counter, status) for one input, applying the pipeline `passes` times."""
    from inference import InputBudgetError
    current, coverage = text, Counter()
    for _ in range(passes):
        try:
            result = engine.analyze(current, corrections=True)
        except InputBudgetError:
            return current, coverage, "input_rejected" if current == text else "later_pass_rejected"
        coverage.update(result["gecCoverage"] or {})
        if result["correctedText"] is None or result["correctedText"] == current:
            break
        current = result["correctedText"]
    return current, coverage, "ok"


def score(groups, engine, passes, output: Path, errant_annotator=None, correct=None):
    """`correct(text) -> (prediction, coverage, status)` overrides the pipeline (used by hybrids)."""
    import errant
    annotator = errant_annotator or errant.load("en")
    correct = correct or (lambda text: run_pipeline(engine, text, passes))
    rows, predictions, report_groups, coverage_total, statuses = [], [], {}, Counter(), Counter()
    for name, examples in groups.items():
        changed = exact = 0
        for row in examples:
            prediction, coverage, status = correct(row["text"])
            statuses[status] += 1
            coverage_total.update(coverage)
            normalized = " ".join(prediction.split())
            changed += normalized != " ".join(row["text"].split())
            exact += normalized == " ".join(row["corrected_text"].split())
            rows.append(row)
            predictions.append(prediction)
        report_groups[name] = {"n": len(examples), "changed": changed, "exact_reference_match": exact}
        print(json.dumps({name: report_groups[name]}), flush=True)
    output.mkdir(parents=True)
    refs = [m2_block(annotator, r["text"], r["corrected_text"]) for r in rows]
    hyps = [m2_block(annotator, r["text"], p) for r, p in zip(rows, predictions, strict=True)]
    ref, hyp = output / "reference.m2", output / "hypothesis.m2"
    ref.write_text("".join(refs), encoding="utf-8")
    hyp.write_text("".join(hyps), encoding="utf-8")
    result = subprocess.run([sys.executable, "-m", "errant.commands.compare_m2", "-hyp", str(hyp), "-ref", str(ref)],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    values = next(line.split() for line in result.stdout.splitlines()
                  if len(line.split()) == 6 and all(x.isdigit() for x in line.split()[:3]))
    tp, fp, fn = map(int, values[:3])
    denominator = 1.25 * tp + fp + .25 * fn
    correct = report_groups.get("already_correct", {})
    metrics = {"precision": tp / (tp + fp) if tp + fp else 0.0, "recall": tp / (tp + fn) if tp + fn else 0.0,
               "f05": 1.25 * tp / denominator if denominator else 0.0, "tp": tp, "fp": fp, "fn": fn,
               "overcorrection_rate": correct["changed"] / correct["n"] if correct.get("n") else None}
    (output / "errant.txt").write_text(result.stdout, encoding="utf-8")
    return {"metrics": metrics, "groups": report_groups, "coverage": dict(coverage_total),
            "statuses": dict(statuses), "sample_ids": [r["id"] for r in rows], "errant_output": result.stdout}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--dev-file", type=Path, default=ROOT / "data" / "prepared-first-final" / "gec-dev.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-group", type=int, default=128)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--passes", type=int, default=1, help="Apply the full pipeline this many times")
    parser.add_argument("--num-beams", type=int, default=1)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--full-dev", action="store_true", help="Score every dev row that fits, not a balanced sample")
    parser.add_argument("--save-raw", action="store_true",
                        help="Also write raw-outputs.jsonl (private) so post-processing can be re-scored without the model")
    args = parser.parse_args(argv)
    if args.per_group < 1 or args.passes < 1 or args.num_beams < 1:
        parser.error("Sample count, passes and beams must be positive")
    if args.save_raw and args.passes != 1:
        parser.error("--save-raw supports one pass only")
    if args.output.exists():
        parser.error("Output directory already exists")
    dev = read_jsonl(args.dev_file)
    validate_splits({"dev": dev}, "gec")
    import torch
    device = args.device if args.device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
    engine = build_engine(args.run, device, args.num_beams)
    manifest = engine.gec.manifest
    skipped = 0
    if args.full_dev:
        groups, skipped = full_dev(dev, engine.gec.tokenizer, manifest["max_input_length"], manifest["max_target_length"])
    else:
        groups = sample_dev(dev, engine.gec.tokenizer, manifest["max_input_length"], manifest["max_target_length"],
                            args.per_group, args.seed)
    raw = record_raw(engine.gec) if args.save_raw else None
    report = score(groups, engine, args.passes, args.output)
    if raw is not None:
        with (args.output / "raw-outputs.jsonl").open("w", encoding="utf-8") as handle:
            for source, output in raw.items():
                handle.write(json.dumps({"input": source, "output": output}, ensure_ascii=False) + "\n")
    report.update({"kind": "served_pipeline_full_dev_not_test" if args.full_dev
                   else "served_pipeline_balanced_dev_diagnostic_not_full_dev_or_test",
                   "run": args.run.name, "adapter_sha256": engine.gec.adapter_sha256,
                   "seed": None if args.full_dev else args.seed, "dev_rows": len(dev), "skipped_too_long": skipped,
                   "per_group": None if args.full_dev else args.per_group, "passes": args.passes, "num_beams": args.num_beams,
                   "device": device, "scoring_protocol": ERRANT_PROTOCOL,
                   "versions": {name: importlib.metadata.version(name) for name in ("errant", "spacy", "en_core_web_sm")}})
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("metrics", "coverage", "statuses")}, indent=2), flush=True)
    print(report["errant_output"], flush=True)


if __name__ == "__main__":
    main()
