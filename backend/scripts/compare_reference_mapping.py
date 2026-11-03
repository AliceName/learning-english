"""Compare identical text audits. Coverage is not acoustic accuracy."""
import argparse
from collections import Counter
import json
from pathlib import Path
import statistics


def compare(before, after):
    summaries = [json.loads((directory / 'mapping-summary.json').read_text(encoding='utf-8')) for directory in (before, after)]
    assert summaries[0]['source_sha256'] == summaries[1]['source_sha256'], 'Source dataset differs'
    assert summaries[0]['mapping_sha256'] == summaries[1]['mapping_sha256'], 'Canonical phone inventory changed'
    data = [{r['id']: r for r in map(json.loads, (directory / 'mapping.jsonl').read_text(encoding='utf-8').splitlines())} for directory in (before, after)]
    old, new = data
    assert old.keys() == new.keys()
    recovered, regressions, word_regressions = [], [], []
    for key, row in old.items():
        improved = new[key]
        assert all(row.get(field) == improved.get(field) for field in ('text', 'level', 'annotatorA', 'annotatorB', 'source', 'line'))
        if row.get('coverage', 0) > improved.get('coverage', 0):
            regressions.append(key)
        if 'referenceTokens' in row and 'referenceTokens' in improved:
            assert row['referenceTokens'] == improved['referenceTokens'], 'Sentence reference length changed'
            for index, word in enumerate(row['words']):
                if word['status'] == 'scored' and improved['words'][index]['status'] != 'scored':
                    word_regressions.append({'id': key, 'word': word['text']})
        if row['status'] == 'rejected_phone_mapping' and improved['status'].startswith('mapped_'):
            recovered.append(key)
    candidates = [[r for r in rows.values() if 'wordCount' in r] for rows in data]
    assert len(candidates[0]) == len(candidates[1])
    result = {'checkedSentences': len(candidates[0]), 'recoveredSentences': len(recovered),
              'coverageRegressions': regressions, 'previouslyScoredWordRegressions': word_regressions,
              'beforeCounts': summaries[0]['counts'], 'afterCounts': summaries[1]['counts'],
              'meanCoverageIncludingRejectedAsZero': {name: statistics.mean(r.get('coverage', 0) for r in rows)
                                                       for name, rows in zip(('before', 'after'), candidates)},
              'canonicalMappingUnchanged': True, 'sourceDatasetUnchanged': True,
              'recoveredIds': recovered, 'acousticAccuracyImprovementMeasured': False}
    (after / 'comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    before_count, after_count = (Counter(r['status'] for r in rows) for rows in candidates)
    report = ['# Cải thiện mapping tham chiếu Speaking', '',
              f"So sánh trên cùng {len(candidates[0])} câu CEFR-SP, cùng dữ liệu và cùng bảng âm vị đã dùng để train. Không đổi trọng số, vocabulary, feature schema, câu mẫu hoặc nhãn CEFR.", '',
              '| Chỉ số | Trước | Sau |', '|---|---:|---:|',
              f"| Mapping đầy đủ | {before_count['mapped_full']} | {after_count['mapped_full']} |",
              f"| Mapping một phần | {before_count['mapped_partial']} | {after_count['mapped_partial']} |",
              f"| Từ chối mapping | {before_count['rejected_phone_mapping']} | {after_count['rejected_phone_mapping']} |",
              f"| Coverage trung bình theo câu, từ chối tính 0 | {result['meanCoverageIncludingRejectedAsZero']['before']:.2%} | {result['meanCoverageIncludingRejectedAsZero']['after']:.2%} |", '',
              f"Khôi phục {len(recovered)} câu từng bị từ chối; {len(regressions)} câu giảm coverage; {len(word_regressions)} từ từng được chấm chuyển thành không hỗ trợ.", '',
              'Thay đổi: dùng tất cả cách phát âm CMUdict khi khôi phục ranh giới; dùng G2P từ riêng lẻ chỉ làm bằng chứng ranh giới cho tên/từ ngoài từ điển; giữ các âm đối chiếu một-một chắc chắn trong từ có token gộp. Token gộp và vị trí còn mơ hồ không nhận điểm âm. Không dùng khoảng cách chỉnh sửa, dự đoán học viên hoặc nhãn giáo viên để ép đối chiếu.', '',
              'Cấu hình/weights train giữ nguyên; phục vụ dùng modelVersion có hậu tố ref2 và hash module để phân biệt kết quả lịch sử. Không so sánh điểm trước/sau như thể cùng phiên bản.', '',
              'Bản đo TTS được tái sử dụng từ audit cũ: IDs và câu gốc đã được đối chiếu, không tổng hợp lại hay đo người đọc thật. Số ứng viên mới trong summary.json chỉ là kết quả lọc kỹ thuật; không tự nhập thêm bài.', '',
              'Đây là cải thiện tương thích ký hiệu và độ phủ. Chưa đo độ chính xác chấm âm, ranh giới âm hoặc chất lượng trên người đọc thật. Không suy ra phần trăm accuracy từ coverage.']
    if (after / 'live-validation.json').is_file():
        live = json.loads((after / 'live-validation.json').read_text(encoding='utf-8'))
        report += ['', '## Kiểm tra dịch vụ thực tế', '',
                   f"Phiên bản trước: {live['oldModelVersion']}. Phiên bản sau: {live['newModelVersion']}.", '',
                   f"6 audio tổng hợp được chọn từ nhóm từng lỗi: trước {live['syntheticCasesBefore']}, sau {live['syntheticCasesAfter']}. Không đại diện accuracy trên người học.", '',
                   f"WAV mẫu công khai We call it bear: coverage {live['realDatasetBeforeCoverage']:.2%} → {live['realDatasetAfterCoverage']:.2%}. Không chấm tách token rhotic gộp. Xem live-before.json / live-after.json để đối chiếu."]
    (after / 'COMPARISON.md').write_text('\n'.join(report) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key != 'recoveredIds'}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    args = parser.parse_args()
    compare(args.before, args.after)
