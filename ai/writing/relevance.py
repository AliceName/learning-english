"""Prompt relevance (0-5) for Writing, combining a sentence-embedding model with keywords.

* The score comes from embeddings (sentence-transformers/all-MiniLM-L6-v2, Apache-2.0, pinned
  revision): the essay vs. the prompt topic, and each prompt point vs. its closest essay sentence.
* Keywords only explain the score to the learner ("your essay mentions: trip, Ken").

Thresholds are calibrated on Write & Improve 2024 final versions by calibrate_relevance.py
(own prompt = on topic, another prompt = clearly off topic). Only "clearly off topic" is
validated that way; point coverage has no human labels and must be shown as experimental.
Runs locally; no text leaves the machine.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from data import ROOT

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))

MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
# Built locally by calibrate_relevance.py from your own W&I copy. Derived corpus statistics: never commit.
THRESHOLDS_PATH = ROOT / "config" / "relevance-minilm-v1.json"
_STOPWORDS = frozenset("""a about after again all also an and any are as at be because been before being but by can
could did do does doing for from had has have having he her here him his how i if in into is it its just me more most
my no not now of on one only or other our out over own same she should so some such than that the their them then there
these they this those through to too under until up very was we were what when where which while who why will with would
you your yours write words word email letter note article essay story report about tell say says said last next week went go going""".split())
_WORD = re.compile(r"[A-Za-z][A-Za-z'-]+")
_LENGTH_HINT = re.compile(r"\b(write|use)\b[^.?!]*\b(\d+|about|least)\b[^.?!]*\bwords?\b[^.?!]*[.?!]?", re.IGNORECASE)


@dataclass(frozen=True)
class RelevanceThresholds:
    off_topic: float
    weak: float
    point: float
    version: str


def essay_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def prompt_points(prompt: str) -> list[str]:
    """Inline "*" bullets when present, otherwise the questions the prompt asks."""
    parts = re.split(r"(?:^|\s)\*\s+", prompt)
    if len(parts) > 1:
        points = [" ".join(p.split()) for p in parts[1:]]
        last = re.match(r"^(.*?[.!?])\s+(?:Write|Use)\b.*$", points[-1], re.IGNORECASE)
        if last:
            points[-1] = last.group(1)
        return [p for p in points if p]
    greeting = re.compile(r"^(?:hi|hello|hey|dear\s+\w+)(?:\s+there)?[,!]?\s+", re.IGNORECASE)
    return [greeting.sub("", s) for s in essay_sentences(" ".join(prompt.split())) if s.endswith("?")]


def prompt_topic_text(prompt: str) -> str:
    """Prompt text without the length instruction, which says nothing about the topic."""
    return " ".join(_LENGTH_HINT.sub(" ", prompt.replace("*", " ")).split())


def _stem(word: str) -> str:
    word = word.lower().strip("'-")
    for suffix in ("ing", "ed", "es", "s"):
        if suffix == "s" and word.endswith("ss"):
            continue
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def matched_keywords(prompt: str, essay: str, limit: int = 8) -> list[str]:
    """Prompt content words that also appear in the essay, in essay order (for explanation only)."""
    wanted = {_stem(w) for w in _WORD.findall(prompt_topic_text(prompt)) if w.lower() not in _STOPWORDS and len(w) > 2}
    found: dict[str, str] = {}
    for word in _WORD.findall(essay):
        stem = _stem(word)
        if stem in wanted and stem not in found and word.lower() not in _STOPWORDS:
            found[stem] = word.lower()
    return list(found.values())[:limit]


def mean_vector(vectors: np.ndarray) -> np.ndarray:
    mean = vectors.mean(axis=0)
    return mean / max(float(np.linalg.norm(mean)), 1e-12)


def relevance_from_similarities(topic_similarity: float, point_similarities: list[float], thresholds: RelevanceThresholds) -> dict:
    """0 = clearly off topic, 1 = weakly related, 2-5 = related, raised by prompt points covered."""
    covered = [s >= thresholds.point for s in point_similarities]
    if topic_similarity < thresholds.off_topic:
        score = 0
    elif topic_similarity < thresholds.weak:
        score = 1
    elif covered:
        score = 2 + round(3 * sum(covered) / len(covered))
    else:
        score = 4
    return {"score": score, "offTopic": score == 0, "topicSimilarity": round(float(topic_similarity), 4),
            "pointsCovered": sum(covered) if covered else None, "pointsTotal": len(covered) if covered else None,
            "thresholdsVersion": thresholds.version}


def load_thresholds(path: Path = THRESHOLDS_PATH) -> RelevanceThresholds:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return RelevanceThresholds(**raw["thresholds"])


class SentenceEmbedder:
    """Mean-pooled, L2-normalised MiniLM embeddings from the local cache only."""

    def __init__(self, device: str = "cpu"):
        import torch
        from transformers import AutoModel, AutoTokenizer
        self.torch, self.device = torch, device
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION, local_files_only=True)
        self.model = AutoModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION, local_files_only=True).to(device).eval()

    def encode(self, texts: list[str], batch_size: int = 64) -> np.ndarray:
        out = []
        with self.torch.inference_mode():
            for i in range(0, len(texts), batch_size):
                batch = self.tokenizer(texts[i:i + batch_size], padding=True, truncation=True, max_length=256, return_tensors="pt").to(self.device)
                hidden = self.model(**batch).last_hidden_state
                mask = batch["attention_mask"].unsqueeze(-1).to(hidden.dtype)
                pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
                out.append(self.torch.nn.functional.normalize(pooled, dim=1).cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, 384), dtype=np.float32)


class RelevanceScorer:
    def __init__(self, embedder: SentenceEmbedder, thresholds: RelevanceThresholds):
        self.embedder, self.thresholds = embedder, thresholds

    def similarities(self, essay: str, prompt: str) -> tuple[float, list[float], list[int]]:
        sentences = essay_sentences(essay) or [essay]
        points = prompt_points(prompt)
        vectors = self.embedder.encode(sentences + [prompt_topic_text(prompt)] + points)
        sent, topic, point_vecs = vectors[: len(sentences)], vectors[len(sentences)], vectors[len(sentences) + 1:]
        topic_similarity = float(mean_vector(sent) @ topic)
        if not len(point_vecs):
            return topic_similarity, [], []
        matrix = point_vecs @ sent.T
        return topic_similarity, [float(v) for v in matrix.max(axis=1)], [int(i) for i in matrix.argmax(axis=1)]

    def score(self, essay: str, prompt: str) -> dict:
        topic_similarity, point_sims, best = self.similarities(essay, prompt)
        result = relevance_from_similarities(topic_similarity, point_sims, self.thresholds)
        sentences = essay_sentences(essay) or [essay]
        result["points"] = [{"point": point, "covered": sim >= self.thresholds.point,
                             "evidence": sentences[index] if sim >= self.thresholds.point else None}
                            for point, sim, index in zip(prompt_points(prompt), point_sims, best)]
        result["keywords"] = matched_keywords(prompt, essay)
        result["model"] = f"{MODEL_ID}@{MODEL_REVISION[:8]}"
        return result


def thresholds_dict(thresholds: RelevanceThresholds) -> dict:
    return asdict(thresholds)
