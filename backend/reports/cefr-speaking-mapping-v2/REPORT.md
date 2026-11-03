# Kiểm tra CEFR-SP cho Speaking

Đây là báo cáo đọc dữ liệu; không nhập hoặc thay đổi database.

Đã đọc 10004 dòng, chọn các dòng hai người đánh giá cùng nhãn. Trong 4145 dòng đồng thuận, 832 dòng không qua kiểm tra định dạng hiện tại; kiểm tra mapping cho 3313 dòng còn lại. 5859 dòng khác nhãn chưa được kiểm tra mapping/thời lượng trong đợt này.

Mapping gọi trực tiếp SpeakingEngine.build_reference của dịch vụ, cùng tokenizer/eSpeak/CMUdict/phone_mapping. Không nạp mô hình âm học và không kiểm chứng căn chỉnh âm thanh.

Thời lượng được đo bằng tổng hợp PCM 16 kHz mono, giọng Microsoft Zira Desktop, Rate 0 và -2: 6626 lượt audio. Không phải thời gian đọc của người học; không giữ tệp audio tổng hợp.

| Cấp | Đã kiểm tra | Mapping đầy đủ | Mapping một phần | Mapping từ chối | Audio chậm ≤12s | Gợi ý pilot |
|---|---:|---:|---:|---:|---:|---:|
| A1 | 76 | 34 | 41 | 1 | 76 | 64 |
| A2 | 573 | 157 | 388 | 28 | 573 | 400 |
| B1 | 1237 | 118 | 1013 | 106 | 1235 | 679 |
| B2 | 1008 | 17 | 855 | 136 | 980 | 270 |
| C1 | 393 | 0 | 352 | 41 | 366 | 40 |
| C2 | 26 | 0 | 22 | 4 | 20 | 1 |

Thời lượng tốc độ thường: trung vị 4.995s, dài nhất 12.475s. Tốc độ chậm: trung vị 6.055s, dài nhất 15.050s. Có 63 câu vượt 12 giây ở giọng chậm.

Có 316 câu bị từ chối mapping. Các từ chưa được chấm và chi tiết nguyên nhân nằm trong audit.csv và mapping-summary.json; chưa xác nhận chất lượng điểm phát âm.

Gợi ý pilot: coverage ≥80% và audio tổng hợp chậm dài 0,3–10 giây, chừa khoảng cho giới hạn ghi âm 12 giây. Đây là quy tắc lọc kỹ thuật, chưa được hiệu chuẩn với người học. Không tách/cắt câu hoặc đổi nhãn CEFR.

Cần thử microphone bằng người đọc thật và kiểm chứng căn chỉnh/điểm chấm trước khi gọi đây là bộ bài đã xác nhận. Các từ chưa mapping được không được xem là phát âm sai.

Nguồn CEFR-SP: https://github.com/yukiar/CEFR-SP — Wiki-Auto: CC BY-SA 3.0; SCoRE: CC BY-NC-SA 4.0 theo README dữ liệu. Giữ source/split/dòng và hai nhãn gốc trong báo cáo.

Các tệp: summary.json (tổng kết), mapping-summary.json (hash và thống kê mapping), audit.csv (mọi dòng), mapping.jsonl (chi tiết mapping), durations.jsonl (đo audio tổng hợp), pilot-candidates.jsonl (ứng viên để thử người đọc thật).
