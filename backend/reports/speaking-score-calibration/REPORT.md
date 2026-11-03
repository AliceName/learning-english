# Hiệu chỉnh điểm và phản hồi Speaking — 2026-10-27

Đã triển khai `cal1-f38fe9a705ac1e16`. Giữ nguyên điểm số của MLP vì hai cách biến đổi được thử làm tăng sai số validation. Điều chỉnh ngưỡng **ưu tiên luyện** và cách diễn giải kết quả; không kết luận mô hình chấm điểm chính xác hơn.

## Phương pháp và lựa chọn

- Checkpoint giữ nguyên SHA256 `68505cc756b1fbf8b475ae799f394bc635b6abade4a63fb6f047159ff3a484ff`.
- Dùng 5.891 âm vị validation được hỗ trợ, từ 25 người nói. Chia 5 fold theo người nói để fit và đánh giá transform; không để cùng người nói ở hai phía một fold.
- So sánh giữ nguyên điểm (identity), affine với hệ số dốc không âm và isotonic đơn điệu. Giới hạn đầu ra 0–2; chỉ thay identity khi MAE giảm ít nhất 0,002 trên validation ngoài fold.

| Transform | MAE validation ngoài fold | RMSE |
|---|---:|---:|
| Identity, được chọn | 0,078211 | 0,199434 |
| Affine | 0,092345 | 0,203106 |
| Isotonic | 0,090655 | 0,202167 |

Ngưỡng gợi ý ưu tiên được chọn trên validation: tối đa recall với ít nhất 30 âm được đánh dấu, precision ≥ 0,80 và cận dưới Wilson 95% ≥ 0,70. Nhãn đối chiếu là điểm trung bình chuyên gia của âm < 1,5/2, chỉ biểu thị gợi ý luyện tập, không phải nhãn thay âm/bỏ âm. Ngưỡng chọn: **1,10/2**; validation có 88 TP, 20 FP, precision 81,48%, recall 34,11%. Wilson là thống kê theo âm, không tính đầy đủ tương quan giữa các âm cùng người nói và không bảo đảm kết quả trên quần thể mới.

Đóng băng lựa chọn rồi mới đọc tập test. Test không được dùng để chọn transform/ngưỡng. Trên 30.865 âm được hỗ trợ, MAE trước/sau đều **0,107924**, RMSE đều **0,269179**.

| Gợi ý trên phần test được hỗ trợ | Ngưỡng cũ < 1,50 | Ưu tiên mới < 1,10 |
|---|---:|---:|
| Âm được đánh dấu | 1.211 | 759 |
| TP: được chuyên gia chấm < 1,5 | 809 | 585 |
| FP: được chuyên gia chấm ≥ 1,5 | 402 | 174 |
| Precision | 66,80% | 77,08% |
| Recall | 40,92% | 29,59% |
| F1 | 0,5075 | 0,4276 |

Ưu tiên mới giảm đánh dấu nhầm nhưng bỏ sót nhiều âm cần luyện hơn; không phải cải thiện mọi chỉ số. Vùng **1,10 đến dưới 1,50** được giữ dưới dạng “nên nghe lại” với màu nhạt, không khẳng định sai. Bảng chỉ so sánh âm vị; giao diện gom thành tối đa ba từ nên không suy ra trực tiếp precision/recall ở cấp từ hoặc câu.

## Hành vi đã triển khai

- Điểm âm 0–2, điểm từ là trung bình âm được chấm; điểm /100 là trung bình các âm được chấm nhân 50. Không gọi điểm /100 là phần trăm phát âm đúng. Hiển thị số âm đã chấm / số âm tham chiếu và coverage.
- < 1,10: gợi ý ưu tiên luyện, màu cam. Từ có âm thấp nhất được ưu tiên; không để điểm trung bình từ che mất âm yếu.
- 1,10–<1,50: nên nghe lại và so sánh với mẫu; không chẩn đoán lỗi. ≥ 1,50 không đồng nghĩa mọi âm đúng.
- Coverage < 80%: ghi rõ chỉ nhận xét phần đã chấm. 80% là quy tắc trình bày, chưa phải ngưỡng độ tin cậy đã hiệu chuẩn. Âm chưa hỗ trợ không bị tính điểm 0.
- Âm thanh clipping hoặc tỷ lệ chỉnh sửa chuỗi âm > 0,4: yêu cầu nghe/ghi âm lại, tạm ẩn gợi ý lỗi phát âm cụ thể. Đây là kiểm tra kỹ thuật ban đầu, chưa hiệu chuẩn riêng; ngưỡng từ chối > 0,7 giữ nguyên.
- Có nút nghe từ/câu bằng giọng tổng hợp và ghi âm lại ngay. Cách đặt môi/lưỡi là hướng dẫn tham khảo, không khẳng định âm thực tế người học đã phát ra.
- Trả `rawScore` và `interpretation`, gồm phiên bản, phương pháp, ngưỡng, phạm vi dữ liệu và chế độ phản hồi. Lưu trong JSON `SpeakingAttempts.PhonemeScores` hiện có, giữ version 1. Lịch sử cũ thiếu hai trường mới vẫn đọc được, dùng ngưỡng giao diện cũ 1,50 và có ghi chú. Không có migration hoặc thay đổi schema.
- Artifact khóa theo hash checkpoint, mapping, reference module và feature signature; khởi động báo lỗi nếu không khớp. Phiên bản phục vụ: `gop-ctc-mlp-68505cc756b1fbf8-ref2-470077d127db-cal1-f38fe9a705ac1e16`.

## Giới hạn bằng chứng

Validation trước đây đã được dùng chọn MLP; phép thử hiện tại chưa phải validation độc lập hoàn toàn. Features cache thuộc reference-v1, chỉ gồm âm được hỗ trợ ở baseline. Các âm mới được ref2 mở rộng và người học Việt Nam chưa có bộ kiểm chứng riêng. Không có dữ liệu mới chứng minh chấm trọng âm, ngữ điệu, độ trôi chảy hoặc năng lực CEFR.

## Xác minh

- Python: 20/20 kiểm thử đạt, gồm artifact sai hash/không đơn điệu, biên điểm/ngưỡng, phạm vi hỗ trợ và phản hồi chất lượng bản ghi.
- .NET: 45 kiểm thử đạt; 39 kiểm thử tùy chọn bỏ qua. Live test riêng gọi Python thật, lưu và đọc lại kết quả/lịch sử bằng EF InMemory, không ghi SQL.
- Frontend: lint, TypeScript và production build đạt; 5 kiểm thử WAV/phản hồi đạt, 1 kiểm thử live tùy chọn bỏ qua.
- 6 WAV giọng tổng hợp A1–C2 dùng lại từ smoke ref2 và 1 WAV người đọc công khai “We call it bear”: tất cả HTTP 200, điểm/coverage bằng baseline ref2. C2 coverage 61,90% nhận `limited_coverage`; mẫu thật coverage 88,89% nhận `normal`. Đây là kiểm tra tích hợp, không phải benchmark CEFR hay giọng Việt.
- Mẫu công khai được cố ý tăng âm lượng cho clipping: HTTP 200, có cảnh báo và `record_again`. Không dùng mẫu biến đổi này đo độ chính xác phát âm.
- API và Python đã khởi động lại với phiên bản mới. NuGet báo NU1900 do không truy cập được máy chủ kiểm tra lỗ hổng; kiểm thử vẫn chạy đạt.

Chi tiết: `calibration-report.json`, `threshold-grid.json`, `live-after.json`, `live-validation.json`. Artifact phục vụ: `../../speaking-ai/configs/scoring-calibration.json`.

Tái tạo thí nghiệm ngoại tuyến (không sửa trọng số, không ghi database):

```powershell
& 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe' backend/scripts/calibrate_speaking_scores.py --training-root 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining' --output backend/reports/speaking-score-calibration --artifact backend/speaking-ai/configs/scoring-calibration.json
```

Tài liệu phương pháp: [GroupKFold](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupKFold.html), [IsotonicRegression](https://scikit-learn.org/stable/modules/generated/sklearn.isotonic.IsotonicRegression.html). Kết quả số ở trên được tính từ dữ liệu cục bộ, không lấy từ các tài liệu này.
