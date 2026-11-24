# Kiểm chứng chấm Speaking với người Việt

Hiện chưa có bộ ghi âm người Việt được người thật chấm độc lập trong lần làm việc này. Vì vậy, `evaluation.empty.json` có trạng thái `insufficient_data`; đây là kiểm tra công cụ chạy được, không phải kết quả về độ chính xác AI. Hai tệp mẫu JSONL được để trống có chủ ý. Các số trong unit test là dữ liệu giả để kiểm tra phép tính, tuyệt đối không dùng làm bằng chứng chất lượng phát âm.

Công cụ mới `backend/scripts/evaluate_speaking_human.py` bổ sung phép so sánh độc lập; không thay thế script hiệu chỉnh SpeechOcean762 hiện có và không thay đổi model, điểm, ngưỡng hay database.

## Chuẩn bị nhãn độc lập

1. Thu bản ghi âm thật từ những người đồng ý tham gia, gồm cả câu đọc tốt và câu có âm cần luyện. Dùng mã người nói và mã bản ghi ẩn danh. Giữ lại bản ghi khó/chất lượng thấp để thống kê tỷ lệ không chấm được.
2. Người đánh giá nghe âm thanh và chấm từng âm vị trên thang **0–2**, theo cùng tiêu chí của nhãn phát âm gốc. Nên có ít nhất hai người đánh giá độc lập và giải quyết trường hợp bất đồng. Không cho người đánh giá xem điểm AI trước khi chấm. Công cụ chỉ kiểm tra cấu trúc nhãn; không thể xác nhận ai đã chấm hay chất lượng chuyên môn.
3. Chia **theo người nói** thành `train`, `calibration`, `test`. Một người không được xuất hiện trong nhiều nhóm. Dùng `train`/`calibration` cho các thay đổi sau này; chỉ mở `test` sau khi đóng băng model và ngưỡng. Khi đã xem kết quả test để điều chỉnh model, cần người nói mới cho lần kiểm chứng độc lập tiếp theo.
4. Lưu một nhãn trên mỗi dòng JSON của tệp references. Mỗi cặp `recordingId` + `unitId` là duy nhất. Giữ nguyên toàn bộ nhãn gốc. Không đổi nhãn cho khớp AI.

| Trường references | Giá trị cần có |
| --- | --- |
| `recordingId`, `speakerId` | Mã bản ghi và người nói ẩn danh, nhất quán |
| `unitId` | Mã vị trí âm/từ đã kiểm tra thủ công, dùng chung bên predictions |
| `unitType` | `phoneme` hoặc `word` |
| `split` | `train`, `calibration` hoặc `test` |
| `referenceText` | Câu mẫu chính xác |
| `nativeLanguage` | `vi` cho người có tiếng mẹ đẻ là tiếng Việt |
| `source` | `human` |
| `humanScores` | Mảng điểm thực tế của các người chấm, tất cả thuộc 0–2 |

Không tự đổi thang điểm 0–100 thành 0–2. Không đưa tổng điểm câu vào hàng âm vị. Nhãn từ có thể so sánh MAE riêng, nhưng không dùng ngưỡng luyện âm vị để kết luận từ đó đúng/sai.

## Xuất dự đoán đã đóng băng

Chạy model thực tế trên đúng các bản ghi đã chấm và chuyển kết quả thành predictions JSONL. Mỗi dòng chứa `recordingId`, `unitId`, `referenceText`, `modelVersion`, `calibrationId`, `status`, `score`.

- `modelVersion`: nhận diện rõ model/mapping/code đang đo, nên dùng checksum artifact hoặc mã commit kèm phiên bản mapping.
- `calibrationId`: phải khớp artifact truyền vào. Hiện là `cal1-f38fe9a705ac1e16`; đọc lại tệp calibration khi phiên bản thay đổi.
- `status: scored`: `score` là điểm **đã hiệu chỉnh cuối cùng** trên 0–2. Không nhập GOP thô, điểm phần trăm hay áp dụng hiệu chỉnh thêm lần nữa.
- Khi chưa đủ căn cứ: `score: null` và `status` là `unsupported`, `record_again` hoặc `rejected`. Không tự gán điểm 0.
- Giữ mã vị trí ổn định giữa hai tệp. Mảng âm trong API có thể bỏ các âm không hỗ trợ: lấy chỉ số mảng đó làm vị trí nguyên gốc có thể ghép nhầm âm. Kiểm tra căn chỉnh với câu mẫu/âm thanh trước khi so sánh.
- Chỉ xuất các vị trí đã được gán nhãn. Dự đoán cho vị trí không có nhãn, trùng mã, khác câu mẫu hoặc khác calibration sẽ bị từ chối để tránh ghép sai.

Có thể chứa nhiều `modelVersion` trong một tệp predictions để so sánh trước/sau, nhưng tất cả phải dùng cùng artifact hiệu chỉnh đang đánh giá. Nếu thay đổi calibration, chạy riêng với artifact tương ứng và chỉ so sánh trên cùng tập bản ghi/âm đã chấm. Công cụ không gọi API hay tự tạo bản ghi/dự đoán thay cho bạn.

## Chạy

Tại `D:\learning-english`, sau khi sao chép hai tệp mẫu và điền **nhãn/dự đoán thực tế**:

```powershell
& 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe' backend/scripts/evaluate_speaking_human.py `
  --references reports/speaking-human-validation/human-labels.jsonl `
  --predictions reports/speaking-human-validation/predictions.jsonl `
  --output reports/speaking-human-validation/evaluation.json
```

Nếu biết danh sách người nói đã dùng để train/hiệu chỉnh, thêm `--fit-speakers <đường-dẫn-tệp>`: mỗi dòng một mã người nói ẩn danh, cùng hệ mã với labels. Script từ chối test trùng bất kỳ mã nào trong danh sách đó. Nếu không cung cấp, script chỉ kiểm tra xung đột giữa các split trong references, chưa xác minh được lịch sử train thật của model.

Tệp `--calibration-artifact` mặc định là `backend/speaking-ai/configs/scoring-calibration.json`. Script kiểm tra fingerprint rồi đọc ngưỡng; không ghi lại artifact. Đầu ra không được trùng bất kỳ đầu vào nào. Báo cáo ghi SHA-256 của các tệp đầu vào để đối chiếu lần chạy.

## Đọc kết quả

- `status: insufficient_data`: chưa có âm/từ tiếng Việt thuộc test được chấm và ghép thành công. Không có nghĩa model đúng hay sai.
- `status: measured_comparison`: có phép đo trên số hàng được ghi rõ; không khẳng định đã kiểm chứng đủ độ chính xác cho người Việt.
- `models/<phiên-bản>/vietnamese_test/phoneme`: MAE, RMSE, số người/bản ghi, tỷ lệ chấm được, số hàng thiếu và bị từ chối. Phải đọc cả độ phủ khi so sánh điểm.
- `false_suggestions`: người chấm có điểm trung bình **từ 1.5/2 trở lên**, nhưng model dưới ngưỡng luyện hiện hành (hiện 1.1/2).
- `missed_weak`: người chấm dưới 1.5/2, nhưng model không đề nghị luyện. Các điểm bằng ngưỡng được tính ở phía không dưới ngưỡng.
- Hàng không chấm được không đưa vào MAE/đếm nhầm; vẫn nằm trong mẫu số độ phủ.
- `common_scored_model_comparison`: khi có nhiều phiên bản model, chỉ so sánh các vị trí được **tất cả** phiên bản chấm. Đọc mục này để tránh so sánh MAE trên những tập khác nhau.

Chưa thể coi `measured_comparison` là đủ dữ liệu: cần số người nói đa dạng, nhãn đáng tin cậy và tập test độc lập. Công cụ không có một ngưỡng số lượng tùy ý để tự tuyên bố model đã đạt chất lượng. Những gợi ý luyện chỉ nói điểm thấp, không chứng minh người học thay thế/mất một âm cụ thể.

Thư mục `reports/` được Git bỏ qua theo mặc định; hướng dẫn và hai tệp mẫu trống được đưa vào kho mã riêng. Nhãn thật, bản ghi và kết quả chạy được quản lý riêng phù hợp với sự đồng ý của người tham gia. Các script Python nằm ở `backend/scripts`.
