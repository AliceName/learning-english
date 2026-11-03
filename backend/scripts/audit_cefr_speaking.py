"""Read-only CEFR-SP audit using the serving engine's exact text/phone mapping path."""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--training-root", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    root = args.training_root.resolve()
    os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = str(root / ".tools/espeak-ng/eSpeak NG/libespeak-ng.dll")
    os.environ["ESPEAK_DATA_PATH"] = str(root / ".tools/espeak-ng/eSpeak NG")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    sys.path[:0] = [str(Path(__file__).resolve().parents[1] / "speaking-ai"), str(root / "scripts")]
    import cmudict
    from transformers import Wav2Vec2PhonemeCTCTokenizer
    from engine import SpeakingEngine, RecordingError, reference_words
    from phone_mapping import PhoneMapping
    from training_common import config, snapshot_path, file_digest

    cfg = config()
    tokenizer = Wav2Vec2PhonemeCTCTokenizer.from_pretrained(str(snapshot_path(cfg)), local_files_only=True)
    # No acoustic model, waveform, training labels or scorer weights needed for this symbolic check.
    engine = SpeakingEngine.__new__(SpeakingEngine)
    from types import SimpleNamespace
    engine.processor = SimpleNamespace(tokenizer=tokenizer)
    engine.mapping = PhoneMapping.load(root / cfg["features"]["phone_mapping"], tokenizer.get_vocab())
    engine.special = set(engine.mapping.document["special_tokens"].values())
    engine.lexicon = cmudict.dict()
    counts, word_issues, files = Counter(), Counter(), {}
    levels = {k: Counter() for k in ("A1", "A2", "B1", "B2", "C1", "C2")}
    attempted = 0
    with (args.output / "mapping.jsonl").open("w", encoding="utf-8") as out:
        for path in sorted((args.source / "CEFR-SP").glob("*/*.txt")):
            files[str(path.relative_to(args.source))] = file_digest(path)
            for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
                if not line.strip():
                    continue
                text, a, b = line.split("\t")
                a, b = int(a), int(b)
                counts["source_rows"] += 1
                row = {"id": hashlib.sha256((str(path.relative_to(args.source)) + ":" + str(number)).encode()).hexdigest()[:20],
                       "source": str(path.relative_to(args.source)), "line": number, "text": text,
                       "annotatorA": a, "annotatorB": b, "level": ("A1", "A2", "B1", "B2", "C1", "C2")[a - 1] if a == b else None}
                if a != b:
                    row.update(status="not_audited_label_disagreement", reason="Two annotators assigned different CEFR levels.")
                else:
                    level = levels[row["level"]]
                    counts["agreed_rows"] += 1
                    level["agreed"] += 1
                    try:
                        words = reference_words(text)
                    except RecordingError as e:
                        row.update(status="rejected_reference_format", reason=str(e))
                    else:
                        counts["reference_format_pass"] += 1
                        level["reference_format_pass"] += 1
                        attempted += 1
                        row["wordCount"] = len(words)
                        try:
                            tokens, _, phones, results = engine.build_reference(text)
                            coverage = len(phones) / len(tokens)
                            unsupported = [w["text"] for w in results if w["status"] != "scored"]
                            word_issues.update(w.lower() for w in unsupported)
                            status = "mapped_full" if coverage == 1 else "mapped_partial"
                            row.update(status=status, coverage=coverage, mappedPhones=len(phones), referenceTokens=len(tokens),
                                       unsupportedWords=unsupported, words=[{"text": w["text"], "status": w["status"], "reason": w['reason']} for w in results])
                            level[status] += 1
                            if coverage >= .8:
                                level["coverage_ge_80pct"] += 1
                        except RecordingError as e:
                            row.update(status="rejected_phone_mapping", reason=str(e))
                            level["rejected_phone_mapping"] += 1
                        if attempted % 100 == 0:
                            print(f"Mapped {attempted} candidates...", flush=True)
                counts[row["status"]] += 1
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
    reference_module = Path(__file__).resolve().parents[1] / 'speaking-ai/reference_mapping.py'
    summary = {"scope": "All rows parsed; exact serving mapping tested only on annotator-agreement rows passing reference_words.",
               "reference_mapping_sha256": file_digest(reference_module) if reference_module.is_file() else None,
               "acoustic_model_loaded": False, "mapping_sha256": file_digest(root / cfg["features"]["phone_mapping"]),
               "acoustic_model": cfg["acoustic_model"], "source_sha256": files, "counts": dict(counts),
               "levels": {k: dict(v) for k, v in levels.items()}, "most_common_unsupported_words": word_issues.most_common(40)}
    (args.output / "mapping-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary["counts"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
