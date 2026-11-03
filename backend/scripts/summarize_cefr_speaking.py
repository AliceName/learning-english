"""Join symbolic mapping and measured synthetic-speech durations; never imports lessons."""
import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics


def main(directory):
    rows = [json.loads(line) for line in (directory / "mapping.jsonl").read_text(encoding="utf-8").splitlines()]
    durations = [json.loads(line) for line in (directory / "durations.jsonl").read_text(encoding="utf-8").splitlines()]
    lookup = {d["id"]: d for d in durations}
    expected = [r for r in rows if r["status"] in ("mapped_full", "mapped_partial", "rejected_phone_mapping")]
    assert len(lookup) == len(durations) == len(expected), "Missing/duplicate duration results"
    assert {r["id"] for r in expected} == set(lookup), "Duration IDs differ from mapping candidate IDs"
    levels, candidates = {}, []
    for row in rows:
        row["duration"] = lookup.get(row["id"])
        if row["duration"]:
            normal, slow = (row["duration"][key] for key in ("secondsRate0", "secondsRate-2"))
            assert normal > 0 and slow > 0
            row["ttsFits12sNormal"] = .3 <= normal <= 12
            row["ttsFits12sSlow"] = .3 <= slow <= 12
            # Explicit selection heuristic; does not validate real learner timing or pronunciation quality.
            row["suggestedForPilot"] = row.get("coverage", 0) >= .8 and .3 <= slow <= 10
            if row["suggestedForPilot"]:
                candidates.append(row)
    for level in ("A1", "A2", "B1", "B2", "C1", "C2"):
        items = [r for r in rows if r["level"] == level and r["duration"]]
        counts = Counter(r["status"] for r in items)
        counts.update({"checked": len(items), "fits12sNormal": sum(r["ttsFits12sNormal"] for r in items),
                       "fits12sSlow": sum(r["ttsFits12sSlow"] for r in items), "pilotCandidates": sum(r["suggestedForPilot"] for r in items)})
        levels[level] = dict(counts)
    summary = {"createdAtUtc": datetime.now(timezone.utc).isoformat(), "sourceRows": len(rows), "agreementFormatCandidates": len(expected),
               "synthesizedSentenceCount": len(durations), "synthesizedAudioCount": 2 * len(durations),
               "voice": durations[0]["voice"], "rates": [0, -2], "audioSampleRate": 16000,
               "humanReadingMeasured": False, "acousticAlignmentValidated": False,
               "levels": levels, "mappingRejectReasons": dict(Counter(r["reason"] for r in rows if r["status"] == "rejected_phone_mapping")),
               "pilotRule": "Annotators agree, serving reference mapping coverage >= 0.8, slower synthesized audio duration 0.3–10 seconds. Not validated for human readers.",
               "pilotCandidates": len(candidates), "normalDurationMedian": statistics.median(d["secondsRate0"] for d in durations),
               "normalDurationMax": max(d["secondsRate0"] for d in durations),
               "slowDurationMedian": statistics.median(d["secondsRate-2"] for d in durations),
               "slowDurationMax": max(d["secondsRate-2"] for d in durations)}
    (directory / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    with (directory / "pilot-candidates.jsonl").open("w", encoding="utf-8") as stream:
        for r in candidates:
            stream.write(json.dumps(r, ensure_ascii=False) + "\n")
    columns = ["id", "source", "line", "level", "annotatorA", "annotatorB", "text", "status", "coverage", "unsupportedWords", "secondsRate0", "secondsRate-2", "suggestedForPilot", "reason"]
    with (directory / "audit.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow({**r, "unsupportedWords": " | ".join(r.get("unsupportedWords", [])), **(r["duration"] or {})})
    mapping_counts = json.loads((directory / 'mapping-summary.json').read_text(encoding='utf-8'))['counts']
    report = ["# Kiểm tra CEFR-SP cho Speaking", "", "Đây là báo cáo đọc dữ liệu; không nhập hoặc thay đổi database.", "",
              f"Đã đọc {len(rows)} dòng, chọn các dòng hai người đánh giá cùng nhãn. Trong {mapping_counts['agreed_rows']} dòng đồng thuận, {mapping_counts['rejected_reference_format']} dòng không qua kiểm tra định dạng hiện tại; kiểm tra mapping cho {len(expected)} dòng còn lại. {mapping_counts['not_audited_label_disagreement']} dòng khác nhãn chưa được kiểm tra mapping/thời lượng trong đợt này.", "",
              "Mapping gọi trực tiếp SpeakingEngine.build_reference của dịch vụ, cùng tokenizer/eSpeak/CMUdict/phone_mapping. Không nạp mô hình âm học và không kiểm chứng căn chỉnh âm thanh.", "",
              f"Thời lượng được đo bằng tổng hợp PCM 16 kHz mono, giọng {summary['voice']}, Rate 0 và -2: {summary['synthesizedAudioCount']} lượt audio. Không phải thời gian đọc của người học; không giữ tệp audio tổng hợp.", "",
              "| Cấp | Đã kiểm tra | Mapping đầy đủ | Mapping một phần | Mapping từ chối | Audio chậm ≤12s | Gợi ý pilot |",
              "|---|---:|---:|---:|---:|---:|---:|"]
    for level, c in levels.items():
        report.append(f"| {level} | {c['checked']} | {c.get('mapped_full', 0)} | {c.get('mapped_partial', 0)} | {c.get('rejected_phone_mapping', 0)} | {c['fits12sSlow']} | {c['pilotCandidates']} |")
    report += ["", f"Thời lượng tốc độ thường: trung vị {summary['normalDurationMedian']:.3f}s, dài nhất {summary['normalDurationMax']:.3f}s. Tốc độ chậm: trung vị {summary['slowDurationMedian']:.3f}s, dài nhất {summary['slowDurationMax']:.3f}s. Có {sum(c['checked'] - c['fits12sSlow'] for c in levels.values())} câu vượt 12 giây ở giọng chậm.", "",
               f"Có {mapping_counts['rejected_phone_mapping']} câu bị từ chối mapping. Các từ chưa được chấm và chi tiết nguyên nhân nằm trong audit.csv và mapping-summary.json; chưa xác nhận chất lượng điểm phát âm.", "",
               "Gợi ý pilot: coverage ≥80% và audio tổng hợp chậm dài 0,3–10 giây, chừa khoảng cho giới hạn ghi âm 12 giây. Đây là quy tắc lọc kỹ thuật, chưa được hiệu chuẩn với người học. Không tách/cắt câu hoặc đổi nhãn CEFR.", "",
               "Cần thử microphone bằng người đọc thật và kiểm chứng căn chỉnh/điểm chấm trước khi gọi đây là bộ bài đã xác nhận. Các từ chưa mapping được không được xem là phát âm sai.", "",
               "Nguồn CEFR-SP: https://github.com/yukiar/CEFR-SP — Wiki-Auto: CC BY-SA 3.0; SCoRE: CC BY-NC-SA 4.0 theo README dữ liệu. Giữ source/split/dòng và hai nhãn gốc trong báo cáo.", "",
               "Các tệp: summary.json (tổng kết), mapping-summary.json (hash và thống kê mapping), audit.csv (mọi dòng), mapping.jsonl (chi tiết mapping), durations.jsonl (đo audio tổng hợp), pilot-candidates.jsonl (ứng viên để thử người đọc thật)."]
    (directory / "REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    main(parser.parse_args().directory)
