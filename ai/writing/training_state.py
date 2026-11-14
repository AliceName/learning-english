"""Validate continuation before loading a GPU model or changing a run manifest."""
import hashlib
import json
from pathlib import Path

from data import read_jsonl, normalized_text, SPLITS, assert_disjoint

INTEGRITY_VERSION = "writing-run-integrity-v1"
ARTIFACT_FILES = ("best/adapter_model.safetensors", "best/adapter_config.json",
                  "best/tokenizer_config.json", "best/special_tokens_map.json")
# New records must not silently resume with a changed objective or tokenizer.
# A field absent from a legacy manifest cannot prove historical equivalence;
# retain that compatibility without pretending that the field was verified.
RESUME_PROVENANCE_FIELDS = ("loss_version", "loss_source_sha256", "tokenizer_sha256",
                            "encoding_sources", "encoding_policy", "preparation_report_sha256")


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run_kind(*, experiment=False, max_steps=-1, limit_train=None, limit_dev=None):
    # A request for an experiment never upgrades a quick/limited smoke run.
    return "smoke" if max_steps > 0 or limit_train or limit_dev else "experiment" if experiment else "training"


def adapter_tensor_hash(model):
    """Hash all adapter tensors with the expansion's canonical tensor digest."""
    from peft import get_peft_model_state_dict
    from lora_expansion import _tensor_digest
    state = get_peft_model_state_dict(model)
    return _tensor_digest(state, list(state))


def validate_loadable_run(directory, task, *, allow_experiment=False):
    """Serving remains training-only; offline audits may explicitly opt in.

    Existing training manifests remain valid without backfilling new fields.
    Experiments must contain the integrity record written on successful finish.
    """
    directory = Path(directory)
    manifest = json.loads((directory / "run.json").read_text(encoding="utf-8"))
    allowed = ("training", "experiment") if allow_experiment else ("training",)
    if not manifest.get("completed") or manifest.get("kind") not in allowed or manifest.get("task") != task:
        raise ValueError(f"A completed full {task} training run is required (offline experiment audit needs explicit opt-in)")
    if manifest.get("kind") == "experiment":
        if manifest.get("release_eligible") is not False or manifest.get("integrity_version") != INTEGRITY_VERSION:
            raise ValueError("Experiment is missing its non-release integrity record")
        if not manifest.get("initial_adapter_tensor_sha256") or not manifest.get("base_revision"):
            raise ValueError("Experiment is missing base/initialization provenance")
        artifacts = manifest.get("artifact_sha256", {})
        if not all(name in artifacts for name in ARTIFACT_FILES):
            raise ValueError("Experiment is missing completed artifact hashes")
        for name, expected in artifacts.items():
            path = directory / name
            if Path(name).is_absolute() or ".." in Path(name).parts or not path.is_file() or file_hash(path) != expected:
                raise ValueError(f"Experiment artifact hash differs: {name}")
        for split, expected in manifest.get("data_sha256", {}).items():
            if file_hash(manifest["data_files"][split]) != expected:
                raise ValueError(f"Experiment data hash differs: {split}")
        if not all(split in manifest.get("data_sha256", {}) for split in ("train", "dev")):
            raise ValueError("Experiment data provenance is incomplete")
        expected_steps = manifest.get("expected_optimizer_steps")
        if expected_steps is not None and manifest.get("global_steps") != expected_steps:
            raise ValueError("Experiment completed optimizer steps differ")
        if task == "gec":
            from lora_expansion import validate_gec_adapter
            validate_gec_adapter(directory / "best", manifest.get("gec_lora_profile", "qv"), manifest["model_id"])
    return manifest


def check_holdouts(parts):
    padded = {s: parts.get(s, []) for s in SPLITS}
    assert_disjoint(padded, "user_id")
    assert_disjoint(padded, "id")
    for i, left in enumerate(SPLITS):
        inputs = {normalized_text(r["text"]) for r in padded[left]}
        for right in SPLITS[i + 1:]:
            if inputs & {normalized_text(r["text"]) for r in padded[right]}:
                raise ValueError(f"Input leakage in {left}/{right}")


def check_warm_start(run, task, parts):
    manifest = json.loads((run / "run.json").read_text(encoding="utf-8"))
    if not manifest.get("completed") or manifest.get("kind") != "training" or manifest["task"] != task:
        raise ValueError("Warm start needs a completed full training run of the same task")
    parent = {}
    for split in ("train", "dev"):
        path = Path(manifest["data_files"][split])
        if file_hash(path) != manifest["data_sha256"][split]:
            raise ValueError("Parent training data changed; cannot audit warm-start leakage")
        parent[split] = read_jsonl(path)
    seen = {normalized_text(r["text"]) for r in parent["train"]}
    seen_users = {r["user_id"] for r in parent["train"]}
    for split in ("dev", "test"):
        rows = parts.get(split, [])
        overlap = seen & {normalized_text(r["text"]) for r in rows}
        if overlap or seen_users & {r["user_id"] for r in rows}:
            raise ValueError(f"Parent model has already seen current {split} data ({len(overlap)} repeated inputs); start from base")
    return manifest


def check_resume(checkpoint, output, current):
    if checkpoint.parent.resolve() != output.resolve():
        raise ValueError("Resume must use the original output directory; use --init-run for a new weights-only branch")
    parent = json.loads((output / "run.json").read_text(encoding="utf-8"))
    if current.get("task") == "cefr":
        from modeling import check_cefr_input_continuation
        check_cefr_input_continuation(parent, {
            "cefr_input_mode": current.get("cefr_input_mode", "essay"),
            "cefr_input_format": current.get("cefr_input_format", "essay-v1"),
            "cefr_prompt_catalog_sha256": current.get("cefr_prompt_catalog_sha256"),
        })
    if parent.get("completed"):
        raise ValueError("A completed run cannot be resumed or extended; start a new run")
    if parent.get("training_schedule_version") == "fixed-horizon-v1" and any(
            parent.get(key) != current.get(key) for key in ("epochs", "max_steps")):
        raise ValueError("Resume must keep the original epochs/max_steps scheduler horizon")
    for key in RESUME_PROVENANCE_FIELDS:
        # Presence matters: deleting a pinned field is not a legacy exemption,
        # including optional fields whose recorded value is explicitly null.
        if key in parent and (key not in current or parent[key] != current[key]):
            raise ValueError(f"Resume provenance differs in {key}; keep the objective/tokenization unchanged")
    keys = ("task", "model_id", "kind", "data_sha256", "max_input_length", "max_target_length", "seed",
            "batch_size", "gradient_accumulation", "learning_rate", "gec_edit_weight", "precision",
            "limit_train", "limit_dev", "gec_eval_per_group", "gec_eval_batch_size", "early_stopping_patience",
            "gec_scoring_protocol", "gec_eval_seed", "gec_lora_profile", "cefr_class_weighting", "cefr_class_weight_cap",
            "expected_optimizer_steps", "required_precision")
    for key in keys:
        default = {"gec_edit_weight": 1.0, "gec_eval_per_group": 0,
                   "gec_eval_batch_size": 4, "early_stopping_patience": 0,
                   "gec_eval_seed": 2026,
                   "gec_lora_profile": "qv",
                   "cefr_class_weighting": "none", "cefr_class_weight_cap": 5.0}.get(key)
        if parent.get(key, default) != current.get(key, default):
            raise ValueError(f"Resume configuration differs in {key}; keep data/configuration unchanged")
    for name in ("trainer_state.json", "optimizer.pt", "scheduler.pt", "rng_state.pth"):
        if not (checkpoint / name).is_file():
            raise ValueError(f"Not a resumable training checkpoint: missing {name}")
    state = json.loads((checkpoint / "trainer_state.json").read_text(encoding="utf-8"))
    if current["max_steps"] > 0:
        if current["max_steps"] <= state["global_step"]:
            raise ValueError("Target max steps must exceed completed steps")
    elif current["epochs"] <= state["epoch"]:
        raise ValueError("Target total epochs must exceed the checkpoint epoch")
    return parent
