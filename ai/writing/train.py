"""Train one local Writing adapter at a time. Never upload data or checkpoints."""
from __future__ import annotations

import argparse
import importlib.metadata
import importlib.util
import json
import math
import os
import random
from collections import Counter
from pathlib import Path

from data import ROOT, LEVELS, read_jsonl, validate_splits
from modeling import (DEFAULT_MODELS, DEFAULT_LENGTHS, MODEL_REVISIONS, CompletionCollator, attach_lora,
                      classification_metrics, encode_row, load_base, load_cefr_prompts,
                      cefr_input_spec, check_cefr_input_continuation)
from training_state import (check_holdouts, check_warm_start, check_resume, file_hash, run_kind,
                            adapter_tensor_hash, INTEGRITY_VERSION, ARTIFACT_FILES)
from tokenization_cache import encode_cached, tokenizer_fingerprint
from lora_expansion import GEC_LORA_PROFILES, gec_profile_modules, validate_gec_adapter, load_gec_adapter
from training_preparation import preparation_provenance

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "true")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


class Examples:
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        return self.rows[index]


def encode_split(rows, task, tokenizer, max_length, target_length, limit, seed, edit_weight=1.0,
                 cefr_input_mode="essay", cefr_prompts=None):
    encoded = []
    counts = Counter()
    skipped = 0
    if limit:
        rows = random.Random(seed).sample(rows, min(limit, len(rows)))
    for row in rows:
        item = encode_row(row, task, tokenizer, max_length, target_length, cefr_input_mode, cefr_prompts)
        if item is None:
            skipped += 1
            continue
        if task == "gec" and edit_weight != 1.0:
            from gec_loss import edit_weights
            item["loss_weights"] = edit_weights(item["input_ids"], item["labels"], edit_weight)
        encoded.append(item)
        if task == "cefr":
            counts[row["cefr"]] += 1
    if not encoded:
        raise ValueError("No usable examples within the length budget; increase max lengths")
    return Examples(encoded), {"selected": len(rows), "encoded": len(encoded),
                               "over_length_skipped": skipped, "labels": dict(counts)}


def build_training_arguments(args, cuda, bf16, seq2seq_factory, standard_factory):
    kwargs = dict(
        output_dir=str(args.output), num_train_epochs=args.epochs, max_steps=args.max_steps,
        learning_rate=args.learning_rate, per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=1, gradient_accumulation_steps=args.gradient_accumulation,
        gradient_checkpointing=True, gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=bf16, fp16=False, use_cpu=not cuda, optim="adamw_torch", weight_decay=0.01,
        lr_scheduler_type="linear", warmup_steps=0,
        eval_strategy="epoch", save_strategy="epoch", save_total_limit=2,
        logging_steps=10, logging_nan_inf_filter=False, report_to=[], push_to_hub=False,
        dataloader_num_workers=0, disable_tqdm=not args.progress,
        dataloader_pin_memory=cuda, seed=args.seed, data_seed=args.seed,
        load_best_model_at_end=True, label_names=["labels"], remove_unused_columns=False,
        metric_for_best_model=args.metric_for_best_model,
        greater_is_better=args.greater_is_better,
        eval_accumulation_steps=1, group_by_length=True, restore_callback_states_from_checkpoint=True,
    )
    return (seq2seq_factory(**kwargs, predict_with_generate=False) if args.task == "gec"
            else standard_factory(**kwargs))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("task", choices=list(DEFAULT_MODELS))
    parser.add_argument("--train-file", type=Path)
    parser.add_argument("--dev-file", type=Path)
    parser.add_argument("--preparation-report", type=Path,
                        help="Bind input file hashes and encoding policy to a preparation manifest")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", help="HF model ID or local pretrained model directory")
    parser.add_argument("--max-input-length", type=int)
    parser.add_argument("--max-target-length", type=int, default=384)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--experiment", action="store_true", help="Explicit offline research run; never eligible for serving")
    parser.add_argument("--require-bf16", action="store_true", help="Fail instead of silently using another precision")
    parser.add_argument("--expected-initial-adapter-sha256", help="Reject differing adapter initialization before the first update")
    parser.add_argument("--expected-optimizer-steps", type=int, help="Reject a schedule or completed run with a different step count")
    parser.add_argument("--gec-edit-weight", type=float, default=1.0,
                        help="Experimental weight on changed target tokens; GEC only")
    parser.add_argument("--gec-lora-profile", choices=tuple(GEC_LORA_PROFILES), default="qv",
                        help="GEC attention LoRA targets; qvo permits explicit qv-parent expansion")
    parser.add_argument("--cefr-class-weighting", choices=("none", "sqrt-inverse"), default="none")
    parser.add_argument("--cefr-class-weight-cap", type=float, default=5.0)
    parser.add_argument("--cefr-input-mode", choices=("essay", "prompt-essay"), default="essay")
    parser.add_argument("--cefr-prompts-file", type=Path, help="Pinned local prompts-info TSV")
    parser.add_argument("--cefr-boundary-weighting", choices=("none", "uniform", "focus2"), default="none",
                        help="Opt-in offline experiment: original-sublevel per-example weighting")
    continuation = parser.add_mutually_exclusive_group()
    continuation.add_argument("--init-run", type=Path, help="Continue adapter weights with a NEW optimizer/run")
    continuation.add_argument("--resume-checkpoint", type=Path, help="Restore adapter, optimizer, scheduler and step in SAME run")
    parser.add_argument("--gec-eval-per-group", type=int, default=0, help="Fixed edited/correct dev samples for ERRANT each epoch")
    parser.add_argument("--gec-eval-batch-size", type=int, default=4)
    parser.add_argument("--gec-eval-seed", type=int, default=2026,
                        help="Fixed checkpoint-selection sample seed, independent of training seed")
    parser.add_argument("--early-stopping-patience", type=int, default=0)
    parser.add_argument("--checkpoint-steps", type=int, default=0, help="Also save between epochs for interrupted runs")
    parser.add_argument("--progress", action="store_true", help="Display a terminal progress bar")
    parser.add_argument("--max-steps", type=int, default=-1, help="Positive value marks run as smoke")
    parser.add_argument("--limit-train", type=int)
    parser.add_argument("--limit-dev", type=int)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--token-cache-dir", type=Path, default=ROOT / ".cache/tokenization",
                        help="Private content-addressed JSON tokenization cache")
    parser.add_argument("--no-token-cache", action="store_true", help="Encode from source instead of using the cache")
    parser.add_argument("--tokenize-only", action="store_true",
                        help="Verify data and populate token cache, then exit without loading model weights")
    parser.add_argument("--cpu", action="store_true", help="Slow; mainly for validation")
    args = parser.parse_args()
    if args.task != "cefr" and (args.cefr_input_mode != "essay" or args.cefr_prompts_file):
        parser.error("CEFR input options apply only to cefr")
    if args.cefr_input_mode == "prompt-essay" and (not args.cefr_prompts_file or not args.experiment):
        parser.error("Prompt-essay requires --cefr-prompts-file and --experiment; not eligible for serving")
    if args.cefr_input_mode == "prompt-essay" and args.cefr_boundary_weighting != "none":
        parser.error("Prompt input and boundary loss are separate experiments")
    input_spec = cefr_input_spec(args.cefr_input_mode, args.cefr_prompts_file) if args.task == "cefr" else {}
    prompts = load_cefr_prompts(args.cefr_prompts_file) if args.cefr_prompts_file else None
    if args.cefr_boundary_weighting != "none" and (
            args.task != "cefr" or not args.experiment or args.cefr_class_weighting != "none"
            or args.init_run or args.resume_checkpoint):
        parser.error("Boundary weighting requires a fresh CEFR experiment without class weighting or continuation")
    if args.task != "gec" and args.gec_lora_profile != "qv":
        parser.error("GEC LoRA profiles apply only to gec")
    if args.expected_optimizer_steps is not None and args.expected_optimizer_steps <= 0:
        parser.error("Expected optimizer steps must be positive")
    if args.expected_initial_adapter_sha256 and (len(args.expected_initial_adapter_sha256) != 64 or
            any(c not in "0123456789abcdef" for c in args.expected_initial_adapter_sha256)):
        parser.error("Expected initial adapter hash must be a lowercase SHA-256 digest")
    if not math.isfinite(args.cefr_class_weight_cap) or args.cefr_class_weight_cap < 1 or (args.task != "cefr" and args.cefr_class_weighting != "none"):
        parser.error("Class balancing is CEFR-only and requires a cap >= 1")
    if min(args.gec_eval_per_group, args.early_stopping_patience, args.checkpoint_steps) < 0 or args.gec_eval_batch_size < 1:
        parser.error("Evaluation/checkpoint counts must be nonnegative; evaluation batch size must be positive")
    if args.gec_eval_per_group and args.task != "gec":
        parser.error("ERRANT generation evaluation applies only to gec")
    if args.gec_eval_per_group:
        if not all(importlib.util.find_spec(name) for name in ("errant", "en_core_web_sm")):
            parser.error("Install ai/writing/requirements-evaluation.txt for per-epoch ERRANT scoring")
    if not 1 <= args.gec_edit_weight <= 20 or (args.task != "gec" and args.gec_edit_weight != 1):
        parser.error("GEC edit weight must be between 1 and 20 and only applies to gec")
    positive = [args.batch_size, args.gradient_accumulation, args.max_target_length, args.epochs,
                args.learning_rate] + [x for x in (args.max_input_length, args.limit_train, args.limit_dev) if x is not None]
    if any(not math.isfinite(x) or x <= 0 for x in positive) or (args.max_steps < 1 and args.max_steps != -1):
        parser.error("Lengths, rates, limits, batch size, accumulation and epochs must be finite and positive")
    if args.output.exists() and any(args.output.iterdir()) and not args.resume_checkpoint:
        parser.error("Output is not empty; use a new directory to preserve earlier checkpoints")
    train_file = args.train_file or ROOT / "data" / "prepared" / f"{args.task}-train.jsonl"
    dev_file = args.dev_file or ROOT / "data" / "prepared" / f"{args.task}-dev.jsonl"
    if not train_file.exists() or not dev_file.exists():
        parser.error("Missing train/dev files. Prepare the corpus first; feedback needs separately reviewed examples.")
    data_sha256 = {split: file_hash(path) for split, path in (("train", train_file), ("dev", dev_file))}
    preparation = preparation_provenance(args.preparation_report, args.task, train_file, dev_file)
    parts = {"train": read_jsonl(train_file), "dev": read_jsonl(dev_file)}
    validate_splits(parts, args.task)
    held_out = dict(parts)
    test_file = train_file.parent / f"{args.task}-test.jsonl"
    if test_file.exists():
        held_out["test"] = read_jsonl(test_file)
    check_holdouts(held_out)
    parent = check_warm_start(args.init_run, args.task, held_out) if args.init_run else None
    if args.resume_checkpoint:
        parent = json.loads((args.output / "run.json").read_text(encoding="utf-8"))
    if parent and args.task == "cefr":
        check_cefr_input_continuation(parent, input_spec)
    if prompts and any(row.get("prompt_id") not in prompts for rows in parts.values() for row in rows):
        parser.error("Missing prompt mapping for a train/dev essay")
    if parent and parent.get("cefr_boundary_weighting", "none") != "none":
        parser.error("Boundary experiments cannot be resumed or used as a warm start")
    if parent and args.task == "gec":
        source_profile = parent.get("gec_lora_profile", "qv")
        adapter_source = args.init_run / "best" if args.init_run else args.resume_checkpoint
        validate_gec_adapter(adapter_source, source_profile, parent["model_id"])
        if source_profile != args.gec_lora_profile and not (
                args.init_run and source_profile == "qv" and args.gec_lora_profile == "qvo"):
            parser.error("GEC LoRA profile differs; only a new qv-to-qvo warm start may expand")

    import torch
    from transformers import (AutoTokenizer, DataCollatorWithPadding, DataCollatorForSeq2Seq,
                              Trainer, TrainingArguments, Seq2SeqTrainer,
                              Seq2SeqTrainingArguments, set_seed)

    set_seed(args.seed)
    cuda = not args.cpu and torch.cuda.is_available()
    if not cuda and not args.cpu:
        parser.error("CUDA is unavailable. Install the CUDA torch wheel or explicitly use --cpu.")
    bf16 = cuda and torch.cuda.is_bf16_supported()
    if args.require_bf16 and not bf16:
        parser.error("This run requires CUDA BF16; precision was not changed")
    dtype = torch.bfloat16 if bf16 else torch.float32
    model_id = args.model or (parent["model_id"] if parent else DEFAULT_MODELS[args.task])
    if parent and (parent["task"] != args.task or model_id != parent["model_id"]):
        parser.error("Continuation must keep the parent task and base model")
    max_length = args.max_input_length or DEFAULT_LENGTHS[args.task]
    tokenizer_source = args.init_run / "best" if args.init_run else args.resume_checkpoint or model_id
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, use_fast=False, trust_remote_code=False,
                                             revision=None if parent else MODEL_REVISIONS.get(model_id))
    tokenizer.padding_side = "right"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    encoded = {}
    stats = {}
    cache_report = {}
    encoding_sources = {name: file_hash(Path(__file__).with_name(name)) for name in
                        ("train.py", "modeling.py", "gec_loss.py", "data.py", "tokenization_cache.py",
                         "training_preparation.py")}
    token_hash = tokenizer_fingerprint(tokenizer)
    for split, rows in parts.items():
        limit = args.limit_train if split == "train" else args.limit_dev
        key = dict(task=args.task, split=split, data_sha256=data_sha256[split],
                   model_id=model_id, base_revision=parent.get("base_revision") if parent else MODEL_REVISIONS.get(model_id),
                   tokenizer_sha256=token_hash, transformers_version=importlib.metadata.version("transformers"),
                   encoding_sources=encoding_sources, max_input_length=max_length,
                   max_target_length=args.max_target_length, limit=limit, sampling_seed=args.seed,
                   gec_edit_weight=args.gec_edit_weight,
                   encoding_policy=preparation["encoding_policy"],
                   preparation_report_sha256=preparation["preparation_report_sha256"])
        key.update(input_spec)

        def build():
            dataset, report = encode_split(rows, args.task, tokenizer, max_length, args.max_target_length,
                                           limit, args.seed, args.gec_edit_weight, args.cefr_input_mode, prompts)
            return dataset.rows, report

        cached_rows, stats[split], cache_report[split] = encode_cached(
            None if args.no_token_cache else args.token_cache_dir, key, build)
        encoded[split] = Examples(cached_rows)
    boundary_metadata = {}
    boundary_tables = {}
    if args.cefr_boundary_weighting != "none":
        from cefr_boundary_loss import bind_examples
        for split, rows in parts.items():
            items, boundary_metadata[split], boundary_tables[split] = bind_examples(
                rows, encoded[split].rows, tokenizer, max_length, args.max_target_length,
                args.limit_train if split == "train" else args.limit_dev, args.seed,
                args.cefr_boundary_weighting if split == "train" else "uniform")
            encoded[split] = Examples(items)
    if any(file_hash(path) != data_sha256[split] for split, path in (("train", train_file), ("dev", dev_file))):
        parser.error("Training data changed during preparation; restore it or choose a new run")
    if args.task == "cefr" and input_spec != cefr_input_spec(args.cefr_input_mode, args.cefr_prompts_file):
        parser.error("Prompt catalog changed during tokenization")
    kind = run_kind(experiment=args.experiment, max_steps=args.max_steps,
                    limit_train=args.limit_train, limit_dev=args.limit_dev)
    smoke = kind == "smoke"
    if args.task == "cefr" and not smoke and set(stats["train"]["labels"]) != set(LEVELS):
        parser.error("Some CEFR bands have no training examples after length filtering; inspect the data/length budget")
    if args.tokenize_only:
        print(json.dumps(dict(task=args.task, tokenization=stats, tokenization_cache=cache_report,
                              data_sha256=data_sha256, gec_eval_seed=args.gec_eval_seed,
                              **preparation, **input_spec)), flush=True)
        return
    args.output.mkdir(parents=True, exist_ok=True)
    for split, metadata in boundary_metadata.items():
        with (args.output / f"boundary-{split}-metadata.json").open("x", encoding="utf-8") as stream:
            json.dump(metadata, stream, ensure_ascii=False, indent=2)
    manifest = {
        "task": args.task, "model_id": model_id, "kind": kind,
        "release_eligible": kind == "training",
        "max_input_length": max_length, "max_target_length": args.max_target_length,
        "precision": "bf16" if bf16 else "fp32", "seed": args.seed,
        "cuda": cuda, "gpu": torch.cuda.get_device_name(0) if cuda else None,
        "batch_size": args.batch_size, "gradient_accumulation": args.gradient_accumulation,
        "learning_rate": args.learning_rate, "epochs": args.epochs,
        "training_schedule_version": "fixed-horizon-v1",
        "required_precision": "bf16" if args.require_bf16 else None,
        "expected_optimizer_steps": args.expected_optimizer_steps,
        "loss_version": "gec-edit-weight-batch-normalized-v1" if args.task == "gec" else None,
        "loss_source_sha256": file_hash(Path(__file__).with_name("gec_loss.py")) if args.task == "gec" else None,
        "gec_edit_weight": args.gec_edit_weight,
        "completed": False, "limit_train": args.limit_train, "limit_dev": args.limit_dev, "max_steps": args.max_steps,
        "gec_eval_per_group": args.gec_eval_per_group, "gec_eval_batch_size": args.gec_eval_batch_size,
        "gec_eval_seed": args.gec_eval_seed,
        "early_stopping_patience": args.early_stopping_patience, "checkpoint_steps": args.checkpoint_steps,
        "selection_metric": "gec_f05" if args.gec_eval_per_group else "macro_f1" if args.task == "cefr" else "eval_loss",
        "initialization": "resume_optimizer" if args.resume_checkpoint else "warm_start_weights" if args.init_run else "base",
        "initialized_from": str(args.init_run.resolve()) if args.init_run else None,
        "resumed_from_checkpoint": str(args.resume_checkpoint.resolve()) if args.resume_checkpoint else None,
        "tokenization": stats, "labels": list(LEVELS) if args.task == "cefr" else None,
        "tokenization_cache": cache_report,
        "tokenizer_sha256": token_hash,
        "encoding_sources": encoding_sources,
        **preparation,
        **input_spec,
        "cefr_prompt_catalog_file": str(args.cefr_prompts_file.resolve()) if args.cefr_prompts_file else None,
        "data_files": {"train": str(train_file.resolve()), "dev": str(dev_file.resolve())},
        "versions": {p: importlib.metadata.version(p) for p in ("torch", "transformers", "peft", "accelerate")},
        "limitations": ["Long examples are skipped, not silently truncated.",
                        "CEFR is an essay-level estimate, not an official certificate or a 0-10 grade.",
                        "Sequence eval_loss alone does not establish correction/feedback quality.",
                        "Held-out test has not been used for checkpoint selection."],
    }
    if args.gec_eval_per_group:
        from gec_evaluation import ERRANT_PROTOCOL
        manifest["gec_scoring_protocol"] = ERRANT_PROTOCOL
    if args.task == "gec":
        manifest["gec_lora_profile"] = args.gec_lora_profile
        manifest["gec_lora_target_modules"] = gec_profile_modules(args.gec_lora_profile)
    if args.task == "cefr":
        from cefr_loss import class_weights
        weights = class_weights([stats["train"]["labels"].get(level, 0) for level in LEVELS], args.cefr_class_weight_cap) if args.cefr_class_weighting != "none" else None
        manifest["cefr_class_weighting"] = args.cefr_class_weighting
        manifest["cefr_class_weight_cap"] = args.cefr_class_weight_cap
        manifest["cefr_class_weights"] = dict(zip(LEVELS, weights, strict=True)) if weights else None
        manifest["cefr_boundary_weighting"] = args.cefr_boundary_weighting
        if args.cefr_boundary_weighting != "none":
            from cefr_boundary_loss import VERSION
            manifest["loss_version"] = VERSION
            manifest["loss_source_sha256"] = file_hash(Path(__file__).with_name("cefr_boundary_loss.py"))
            manifest["cefr_boundary_tables"] = boundary_tables
            manifest["cefr_boundary_eval_policy"] = "uniform; no train-derived weights on dev"
            manifest["cefr_boundary_metadata_sha256"] = {
                split: file_hash(args.output / f"boundary-{split}-metadata.json") for split in boundary_metadata}
    manifest["data_sha256"] = data_sha256
    manifest_path = args.output / "run.json"
    if test_file.exists():
        manifest["held_out_file"] = str(test_file.resolve())
        manifest["held_out_sha256"] = file_hash(test_file)
    if args.resume_checkpoint:
        check_resume(args.resume_checkpoint, args.output, manifest)
    if args.init_run:
        manifest["parent_adapter_sha256"] = file_hash(args.init_run / "best/adapter_model.safetensors")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"task": args.task, "kind": manifest["kind"], "precision": manifest["precision"],
                      "length_budget": max_length, "train_examples": len(encoded["train"]),
                      "dev_examples": len(encoded["dev"]), "tokenization_cache": cache_report}), flush=True)
    base = load_base(model_id, args.task, dtype, revision=parent.get("base_revision") if parent else None)
    manifest["base_revision"] = getattr(base.config, "_commit_hash", None)
    if hasattr(base.config, "use_cache"):
        base.config.use_cache = False
    if parent and args.task == "gec":
        adapter_source = args.init_run / "best" if args.init_run else args.resume_checkpoint
        model, lora_initialization = load_gec_adapter(
            base, adapter_source, args.gec_lora_profile, allow_expansion=bool(args.init_run),
            expected_model_id=model_id, initialization_seed=args.seed)
        manifest["gec_lora_initialization"] = (parent.get("gec_lora_initialization", lora_initialization)
                                                if args.resume_checkpoint else lora_initialization)
        if args.resume_checkpoint:
            manifest["gec_lora_resume_adapter_sha256"] = lora_initialization["parent_adapter_sha256"]
    elif parent:
        from peft import PeftModel
        model = PeftModel.from_pretrained(base, args.init_run / "best" if args.init_run else args.resume_checkpoint,
                                          is_trainable=True)
    else:
        model = attach_lora(base, args.task, args.gec_lora_profile)
    loaded_adapter_hash = adapter_tensor_hash(model)
    manifest["initial_adapter_tensor_sha256"] = parent.get("initial_adapter_tensor_sha256", loaded_adapter_hash) if args.resume_checkpoint else loaded_adapter_hash
    if args.expected_initial_adapter_sha256 and manifest["initial_adapter_tensor_sha256"] != args.expected_initial_adapter_sha256:
        raise ValueError("Initial adapter tensor hash differs before the first optimizer update")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    model.print_trainable_parameters()
    argument_options = argparse.Namespace(
        output=args.output, epochs=args.epochs, max_steps=args.max_steps, learning_rate=args.learning_rate,
        batch_size=args.batch_size, gradient_accumulation=args.gradient_accumulation,
        progress=args.progress, seed=args.seed, task=args.task,
        metric_for_best_model=manifest["selection_metric"],
        greater_is_better=args.task == "cefr" or bool(args.gec_eval_per_group))
    training_args = build_training_arguments(argument_options, cuda, bf16,
                                             Seq2SeqTrainingArguments, TrainingArguments)
    if args.task == "gec":
        trainer_class = Seq2SeqTrainer
        collator = DataCollatorForSeq2Seq(tokenizer, model=model, label_pad_token_id=-100)
        if args.gec_edit_weight != 1:
            from gec_loss import EditCollator, edit_trainer_class
            collator = EditCollator(collator)
            trainer_class = edit_trainer_class()
    else:
        trainer_class = Trainer
        if args.task == "cefr" and args.cefr_class_weighting != "none":
            from cefr_loss import weighted_trainer_class
            trainer_class = weighted_trainer_class(weights)
        collator = DataCollatorWithPadding(tokenizer) if args.task == "cefr" else CompletionCollator(tokenizer)
        if args.cefr_boundary_weighting != "none":
            from cefr_boundary_loss import BoundaryCollator, trainer_class as boundary_trainer
            collator = BoundaryCollator(collator)
            trainer_class = boundary_trainer(args.output / "boundary-training-batches.jsonl")
    callbacks = []
    generation_callback = None
    if args.gec_eval_per_group:
        from gec_evaluation import make_generation_callback
        generation_callback = make_generation_callback(parts["dev"] if not args.limit_dev else random.Random(args.seed).sample(
            parts["dev"], min(args.limit_dev, len(parts["dev"]))), tokenizer, max_length, args.max_target_length,
            args.gec_eval_per_group, args.gec_eval_batch_size, "cuda" if cuda else "cpu", dtype, args.output,
            seed=args.gec_eval_seed)
        callbacks.append(generation_callback)
    if args.early_stopping_patience:
        from transformers import EarlyStoppingCallback
        callbacks.append(EarlyStoppingCallback(early_stopping_patience=args.early_stopping_patience))
    if args.checkpoint_steps:
        from gec_evaluation import make_periodic_checkpoint_callback
        callbacks.append(make_periodic_checkpoint_callback(args.checkpoint_steps))
    class FiniteTrainer(trainer_class):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            result = super().compute_loss(model, inputs, return_outputs=return_outputs, **kwargs)
            loss = result[0] if return_outputs else result
            if not torch.isfinite(loss).all().item():
                raise FloatingPointError("Nonfinite loss; training stopped without changing configuration")
            return result
    trainer = FiniteTrainer(
        model=model, args=training_args, train_dataset=encoded["train"], eval_dataset=encoded["dev"],
        processing_class=tokenizer, data_collator=collator,
        compute_metrics=classification_metrics if args.task == "cefr" else None, callbacks=callbacks)
    # Keep the resolved Trainer configuration and step-zero tensors auditable.
    manifest["resolved_training_arguments"] = training_args.to_dict()
    planned_steps = args.max_steps if args.max_steps > 0 else math.ceil(
        args.epochs * math.ceil(len(trainer.get_train_dataloader()) / args.gradient_accumulation))
    manifest["planned_optimizer_steps"] = planned_steps
    if args.expected_optimizer_steps is not None and planned_steps != args.expected_optimizer_steps:
        raise ValueError("Optimizer schedule differs before the first update")
    from transformers import TrainerCallback
    class InitializationAudit(TrainerCallback):
        def on_train_begin(self, training_options, state, control, model=None, **kwargs):
            value = adapter_tensor_hash(model)
            if value != loaded_adapter_hash:
                raise ValueError("Adapter tensors changed before the first update")
            if args.resume_checkpoint:
                manifest["resume_adapter_tensor_sha256"] = value
                manifest["resume_global_step"] = state.global_step
                for key in ("pre_update_adapter_tensor_sha256", "pre_update_global_step"):
                    if key in parent:
                        manifest[key] = parent[key]
            else:
                manifest["pre_update_adapter_tensor_sha256"] = value
                manifest["pre_update_global_step"] = state.global_step
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        def on_pre_optimizer_step(self, training_options, state, control, model=None, **kwargs):
            if any(parameter.grad is not None and not torch.isfinite(parameter.grad).all().item()
                   for parameter in model.parameters() if parameter.requires_grad):
                raise FloatingPointError("Nonfinite gradient; stopped before optimizer update")
    trainer.add_callback(InitializationAudit())
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if generation_callback:
        generation_callback.trainer = trainer
    if cuda:
        torch.cuda.reset_peak_memory_stats()
    result = trainer.train(resume_from_checkpoint=str(args.resume_checkpoint) if args.resume_checkpoint else None)
    if args.expected_optimizer_steps is not None and trainer.state.global_step != args.expected_optimizer_steps:
        raise ValueError("Completed optimizer steps differ; run remains incomplete")
    selected_step = int(Path(trainer.state.best_model_checkpoint).name.split("-")[-1])
    recorded_metrics = args.output / "evaluation" / f"metrics-step-{selected_step}.json"
    metrics = json.loads(recorded_metrics.read_text(encoding="utf-8")) if generation_callback else trainer.evaluate()
    trainer.save_model(str(args.output / "best"))
    tokenizer.save_pretrained(args.output / "best")
    manifest["completed"] = True
    manifest["best_checkpoint"] = trainer.state.best_model_checkpoint
    manifest["best_metric"] = trainer.state.best_metric
    manifest["global_steps"] = trainer.state.global_step
    manifest["train_metrics"] = result.metrics
    manifest["dev_metrics"] = metrics
    manifest["peak_allocated_mib"] = torch.cuda.max_memory_allocated() / 1024**2 if cuda else None
    manifest["peak_reserved_mib"] = torch.cuda.max_memory_reserved() / 1024**2 if cuda else None
    manifest["integrity_version"] = INTEGRITY_VERSION
    manifest["artifact_sha256"] = {name: file_hash(args.output / name) for name in ARTIFACT_FILES}
    if args.cefr_boundary_weighting != "none":
        manifest["cefr_boundary_batch_trace_sha256"] = file_hash(args.output / "boundary-training-batches.jsonl")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Saved private adapter to {args.output / 'best'}. Run kind: {manifest['kind']}.")


if __name__ == "__main__":
    main()
