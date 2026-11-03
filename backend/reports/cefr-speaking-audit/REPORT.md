# Kiểm tra CEFR-SP cho Speaking

Đây là báo cáo đọc dữ liệu; không nhập hoặc thay đổi database.

Đã đọc 10.004 dòng, chọn các dòng hai người đánh giá cùng nhãn. Trong 4.145 dòng đồng thuận, 832 dòng không qua kiểm tra định dạng hiện tại; kiểm tra mapping và tổng hợp audio cho 3.313 dòng còn lại. 5.859 dòng khác nhãn chưa được kiểm tra mapping/thời lượng trong đợt này.

Mapping gọi trực tiếp SpeakingEngine.build_reference của dịch vụ, cùng tokenizer/eSpeak/CMUdict/phone_mapping. Không nạp mô hình âm học và không kiểm chứng căn chỉnh âm thanh.

Thời lượng được đo bằng tổng hợp PCM 16 kHz mono, giọng Microsoft Zira Desktop, Rate 0 và -2: 6626 lượt audio. Không phải thời gian đọc của người học; không giữ tệp audio tổng hợp.

| Cấp | Đã kiểm tra | Mapping đầy đủ | Mapping một phần | Mapping từ chối | Audio chậm ≤12s | Gợi ý pilot |
|---|---:|---:|---:|---:|---:|---:|
| A1 | 76 | 34 | 37 | 5 | 76 | 53 |
| A2 | 573 | 143 | 352 | 78 | 573 | 301 |
| B1 | 1237 | 109 | 871 | 257 | 1235 | 414 |
| B2 | 1008 | 14 | 718 | 276 | 980 | 132 |
| C1 | 393 | 0 | 285 | 108 | 366 | 24 |
| C2 | 26 | 0 | 18 | 8 | 20 | 0 |

Thời lượng tốc độ thường: trung vị 4.995s, dài nhất 12.475s. Tốc độ chậm: trung vị 6.055s, dài nhất 15.050s. Có 63 câu vượt 12 giây ở giọng chậm.

Trong 732 câu bị từ chối mapping: 729 do chưa tách được ranh giới từ, 3 do token/âm ngoài giới hạn hỗ trợ. Các từ chưa được chấm và chi tiết nguyên nhân nằm trong audit.csv và mapping-summary.json.

Gợi ý pilot: coverage ≥80% và audio tổng hợp chậm dài 0,3–10 giây, chừa khoảng cho giới hạn ghi âm 12 giây. Đây là quy tắc lọc kỹ thuật, chưa được hiệu chuẩn với người học. Không tách/cắt câu hoặc đổi nhãn CEFR.

Cần thử microphone bằng người đọc thật và kiểm chứng căn chỉnh/điểm chấm trước khi gọi đây là bộ bài đã xác nhận. Các từ chưa mapping được không được xem là phát âm sai.

Nguồn CEFR-SP: https://github.com/yukiar/CEFR-SP — Wiki-Auto: CC BY-SA 3.0; SCoRE: CC BY-NC-SA 4.0 theo README dữ liệu. Giữ source/split/dòng và hai nhãn gốc trong báo cáo.

Các tệp: summary.json (tổng kết), mapping-summary.json (hash và thống kê mapping), audit.csv (mọi dòng), mapping.jsonl (chi tiết mapping), durations.jsonl (đo audio tổng hợp), pilot-candidates.jsonl (ứng viên để thử người đọc thật).
