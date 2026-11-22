"""Re-score the served GEC pipeline offline from saved raw model outputs.

``evaluate_gec_pipeline.py --save-raw`` keeps every raw ByT5 output. This script
replays ``WritingEngine.analyze`` with those outputs instead of the model, so a
change to post-editing or the guard can be scored in minutes on CPU. Rules can be
switched off one at a time (ablation), and the dev rows can be split into two
fixed halves by id: choose on half ``a``, confirm once on half ``b``.

Outputs contain corpus-derived text and stay private (``.cache``), like the
evaluator's own outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import threading
from pathlib import Path

from data import ROOT, read_jsonl
from evaluate_gec_pipeline import _FixedCefr, score
from gec_evaluation import ERRANT_PROTOCOL

DROP_RULES = ("nonword", "article_deletion", "content_deletion", "pronoun_deletion", "transport_article",
              "leading_preposition", "plural_subject", "word_substitution", "content_insertion")
FIX_RULES = ("irregular_past", "much_less")


class CachedAdapter:
    """Stands in for inference.Adapter: returns the saved raw output for each sentence."""
    def __init__(self, raw: dict, run_name=None, adapter_sha256=None):
        self.raw, self.run_name, self.adapter_sha256 = raw, run_name, adapter_sha256
        self.manifest = {}

    def correct(self, text):
        from inference import IncompleteGenerationError
        if text not in self.raw:
            raise KeyError(f"No saved raw output for sentence: {text[:60]!r}")
        if self.raw[text] is None:
            raise IncompleteGenerationError("saved as incomplete")
        return self.raw[text]


def half_of(row_id: str) -> str:
    return "a" if hashlib.sha256(str(row_id).encode("utf-8")).digest()[0] % 2 == 0 else "b"


def load_groups(report: dict, dev_rows: list, half: str) -> dict:
    by_id = {str(row["id"]): row for row in dev_rows}
    groups = {"requires_edit": [], "already_correct": []}
    for row_id in report["sample_ids"]:
        row = by_id[str(row_id)]
        if half != "all" and half_of(row_id) != half:
            continue
        groups["requires_edit" if row["text"] != row["corrected_text"] else "already_correct"].append(row)
    return groups


def configure(disabled: set[str]):
    """Switch rules off in the imported modules; returns nothing, mutates module state for this process."""
    import gec_postedit
    unknown = disabled - set(DROP_RULES) - set(FIX_RULES)
    if unknown:
        raise ValueError(f"Unknown rules: {sorted(unknown)}")
    original_risk = gec_postedit._risk

    def risk(*args, **kwargs):
        reason = original_risk(*args, **kwargs)
        return None if reason in disabled else reason

    gec_postedit._risk = risk
    gec_postedit.RULE_FIXES = frozenset(set(FIX_RULES) - disabled)


def build_engine(raw: dict, report: dict):
    import spacy
    from inference import WritingEngine
    engine = object.__new__(WritingEngine)
    engine.cefr = _FixedCefr()
    engine.gec = CachedAdapter(raw, report.get("run"), report.get("adapter_sha256"))
    engine.nlp = spacy.blank("en")
    engine.nlp.add_pipe("sentencizer")
    engine.lock = threading.Lock()
    return engine


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--eval-dir", type=Path, required=True, help="Output of evaluate_gec_pipeline.py --save-raw")
    parser.add_argument("--dev-file", type=Path, default=ROOT / "data" / "prepared-first-final" / "gec-dev.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--disable", action="append", default=[], choices=DROP_RULES + FIX_RULES,
                        help="Switch one rule off; repeat for several")
    parser.add_argument("--half", choices=("all", "a", "b"), default="all")
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.error("Output directory already exists")
    report = json.loads((args.eval_dir / "report.json").read_text(encoding="utf-8"))
    raw = {}
    with (args.eval_dir / "raw-outputs.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            item = json.loads(line)
            raw[item["input"]] = item["output"]
    configure(set(args.disable))
    groups = load_groups(report, read_jsonl(args.dev_file), args.half)
    result = score(groups, build_engine(raw, report), 1, args.output)
    result.update({"kind": "offline_postedit_rescore_dev_not_test", "source_eval": str(args.eval_dir),
                   "run": report.get("run"), "adapter_sha256": report.get("adapter_sha256"),
                   "disabled": sorted(args.disable), "half": args.half, "scoring_protocol": ERRANT_PROTOCOL})
    (args.output / "report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("metrics", "groups", "coverage", "disabled", "half")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
