"""Measure the optional local feedback worker on 30 self-authored essays.

No Cambridge text, training, prompt tuning, automatic feature enabling, or
pedagogical certification. Real requests require the explicit --measure flag.
Full responses are written only to the fresh local output directory.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re
import sys
import time

from data import ROOT
from local_feedback import (
    CONTEXT_TOKENS, OUTPUT_TOKENS, PROMPT_VERSION, REQUEST_SECONDS,
    FeedbackEngine, FeedbackUnavailable, LlamaRuntime, load_manifest, validate_feedback,
)

FIXTURES = ROOT / "examples/feedback-benchmark.jsonl"
WARMUP_TEXT = (
    "I usually spend a few minutes planning my work before I open my computer. "
    "I write down the most important task and divide it into two smaller steps. "
    "This helps me begin even when the whole assignment looks difficult. "
    "After finishing the first step, I take a short break and check whether my plan still makes sense. "
    "Sometimes I need to change the order because another task has become urgent. "
    "The plan is only a guide, but it gives my morning a clear direction and keeps small distractions from taking all my time."
)


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_cases(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if len(rows) != 30:
        raise ValueError("Exactly 30 self-authored benchmark cases are required")
    ids, texts = set(), set()
    for row in rows:
        if set(row) != {"id", "topic", "text", "errors"} or not isinstance(row["id"], str) or not row["id"]:
            raise ValueError("Invalid fixture shape")
        if row["id"] in ids or not isinstance(row["text"], str) or row["text"] in texts:
            raise ValueError("Benchmark cases must have unique IDs and essays")
        if not 80 <= len(row["text"].split()) <= 150:
            raise ValueError("Every benchmark essay must contain 80–150 words")
        if row["topic"] is not None and (not isinstance(row["topic"], str) or not row["topic"].strip() or len(row["topic"]) > 500):
            raise ValueError("Invalid fixture topic")
        if not isinstance(row["errors"], list) or len(row["errors"]) > 20:
            raise ValueError("Invalid fixture suggestions")
        for error in row["errors"]:
            if not isinstance(error, dict) or set(error) != {"original", "suggestion"}:
                raise ValueError("Invalid hand-established accepted suggestion")
            if not isinstance(error["original"], str) or not error["original"] or error["original"] not in row["text"]:
                raise ValueError("Fixture suggestion must quote the actual original")
            if not isinstance(error["suggestion"], str) or not error["suggestion"] or error["suggestion"] == error["original"]:
                raise ValueError("Fixture suggestion must be a real, nonempty change")
        ids.add(row["id"])
        texts.add(row["text"])
    return rows


def _reason(error: BaseException) -> str:
    if isinstance(error, FeedbackUnavailable) and len(error.args) == 1 and re.fullmatch(r"[a-z_]{1,80}", str(error.args[0])):
        return str(error.args[0])
    return type(error).__name__


class ObservedRuntime(LlamaRuntime):
    """Observe this benchmark's worker without changing prompts or generation."""

    def __init__(self, manifest):
        super().__init__(manifest)
        self.last_payload = None
        self.last_failure = None

    def reset_observation(self):
        self.last_payload = None
        self.last_failure = None

    def generate(self, messages, deadline):
        try:
            self.last_payload = super().generate(messages, deadline)
            return self.last_payload
        except Exception as error:
            self.last_failure = _reason(error)
            raise


def failure_reason(runtime: ObservedRuntime, case: dict, response: dict) -> str | None:
    if response.get("status") == "ready":
        return None
    if runtime.last_failure:
        return runtime.last_failure
    if runtime.last_payload is not None:
        try:
            validate_feedback(runtime.last_payload, case["text"], case["topic"], case["errors"])
        except Exception as error:
            return _reason(error)
    return "engine_unavailable"


def summarize(records: list[dict], *, cold_startup_seconds: float) -> dict:
    durations = [r["durationSeconds"] for r in records]
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in durations):
        raise ValueError("Durations must be finite nonnegative seconds")
    ordered = sorted(durations)
    maximum = max(ordered, default=0.0)
    p95 = ordered[math.ceil(.95 * len(ordered)) - 1] if ordered else None
    ready = sum(r["response"].get("status") == "ready" for r in records)
    all_warm = all(r.get("runtimeWarmBefore") is True for r in records)
    return {
        "cases": len(records), "readyCount": ready, "maxSeconds": maximum,
        "p95Seconds": p95, "p95Method": "nearest rank ceil(0.95*n)",
        "coldStartupSeconds": cold_startup_seconds,
        "allMeasuredRequestsStartedWarm": all_warm,
        "technical_gate_passed": len(records) == 30 and ready >= 27 and maximum <= 30 and all_warm,
        "readyMinimum": 27, "requestSecondsMaximum": 30,
        "failureReasons": dict(Counter(r["reason"] for r in records if r.get("reason"))),
        "successfuldoesnotmeanpedagogyvalidated": True,
        "pedagogyValidated": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Fresh private output directory")
    parser.add_argument("--manifest", required=True, type=Path, help="Pinned local model/runtime manifest")
    parser.add_argument("--fixtures", type=Path, default=FIXTURES)
    parser.add_argument("--measure", action="store_true", help="Actually start the local CPU worker and make 30 requests")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output directory already exists; do not overwrite a benchmark")
    fixtures = args.fixtures.resolve()
    rows = load_cases(fixtures)
    pins = {"fixtureSha256": sha(fixtures), "manifestSha256": sha(args.manifest),
            "feedbackSourceSha256": sha(ROOT / "local_feedback.py"),
            "benchmarkSourceSha256": sha(Path(__file__))}
    if not args.measure:
        print(json.dumps({"status": "preflight_only_no_worker_started", "cases": len(rows), **pins}))
        return

    # Verify every payload before launching anything; hash-validation overhead
    # is not hidden inside the warm request measurements.
    manifest_started = time.perf_counter()
    manifest = load_manifest(args.manifest.resolve())
    manifest_load_seconds = time.perf_counter() - manifest_started
    args.output.mkdir(parents=True, exist_ok=False)
    runtime = ObservedRuntime(manifest)
    engine = FeedbackEngine(runtime, configured=True)
    records, warmups = [], []
    cold_startup_seconds = 0.0
    measured_started = datetime.now(timezone.utc).isoformat()
    try:
        started = time.perf_counter()
        startup_error = None
        try:
            engine.warmup(timeout=REQUEST_SECONDS)
        except Exception as error:
            startup_error = _reason(error)
        cold_startup_seconds = time.perf_counter() - started
        warmups.append({"phase": "initial_runtime_startup", "seconds": cold_startup_seconds,
                        "ready": runtime.ready, "reason": startup_error})
        # Prime normal prompt evaluation/generation separately, using a case
        # outside the measured 30; its result never changes the configuration.
        if runtime.ready:
            started = time.perf_counter()
            response = engine.analyze(WARMUP_TEXT, "Explain a useful planning habit.", [])
            warmups.append({"phase": "unmeasured_generation", "seconds": time.perf_counter() - started,
                            "response": response})
        with (args.output / "cases.jsonl").open("x", encoding="utf-8") as stream:
            for index, case in enumerate(rows, 1):
                recovery_seconds, recovery_error = 0.0, None
                if not runtime.ready:
                    started = time.perf_counter()
                    try:
                        engine.warmup(timeout=REQUEST_SECONDS)
                    except Exception as error:
                        recovery_error = _reason(error)
                    recovery_seconds = time.perf_counter() - started
                runtime.reset_observation()
                was_warm = runtime.ready
                started = time.perf_counter()
                response = engine.analyze(case["text"], case["topic"], case["errors"])
                elapsed = time.perf_counter() - started
                record = {**case, "wordCount": len(case["text"].split()), "durationSeconds": elapsed,
                          "runtimeWarmBefore": was_warm, "recoveryStartupSeconds": recovery_seconds,
                          "recoveryStartupReason": recovery_error, "response": response,
                          "reason": failure_reason(runtime, case, response),
                          "rawCompletion": runtime.last_payload}
                records.append(record)
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                print(json.dumps({"case": index, "id": case["id"], "status": response["status"],
                                  "seconds": round(elapsed, 3), "reason": record["reason"]}), flush=True)
    finally:
        engine.close()

    if pins != {"fixtureSha256": sha(fixtures), "manifestSha256": sha(args.manifest),
                "feedbackSourceSha256": sha(ROOT / "local_feedback.py"),
                "benchmarkSourceSha256": sha(Path(__file__))}:
        raise ValueError("Benchmark inputs or source changed during measurement")
    report = {
        "kind": "self_authored_local_feedback_operational_benchmark_not_semantic_acceptance",
        "startedUtc": measured_started, "finishedUtc": datetime.now(timezone.utc).isoformat(),
        **summarize(records, cold_startup_seconds=cold_startup_seconds), **pins,
        "modelId": manifest["modelId"], "modelSha256": manifest["modelSha256"],
        "modelRevision": manifest["modelRevision"], "runtimeVersion": manifest["runtimeVersion"],
        "runtimeSha256": manifest["runtimeSha256"], "promptVersion": PROMPT_VERSION,
        "settings": {"contextTokens": CONTEXT_TOKENS, "outputTokens": OUTPUT_TOKENS,
                     "engineDeadlineSeconds": REQUEST_SECONDS, "temperature": 0,
                     "device": "cpu", "concurrency": 1},
        "versions": {"python": platform.python_version(), "httpx": importlib.metadata.version("httpx")},
        "manifestVerificationSeconds": manifest_load_seconds,
        "fixturePath": str(fixtures), "manifestPath": str(args.manifest.resolve()),
        "warmups": warmups,
        "automaticFeatureEnabling": False,
        "limitations": ["All 30 English essays were authored specifically for this operational check, not taken from Cambridge.",
                       "Three accepted grammar changes were hand-established for diagnostics, not certified teacher annotations.",
                       "A ready response passed structural/grounding checks, not an independent evaluation of educational correctness.",
                       "Startup, unmeasured generation and recovery startup are reported separately from warm-request timing.",
                       "No training, model promotion, prompt search, or automatic retry within a measured request occurred."],
    }
    (args.output / "benchmark.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("cases", "readyCount", "maxSeconds", "p95Seconds", "technical_gate_passed")}))


if __name__ == "__main__":
    main()
