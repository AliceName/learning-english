"""Read-only CEFR load audit and opt-in development diagnostics via the existing local service.

Never scores test, changes a model, or starts an additional GPU model. Outputs omit essay text.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

from data import LEVELS


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def summarize(records):
    """Fixed six-band metrics; unsupported bands remain explicit, not hidden."""
    if not records:
        raise ValueError("No records to summarize")
    matrix = [[0] * len(LEVELS) for _ in LEVELS]
    distances = []
    for item in records:
        truth = LEVELS.index(item["reference"])
        predicted = LEVELS.index(item["predicted"])
        matrix[truth][predicted] += 1
        distances.append(abs(truth - predicted))
    n = len(records)
    per_class = {}
    f1s = []
    for i, label in enumerate(LEVELS):
        support = sum(matrix[i])
        predicted_count = sum(row[i] for row in matrix)
        tp = matrix[i][i]
        f1 = 2 * tp / (support + predicted_count) if support + predicted_count else 0.0
        f1s.append(f1)
        per_class[label] = {"support": support, "predicted": predicted_count,
                            "precision": tp / predicted_count if predicted_count else None,
                            "recall": tp / support if support else None, "f1": f1,
                            "assessment": "unsupported" if not support else "very small support" if support < 20 else "observed"}
    # Quadratic-weighted kappa is undefined if there is no marginal variance.
    observed = sum((i-j)**2 * matrix[i][j] for i in range(6) for j in range(6))
    expected = sum((i-j)**2 * sum(matrix[i]) * sum(row[j] for row in matrix) / n
                   for i in range(6) for j in range(6))
    return {"count": n, "accuracy": sum(matrix[i][i] for i in range(6)) / n,
            "macro_f1_fixed_six": sum(f1s) / 6,
            "mean_absolute_band_error": sum(distances) / n,
            "within_one_band": sum(d <= 1 for d in distances) / n,
            "two_or_more_band_errors": sum(d >= 2 for d in distances),
            "quadratic_weighted_kappa": 1-observed/expected if expected else None,
            "confusion_matrix": matrix, "label_order": list(LEVELS), "per_class": per_class}


def slices(records, key):
    groups = {}
    for item in records:
        groups.setdefault(str(item[key]), []).append(item)
    return {name: summarize(items) for name, items in sorted(groups.items())}


def service_request(route, payload=None):
    request = urllib.request.Request("http://127.0.0.1:8000" + route,
        data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def artifact_audit(run):
    from safetensors import safe_open
    manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
    if manifest.get("task") != "cefr" or not manifest.get("completed") or manifest.get("kind") != "training":
        raise ValueError("Requires a completed CEFR training run")
    if manifest.get("labels") != list(LEVELS):
        raise ValueError("Manifest label order differs")
    best = run / "best"
    config = json.loads((best / "adapter_config.json").read_text(encoding="utf-8"))
    required = {"base_model.model.classifier.weight": [6, 768],
                "base_model.model.classifier.bias": [6],
                "base_model.model.pooler.dense.weight": [768, 768],
                "base_model.model.pooler.dense.bias": [768]}
    head = {}
    with safe_open(best / "adapter_model.safetensors", framework="pt", device="cpu") as state:
        for key, shape in required.items():
            if key not in state.keys() or state.get_slice(key).get_shape() != shape:
                raise ValueError("Missing/incompatible saved classification head: " + key)
            values = state.get_tensor(key).float()
            if not values.isfinite().all():
                raise ValueError("Non-finite classifier tensor")
            head[key] = {"shape": shape, "finite": True, "l2_norm": float(values.norm())}
        tensor_count = len(list(state.keys()))
    if not {"classifier", "pooler"}.issubset(config.get("modules_to_save", [])):
        raise ValueError("Head modules are not configured for loading")
    if config.get("task_type") != "SEQ_CLS":
        raise ValueError("Adapter is not configured for sequence classification")
    hashes = {file.name: sha256(file) for file in best.iterdir() if file.is_file()}
    checkpoint = Path(manifest.get("best_checkpoint", "")) / "adapter_model.safetensors"
    selected_hash = sha256(checkpoint) if checkpoint.is_file() else None
    return manifest, {"run": run.name, "run_manifest_sha256": sha256(run / "run.json"),
        "artifact_sha256": hashes, "head_tensors": head, "tensor_count": tensor_count,
        "selected_checkpoint_sha256": selected_hash,
        "best_matches_selected_checkpoint": selected_hash == hashes["adapter_model.safetensors"] if selected_hash else None,
        "adapter_task_type": config.get("task_type"), "target_modules": config.get("target_modules"),
        "labels": list(LEVELS), "base_revision": manifest.get("base_revision"),
        "legacy_artifact_integrity_pinned": bool(manifest.get("artifact_sha256")),
        "stored_dev_metrics": manifest.get("dev_metrics"),
        "limitations": ["Head presence/shape/finite values do not alone verify loaded predictions.",
                         "Serving legacy full-training manifests do not enforce artifact hashes at load."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dev-service", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    manifest, audit = artifact_audit(args.run)
    (args.output / "load-audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    if not args.dev_service:
        return
    dev = Path(manifest["data_files"]["dev"])
    if sha256(dev) != manifest["data_sha256"]["dev"]:
        raise ValueError("Development data hash differs")
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.run / "best", use_fast=False, local_files_only=True)
    before = service_request("/health")
    if before.get("cefrRun") != args.run.name:
        raise ValueError("Service is not using the requested run")
    rows = [json.loads(line) for line in dev.read_text(encoding="utf-8").splitlines() if line.strip()]
    if any(row.get("split") != "dev" or row.get("label_source") != "human_final" for row in rows):
        raise ValueError("Only human-labeled dev examples may be scored")
    results, skipped = [], []
    started = time.monotonic()
    with (args.output / "dev-predictions.private.jsonl").open("x", encoding="utf-8") as stream:
        for index, row in enumerate(rows):
            text = row["text"]
            tokens = len(tokenizer(text, truncation=False)["input_ids"])
            if tokens > manifest["max_input_length"]:
                skipped.append({"index": index, "id": row["id"], "tokens": tokens})
                continue
            result = None
            for attempt in range(20):
                try:
                    result = service_request("/internal/writing/analyze", {"text": text, "corrections": False})
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 429:
                        raise
                    time.sleep(0.5)
            if result is None:
                raise RuntimeError("Service remained busy")
            if result.get("provenance", {}).get("cefrAdapterSha256") != audit["artifact_sha256"]["adapter_model.safetensors"]:
                raise ValueError("The serving adapter hash differs")
            item = {"index": index, "id": row["id"], "user_id": row["user_id"],
                    "prompt_id": row["prompt_id"], "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                    "reference": row["cefr"], "predicted": result["cefr"], "tokens": tokens,
                    "length_bin": "<=128" if tokens <=128 else "129-256" if tokens <=256 else "257-384" if tokens <=384 else "385-512"}
            results.append(item)
            stream.write(json.dumps(item) + "\n")
            stream.flush()
            if len(results) % 50 == 0:
                print(f"Development only: {len(results)}/{len(rows)}", flush=True)
    if sha256(dev) != manifest["data_sha256"]["dev"] or service_request("/health") != before:
        raise ValueError("Development data or serving configuration changed")
    report = {"kind": "development diagnostics, not held-out test", "health": before,
              "dev_sha256": sha256(dev), "adapter_sha256": audit["artifact_sha256"]["adapter_model.safetensors"],
              "scored": len(results), "skipped": skipped, "seconds": time.monotonic()-started,
              "overall": summarize(results), "by_token_length": slices(results, "length_bin"),
              "by_prompt": slices(results, "prompt_id"),
              "predicted_counts": dict(Counter(item["predicted"] for item in results)),
              "uncertainty": "Service emits a band only. No logits; no calibration or confidence claim.",
              "limitations": ["Same development set already used for checkpoint selection.",
                              "Slices can have tiny support; no independent prompt generalization claim."]}
    (args.output / "dev-diagnostics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"scored": len(results), "overall": report["overall"]}), flush=True)


if __name__ == "__main__":
    main()
