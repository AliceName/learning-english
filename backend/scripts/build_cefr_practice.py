"""Build reviewable CEFR-SP practice content from the completed audit, without SQL writes."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
LICENSES = {"SCoRE": "CC BY-NC-SA 4.0", "Wiki-Auto": "CC BY-SA 3.0"}
UPSTREAM = "https://github.com/yukiar/CEFR-SP"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(audit, source, training, output):
    summary = json.loads((audit / "mapping-summary.json").read_text(encoding="utf-8"))
    for relative, expected in summary["source_sha256"].items():
        if digest(source / Path(relative.replace("\\", "/"))) != expected:
            raise ValueError(f"Source changed after audit: {relative}")
    if digest(training / "configs/phone_mapping.json") != summary["mapping_sha256"]:
        raise ValueError("Serving phone mapping changed after audit; rerun audit first")
    candidates = [json.loads(line) for line in (audit / "pilot-candidates.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(candidates) == json.loads((audit / "summary.json").read_text(encoding="utf-8"))["pilotCandidates"]
    unique, aliases = {}, []
    for item in candidates:
        assert item["level"] in LEVELS and item["annotatorA"] == item["annotatorB"] == LEVELS.index(item["level"]) + 1
        assert item["status"] in ("mapped_full", "mapped_partial") and item["coverage"] >= .8
        assert .3 <= item["duration"]["secondsRate-2"] <= 10
        assert len(item["text"]) <= 300 and item["wordCount"] <= 35
        key = re.sub(r"[^a-z0-9']+", " ", item["text"].lower()).strip()
        if key in unique:
            if unique[key]["level"] != item["level"]:
                raise ValueError("Duplicate prompt has conflicting CEFR labels")
            aliases.append({"keptId": unique[key]["id"], "duplicate": item})
        else:
            unique[key] = item
    groups = defaultdict(list)
    for row in unique.values():
        corpus = row["source"].replace("\\", "/").split("/")[1]
        assert corpus in LICENSES
        groups[(row["level"], corpus)].append(row)
    courses, provenance = [], []
    for level in LEVELS:
        for corpus in LICENSES:
            items = sorted(groups[(level, corpus)], key=lambda row: (row["source"], row["line"]))
            for start in range(0, len(items), 120):
                course_title = f"CEFR-SP {level} — {corpus} · Phần {start // 120 + 1:02d}"
                license = LICENSES[corpus]
                lessons = []
                part = items[start:start + 120]
                for offset in range(0, len(part), 10):
                    chunk = part[offset:offset + 10]
                    lesson_title = f"Luyện đọc {level} — Bộ câu {offset // 10 + 1:02d}"
                    goals = (f"Đọc từng câu, nghe lại rồi ghi âm tối đa 12 giây. Cấp {level} là độ khó câu do hai người đánh giá CEFR-SP cùng gán, không phải kết quả đánh giá trình độ của bạn. "
                             "Bài luyện thử nghiệm: có thể có từ chưa được đánh giá; xem tỷ lệ âm đã chấm trong kết quả. Thời lượng đã kiểm tra bằng giọng tổng hợp, chưa xác nhận với người đọc thật.\n"
                             f"Nguồn: CEFR-SP / {corpus}, Arase, Uchida & Kajiwara (2022). {license}. {UPSTREAM}")
                    lessons.append({"title": lesson_title, "goals": goals, "sentences": [row["text"] for row in chunk]})
                    for index, row in enumerate(chunk):
                        provenance.append({**row, "courseTitle": course_title, "lessonTitle": lesson_title, "sentenceIndex": index,
                                           "corpus": corpus, "license": license, "upstream": UPSTREAM})
                courses.append({"level": level, "title": course_title,
                                "description": (f"Bài đọc thử nghiệm CEFR-SP {level}, nhãn đồng thuận của hai người đánh giá. "
                                                "Các câu đã qua kiểm tra mapping ít nhất 80% âm và audio giọng tổng hợp chậm không quá 10 giây; chưa xác nhận thời gian người học đọc hoặc độ chính xác điểm AI. "
                                                f"Nguồn: {corpus}; {license}. Arase, Uchida & Kajiwara, EMNLP 2022. {UPSTREAM}"), "lessons": lessons})
    manifest = {"source": UPSTREAM, "selectionAuditSha256": digest(audit / "pilot-candidates.jsonl"),
                "mappingSha256": summary["mapping_sha256"], "inputCandidates": len(candidates), "duplicatePromptsRemoved": len(aliases),
                "courseCount": len(courses), "lessonCount": sum(len(c["lessons"]) for c in courses), "sentenceCount": len(provenance),
                "sentencesByLevel": dict(Counter(row["level"] for row in provenance)),
                "humanReadingValidated": False, "acousticScoringValidated": False,
                "sourceSha256": summary["source_sha256"], "duplicateAliases": aliases, "sentences": provenance}
    assert manifest["sentenceCount"] + len(aliases) == len(candidates)
    assert len({(r["courseTitle"], r["lessonTitle"], r["sentenceIndex"]) for r in provenance}) == len(provenance)
    output.mkdir(parents=True, exist_ok=True)
    for name, value in (("courses.json", courses), ("provenance.json", manifest)):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("inputCandidates", "duplicatePromptsRemoved", "courseCount", "lessonCount", "sentenceCount", "sentencesByLevel")}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--training-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.audit, args.source, args.training_root, args.output)
