"""Score local LanguageTool, alone and combined with the GEC pipeline, on the fixed dev sample.

LanguageTool runs only as a local HTTP server started (and stopped) by this
script; no text leaves the machine. Its corrections are the first suggested
replacement of every non-overlapping match, excluding rule groups fixed before
any result was seen (style, typography, redundancy, plain English, casing
preferences). Modes:

* ``lt``           LanguageTool only
* ``lt-then-model`` LanguageTool output fed to the served pipeline
* ``model-then-lt`` served pipeline output fed to LanguageTool

The sample and ERRANT scoring are identical to evaluate_gec_pipeline.py.
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from data import ROOT, read_jsonl, validate_splits
from evaluate_gec_pipeline import build_engine, run_pipeline, score
from gec_evaluation import ERRANT_PROTOCOL, sample_dev

LT_DIR = ROOT / ".cache" / "languagetool" / "LanguageTool-6.6"
JAVA = r"C:\Program Files\Java\jdk-23\bin\java.exe"
EXCLUDED_CATEGORIES = frozenset({"STYLE", "TYPOGRAPHY", "REDUNDANCY", "PLAIN_ENGLISH", "CASING"})
EXCLUDED_ISSUES = frozenset({"style", "typographical", "locale-violation"})
SERVER_PROPERTIES = "maxTextLength=12000\nmaxCheckTimeMillis=8000\nmaxCheckThreads=1\ncacheSize=0\n"


def _utf16(text: str) -> bytes:
    return text.encode("utf-16-le")


def apply_matches(text: str, matches: list[dict], only_categories=None) -> tuple[str, Counter]:
    """Apply the first replacement of eligible, non-overlapping matches (LanguageTool UTF-16 offsets).

    `only_categories`, when given, keeps just those LanguageTool category ids (e.g. {"TYPOS"} for spelling only).
    """
    used, counts, chosen = [], Counter(), []
    for match in sorted(matches, key=lambda m: (m["offset"], m["length"])):
        rule = match.get("rule", {})
        category = rule.get("category", {}).get("id")
        if only_categories is not None and category not in only_categories:
            counts["not_selected"] += 1
            continue
        if category in EXCLUDED_CATEGORIES or rule.get("issueType") in EXCLUDED_ISSUES:
            counts["excluded_rule"] += 1
            continue
        if not match.get("replacements"):
            counts["no_replacement"] += 1
            continue
        start, end = match["offset"], match["offset"] + match["length"]
        if any(start < e and s < end or start == end == s for s, e in used):
            counts["overlap"] += 1
            continue
        used.append((start, end))
        chosen.append((start, end, match["replacements"][0]["value"]))
        counts["applied"] += 1
    data = _utf16(text)
    if any(end * 2 > len(data) for _, end, _ in chosen):
        raise ValueError("LanguageTool offset outside the text")
    for start, end, value in sorted(chosen, reverse=True):
        data = data[:2 * start] + _utf16(value) + data[2 * end:]
    return data.decode("utf-16-le"), counts


class LanguageToolServer:
    def __init__(self, port: int, language: str, lt_dir: Path = LT_DIR, java: str = JAVA, only_categories=None):
        self.port, self.language, self.lt_dir, self.java = port, language, Path(lt_dir), java
        self.only_categories = only_categories
        self.process = None

    def __enter__(self):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", self.port)) == 0:
                raise RuntimeError(f"Port {self.port} is already in use; nothing was stopped")
        self._config = tempfile.NamedTemporaryFile("w", suffix=".properties", delete=False)
        self._config.write(SERVER_PROPERTIES)
        self._config.close()
        self.process = subprocess.Popen(
            [self.java, "-Xmx768m", "-cp", str(self.lt_dir / "languagetool-server.jar"),
             "org.languagetool.server.HTTPServer", "--config", self._config.name, "--port", str(self.port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                self.check("This is a test.")
                return self
            except OSError:
                if self.process.poll() is not None:
                    raise RuntimeError("LanguageTool server exited during start-up")
                time.sleep(1)
        raise RuntimeError("LanguageTool server did not start")

    def __exit__(self, *_):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=30)
        Path(self._config.name).unlink(missing_ok=True)

    def check(self, text: str) -> list[dict]:
        body = urllib.parse.urlencode({"text": text, "language": self.language}).encode()
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}/v2/check", data=body)
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        if payload.get("warnings", {}).get("incompleteResults"):
            raise RuntimeError("LanguageTool returned incomplete results")
        return payload["matches"]

    def correct(self, text: str) -> tuple[str, Counter]:
        return apply_matches(text, self.check(text), self.only_categories)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", type=Path, required=True, help="GEC run: defines the dev sample and the hybrid model")
    parser.add_argument("--mode", choices=("lt", "lt-then-model", "model-then-lt"), required=True)
    parser.add_argument("--dev-file", type=Path, default=ROOT / "data" / "prepared-first-final" / "gec-dev.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-group", type=int, default=128)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--language", default="en-GB", help="W&I references use British spelling")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--only-categories", help="Comma-separated LanguageTool category ids to keep, e.g. TYPOS")
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.error("Output directory already exists")
    only = frozenset(c.strip() for c in args.only_categories.split(",") if c.strip()) if args.only_categories else None
    if args.only_categories is not None and not only:
        parser.error("--only-categories needs at least one category id")
    dev = read_jsonl(args.dev_file)
    validate_splits({"dev": dev}, "gec")
    import torch
    device = args.device if args.device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")
    engine = build_engine(args.run, device, 1)
    manifest = engine.gec.manifest
    groups = sample_dev(dev, engine.gec.tokenizer, manifest["max_input_length"], manifest["max_target_length"],
                        args.per_group, args.seed)
    lt_counts = Counter()
    with LanguageToolServer(args.port, args.language, only_categories=only) as server:
        def lt(text):
            corrected, counts = server.correct(text)
            lt_counts.update(counts)
            return corrected

        def correct(text):
            if args.mode == "lt":
                return lt(text), Counter(), "ok"
            if args.mode == "lt-then-model":
                return run_pipeline(engine, lt(text), 1)
            prediction, coverage, status = run_pipeline(engine, text, 1)
            return lt(prediction), coverage, status

        report = score(groups, engine, 1, args.output, correct=correct)
    report.update({"kind": "languagetool_balanced_dev_diagnostic_not_full_dev_or_test", "mode": args.mode,
                   "run": args.run.name, "adapter_sha256": engine.gec.adapter_sha256, "seed": args.seed,
                   "per_group": args.per_group, "language": args.language, "languagetool": LT_DIR.name,
                   "excluded_categories": sorted(EXCLUDED_CATEGORIES), "excluded_issue_types": sorted(EXCLUDED_ISSUES),
                   "only_categories": sorted(only) if only else None,
                   "languagetool_match_counts": dict(lt_counts), "scoring_protocol": ERRANT_PROTOCOL})
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("mode", "metrics", "languagetool_match_counts")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
