"""Export all technically supported source prompts; never export learner audio or labels."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re


def normalize(text):
    return re.sub(r"[^a-z0-9']+", " ", text.lower()).strip()


def build(training_root, existing, output):
    existing_by_text = defaultdict(list)
    for item in existing:
        existing_by_text[normalize(item["text"])].append(item)
    unique = {}
    excluded = []
    hashes = {}
    counts = Counter()
    for split in ("train", "validation", "test"):
        path = training_root / "data" / "manifests" / f"{split}.jsonl"
        hashes[split] = hashlib.sha256(path.read_bytes()).hexdigest()
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            text = row["text"].strip()
            counts[split] += 1
            words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)*", text)
            reason = None
            if not words or len(words) > 35 or len(text) > 300:
                reason = "outside_reference_limits"
            elif not re.fullmatch(r'''[A-Za-z\s'".,!?;:\-]+''', text):
                reason = "unsupported_characters"
            if reason:
                excluded.append({"id": row["utterance_id"], "split": split, "text": text, "reason": reason})
                continue
            key = normalize(text)
            prompt = unique.setdefault(key, {"text": text, "wordCount": len(words), "sources": []})
            prompt["sources"].append({"utteranceId": row["utterance_id"], "split": split, "sourceSplit": row["source_split"]})

    groups = defaultdict(list)
    already_present = []
    for key, prompt in sorted(unique.items()):
        if key in existing_by_text:
            already_present.append({**prompt, "existing": existing_by_text[key]})
            continue
        # Structural practice bands only. These are NOT validated CEFR annotations.
        level = "A1" if prompt["wordCount"] <= 5 else "A2" if prompt["wordCount"] <= 9 else "B1"
        groups[level].append(prompt)

    courses = []
    manifest = []
    labels = {"A1": "Câu ngắn", "A2": "Câu vừa", "B1": "Câu dài"}
    for level in ("A1", "A2", "B1"):
        prompts = groups[level]
        for offset in range(0, len(prompts), 120):
            part = offset // 120 + 1
            title = f"SpeechOcean762 {level} — {labels[level]} · Phần {part:02d} (tham khảo)"
            lessons = []
            for start in range(offset, min(offset + 120, len(prompts)), 10):
                number = (start - offset) // 10 + 1
                lesson_title = f"{labels[level]} — Bộ câu {number:02d}"
                chunk = prompts[start:min(start + 10, offset + 120)]
                lessons.append({
                    "title": lesson_title,
                    "goals": "Luyện đọc từng câu riêng. Nội dung gốc SpeechOcean762 được nhập tự động, chưa rà soát ngữ pháp từng câu. Cấp độ chỉ ước lượng theo độ dài câu, không phải nhãn CEFR. Dùng giọng đọc trình duyệt; không dùng kết quả làm benchmark độc lập.",
                    "sentences": [p["text"] for p in chunk],
                })
                for index, prompt in enumerate(chunk):
                    manifest.append({**prompt, "estimatedLevel": level, "courseTitle": title, "lessonTitle": lesson_title, "sentenceIndex": index})
            courses.append({"level": level, "title": title, "description": "Ngân hàng câu SpeechOcean762, chia nhóm theo độ dài để luyện phát âm. A1: tối đa năm từ; A2: sáu đến chín từ; B1: từ mười từ. Đây là phân nhóm kỹ thuật tham khảo, chưa được chuyên gia xác nhận CEFR. Transcript gốc chưa được biên tập từng câu. Có câu từ tập train, validation và test; không dùng điểm luyện làm đánh giá độc lập cho mô hình. Không kèm bản ghi giọng người học hoặc điểm giáo viên.", "lessons": lessons})
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "dataset": "SpeechOcean762", "repository": "https://github.com/jimbozhang/speechocean762",
        "manifestSha256": hashes, "sourceRecords": sum(counts.values()), "splitCounts": dict(counts),
        "uniqueSupportedPrompts": len(unique), "duplicateSupportedRecords": sum(len(p["sources"]) - 1 for p in unique.values()),
        "alreadyPresentPrompts": len(already_present), "newPrompts": len(manifest), "newCourses": len(courses),
        "newLessons": sum(len(c["lessons"]) for c in courses), "newPromptsByEstimatedLevel": {k: len(v) for k, v in groups.items()},
        "classification": "word-count-only structural bands, not validated CEFR; no C1/C2 assigned",
        "excluded": excluded, "alreadyPresent": already_present, "prompts": manifest,
    }
    assert len(unique) == len(manifest) + len(already_present)
    assert sum(counts.values()) == len(unique) + report["duplicateSupportedRecords"] + len(excluded)
    for name, value in (("courses.json", courses), ("provenance.json", report)):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("prompts", "alreadyPresent", "manifestSha256", "excluded")}, ensure_ascii=False))
    print(f"Excluded records: {len(excluded)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--training-root", type=Path, required=True)
    parser.add_argument("--existing", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.training_root, json.loads(args.existing.read_text(encoding="utf-8-sig")), args.output)
