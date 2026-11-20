"""Calibrate and evaluate prompt-relevance thresholds on Write & Improve 2024 final versions.

On topic  = an essay paired with its own prompt.
Off topic = the same essay paired with a different prompt (seeded). This only represents
            CLEARLY off-topic essays; partly off-topic answers are not covered.
Thresholds are chosen on the corpus train split and reported on dev and test. A TF-IDF
baseline is scored the same way. Only aggregate numbers are written (no essay text).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
from pathlib import Path

import numpy as np

from data import ROOT
from relevance import (MODEL_ID, MODEL_REVISION, THRESHOLDS_PATH, RelevanceThresholds, SentenceEmbedder, essay_sentences, mean_vector,
                       prompt_points, prompt_topic_text, relevance_from_similarities)

CORPUS = Path(os.getenv("WI_CORPUS_DIR", str(Path.home() / "Downloads/write-and-improve-corpus-2024-v2/whole-corpus")))
csv.field_size_limit(10 ** 8)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(corpus: Path):
    prompts = {r["public_prompt_id"]: r for r in csv.DictReader(open(corpus / "en-writeandimprove2024-prompts-info.tsv", encoding="utf-8"), delimiter="\t")}
    essays = [r for r in csv.DictReader(open(corpus / "en-writeandimprove2024-corpus.tsv", encoding="utf-8"), delimiter="\t")
              if r["is_final_version"].upper() == "TRUE" and r["split"] in ("train", "dev", "test") and r["public_prompt_id"] in prompts]
    return prompts, essays


def rates(scores_on, scores_off):
    on, off = np.array(scores_on), np.array(scores_off)
    return {"n": int(len(on)), "on_topic_flagged_off_topic": float((on == 0).mean()), "off_topic_detected": float((off == 0).mean()),
            "on_topic_score_hist": np.bincount(on, minlength=6).tolist(), "off_topic_score_hist": np.bincount(off, minlength=6).tolist()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--corpus", type=Path, default=CORPUS)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "relevance-minilm-v1")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--false-flag-rate", type=float, default=0.02, help="Max share of on-topic train essays scored 0")
    parser.add_argument("--weak-quantile", type=float, default=0.10)
    parser.add_argument("--device", default="cuda", help="cuda or cpu (cpu takes a few minutes)")
    parser.add_argument("--install", action="store_true", help="Overwrite the thresholds file the service uses")
    args = parser.parse_args(argv)
    if args.output.exists():
        parser.error("Output directory already exists")
    prompts, essays = load(args.corpus)
    ids = sorted(prompts)
    rng = random.Random(args.seed)
    other = {e["public_essay_id"]: rng.choice([p for p in ids if p != e["public_prompt_id"]]) for e in essays}

    embedder = SentenceEmbedder(args.device)
    topic = dict(zip(ids, embedder.encode([prompt_topic_text(prompts[p]["prompt"]) for p in ids])))
    points = {p: prompt_points(prompts[p]["prompt"]) for p in ids}
    point_vecs = {p: embedder.encode(points[p]) if points[p] else np.zeros((0, 384)) for p in ids}
    sims = []  # (split, own_topic, other_topic, own_point_sims, other_point_sims)
    for e in essays:
        sent = embedder.encode(essay_sentences(e["text"]) or [e["text"]])
        vec = mean_vector(sent)
        own, alt = e["public_prompt_id"], other[e["public_essay_id"]]
        cover = lambda p: (point_vecs[p] @ sent.T).max(axis=1).tolist() if len(point_vecs[p]) else []
        sims.append((e["split"], float(vec @ topic[own]), float(vec @ topic[alt]), cover(own), cover(alt)))

    train = [s for s in sims if s[0] == "train"]
    on_train = np.array([s[1] for s in train])
    off_topic = float(np.quantile(on_train, args.false_flag_rate))
    weak = float(np.quantile(on_train, args.weak_quantile))
    own_pts = np.array([v for s in train for v in s[3]]); alt_pts = np.array([v for s in train for v in s[4]])
    grid = np.linspace(0, 1, 201)
    youden = [((own_pts >= t).mean() - (alt_pts >= t).mean(), t) for t in grid]
    point = float(max(youden)[1])
    thresholds = RelevanceThresholds(off_topic=round(off_topic, 4), weak=round(weak, 4), point=round(point, 4), version="relevance-minilm-v1")

    # TF-IDF baseline: same false-flag budget on train.
    from sklearn.feature_extraction.text import TfidfVectorizer
    tfidf = TfidfVectorizer(stop_words="english", sublinear_tf=True).fit(
        [e["text"] for e in essays if e["split"] == "train"] + [prompt_topic_text(prompts[p]["prompt"]) for p in ids])
    pvec = {p: tfidf.transform([prompt_topic_text(prompts[p]["prompt"])]) for p in ids}
    tf_sims = [(e["split"], float((tfidf.transform([e["text"]]) @ pvec[e["public_prompt_id"]].T).toarray()[0, 0]),
                float((tfidf.transform([e["text"]]) @ pvec[other[e["public_essay_id"]]].T).toarray()[0, 0])) for e in essays]
    tf_cut = float(np.quantile([s[1] for s in tf_sims if s[0] == "train"], args.false_flag_rate))

    metrics = {}
    for split in ("train", "dev", "test"):
        rows = [s for s in sims if s[0] == split]
        on = [relevance_from_similarities(s[1], s[3], thresholds)["score"] for s in rows]
        off = [relevance_from_similarities(s[2], s[4], thresholds)["score"] for s in rows]
        tf_rows = [s for s in tf_sims if s[0] == split]
        own_cov = [v >= point for s in rows for v in s[3]]; alt_cov = [v >= point for s in rows for v in s[4]]
        metrics[split] = {"embedding": rates(on, off),
                          "points_covered_rate": {"own_prompt": float(np.mean(own_cov)), "other_prompt": float(np.mean(alt_cov))},
                          "tfidf_baseline": {"on_topic_flagged_off_topic": float(np.mean([s[1] < tf_cut for s in tf_rows])),
                                             "off_topic_detected": float(np.mean([s[2] < tf_cut for s in tf_rows]))}}
    args.output.mkdir(parents=True)
    report = {"thresholds": {"off_topic": thresholds.off_topic, "weak": thresholds.weak, "point": thresholds.point, "version": thresholds.version},
              "model": {"id": MODEL_ID, "revision": MODEL_REVISION},
              "data": {"corpus": "write-and-improve-corpus-2024-v2 (final versions, train/dev/test)",
                       "corpus_sha256": sha256(args.corpus / "en-writeandimprove2024-corpus.tsv"),
                       "prompts_sha256": sha256(args.corpus / "en-writeandimprove2024-prompts-info.tsv"),
                       "essays": len(essays), "prompts": len(ids), "prompts_with_points": sum(bool(points[p]) for p in ids)},
              "protocol": {"seed": args.seed, "false_flag_rate": args.false_flag_rate, "weak_quantile": args.weak_quantile,
                           "point_threshold": "Youden J on train, own vs other prompt", "tfidf_cut": round(tf_cut, 4),
                           "limits": "Other-prompt pairs only represent clearly off-topic essays; point coverage has no human labels."},
              "metrics": metrics}
    (args.output / "thresholds.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # The service reads THRESHOLDS_PATH (git-ignored); keep an existing file unless --install is given.
    if args.install or not THRESHOLDS_PATH.exists():
        THRESHOLDS_PATH.parent.mkdir(parents=True, exist_ok=True)
        THRESHOLDS_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Installed thresholds to {THRESHOLDS_PATH}")
    print(json.dumps({"thresholds": report["thresholds"], "test": metrics["test"], "dev": metrics["dev"]}, indent=2))


if __name__ == "__main__":
    main()
