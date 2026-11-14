"""Private, content-addressed JSON cache for deterministic training tokenization."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import time
import uuid
from pathlib import Path

from data import LEVELS

VERSION = 1
logger = logging.getLogger(__name__)

_TOKENIZER_LOCATION_OPTIONS = {"name_or_path", "_name_or_path", "cache_dir", "revision", "_commit_hash"}
_TOKENIZER_RUNTIME_OPTIONS = ("model_max_length", "clean_up_tokenization_spaces", "extra_special_tokens",
                              "split_special_tokens", "model_input_names", "chat_template")


def _tokenizer_options(tokenizer):
    initial = dict(getattr(tokenizer, "init_kwargs", {}))
    # save_pretrained writes resolved defaults which can be absent from the
    # original config. Compare actual runtime settings, including defaults,
    # rather than their implicit/explicit constructor representation.
    for name in _TOKENIZER_RUNTIME_OPTIONS:
        if hasattr(tokenizer, name):
            initial[name] = getattr(tokenizer, name)
    options = {}
    for name, value in sorted(initial.items()):
        if name in _TOKENIZER_LOCATION_OPTIONS:
            continue
        if name.endswith("_file") and isinstance(value, (str, Path)):
            # Local checkpoints change file paths, not tokenizer behaviour.
            # Hash actual file contents so BPE merges and other file-backed
            # options remain part of the fingerprint, even with equal vocab.
            try:
                with Path(value).open("rb") as stream:
                    value = {"content_sha256": hashlib.file_digest(stream, "sha256").hexdigest()}
            except OSError:
                # An unavailable file cannot be proved equivalent; conservatively
                # retain its identity instead of allowing an uncertain cache hit.
                value = {"unavailable_file": str(value)}
        options[name] = value
    return repr(options)


def json_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def tokenizer_fingerprint(tokenizer):
    # Vocabulary alone is insufficient for SentencePiece or added-token options.
    state = dict(kind=f"{type(tokenizer).__module__}.{type(tokenizer).__qualname__}",
                 vocab=tokenizer.get_vocab(), special=repr(tokenizer.special_tokens_map),
                 added=repr(getattr(tokenizer, "added_tokens_decoder", {})),
                 options=_tokenizer_options(tokenizer),
                 padding_side=tokenizer.padding_side,
                 truncation_side=getattr(tokenizer, "truncation_side", "right"))
    sp_model = getattr(tokenizer, "sp_model", None)
    if sp_model is not None:
        state["sentencepiece_sha256"] = hashlib.sha256(sp_model.serialized_model_proto()).hexdigest()
    return json_hash(state)


def _valid_payload(payload, key):
    if not isinstance(payload, dict) or payload.get("version") != VERSION or payload.get("key") != key:
        return False
    rows, stats = payload.get("rows"), payload.get("stats")
    if not isinstance(rows, list) or not rows or not isinstance(stats, dict):
        return False
    if payload.get("content_sha256") != json_hash({"rows": rows, "stats": stats}):
        return False
    for name in ("selected", "encoded", "over_length_skipped"):
        if type(stats.get(name)) is not int or stats[name] < 0:
            return False
    if stats["encoded"] != len(rows) or stats["selected"] != len(rows) + stats["over_length_skipped"]:
        return False
    counts = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) - {"input_ids", "attention_mask", "token_type_ids", "labels", "loss_weights"}:
            return False
        ids, labels = row.get("input_ids"), row.get("labels")
        if (not isinstance(ids, list) or not ids or len(ids) > key["max_input_length"]
                or any(type(value) is not int or value < 0 for value in ids)):
            return False
        for name in ("attention_mask", "token_type_ids"):
            if name in row and (not isinstance(row[name], list) or len(row[name]) != len(ids)
                                or any(type(value) is not int or value not in (0, 1) for value in row[name])):
                return False
        if key["task"] == "cefr":
            if type(labels) is not int or not 0 <= labels < len(LEVELS) or "loss_weights" in row:
                return False
            counts[LEVELS[labels]] = counts.get(LEVELS[labels], 0) + 1
        else:
            bound = key["max_input_length"] if key["task"] == "feedback" else key["max_target_length"]
            if (not isinstance(labels, list) or not labels or len(labels) > bound
                    or any(type(value) is not int or (value < 0 and not (key["task"] == "feedback" and value == -100))
                           for value in labels)):
                return False
            if key["task"] == "feedback" and (len(labels) != len(ids) or all(value == -100 for value in labels)):
                return False
            weighted = key["task"] == "gec" and key["gec_edit_weight"] != 1
            if weighted != ("loss_weights" in row):
                return False
            if weighted and (not isinstance(row["loss_weights"], list) or len(row["loss_weights"]) != len(labels)
                             or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0
                                    for value in row["loss_weights"])):
                return False
    return stats.get("labels") == counts


def encode_cached(directory, key, build):
    """Return rows/stats/cache metadata; corrupt JSON is rebuilt, never unpickled."""
    started = time.perf_counter()
    cache_hash = json_hash(key)
    path = Path(directory) / f"{cache_hash}.json" if directory is not None else None
    if path is not None and path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if _valid_payload(payload, key):
                return payload["rows"], payload["stats"], dict(status="hit", key_sha256=cache_hash,
                                                              elapsed_seconds=time.perf_counter() - started)
        except (ValueError, TypeError, KeyError, OverflowError, OSError):
            pass
        logger.warning("Invalid tokenization cache %s; rebuilding from validated source files", path.name)
    rows, stats = build()
    payload = dict(version=VERSION, key=key, rows=rows, stats=stats,
                   content_sha256=json_hash({"rows": rows, "stats": stats}))
    if not _valid_payload(payload, key):
        raise ValueError("Encoded training examples failed cache schema validation")
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f".{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                json.dump(payload, stream, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return rows, stats, dict(status="miss" if path is not None else "disabled", key_sha256=cache_hash,
                             elapsed_seconds=time.perf_counter() - started)
