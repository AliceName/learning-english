# Kiểm chứng độ chính xác Speaking — 21/11/2026

## Đã làm và kết quả có thật

- Đối chiếu checkpoint với manifest train, nhãn và đặc trưng đã trích xuất: **24.923 mẫu âm vị, 100 người nói trong train**. Không dùng nhãn test để quyết định âm nào được chấm.
- `/ʒ/` (`ZH`) có **0 mẫu train**. Bộ chấm hiện loại âm này khỏi các âm có điểm, giữ nguyên vị trí căn chỉnh và báo từ chỉ chấm được một phần. Không tự gán điểm 0. `/ɑ/` (`AA`, 24 mẫu) và `/ɔɪ/` (`OY`, 19 mẫu) được ghi rõ là ít dữ liệu trong báo cáo; số mẫu dương không chứng minh chấm đáng tin.
- Artifact hỗ trợ được khóa theo checksum checkpoint, mapping, schema đặc trưng và manifest train; modelVersion đổi để tránh so sánh điểm cũ/mới như cùng một bộ chấm.
- Kiểm tra model thật trên CPU đã chạy thành công với mẫu công khai `We call it bear`. Thử câu `The decision was a pleasure to discuss.` xác nhận 2 vị trí ZH được bỏ khỏi danh sách có điểm (26 → 24). Đây là kiểm tra phần mềm và mapping, **không phải kiểm chứng độ chính xác người Việt**.
- Chuẩn bị **300 nhiệm vụ thu âm cho 20 mã người nói**, 15 nhiệm vụ mỗi người. Chưa có bản thu người Việt và chưa có điểm người chấm thật. Báo cáo ban đầu và đề xuất ngưỡng hiện đều trả `insufficient_data`.

Model và ngưỡng 0,4/0,7 hiện chưa được huấn luyện/hiệu chỉnh lại. Sửa bộ lọc âm chưa train giúp tránh một loại kết luận thiếu căn cứ; chưa thể công bố độ chính xác tăng bao nhiêu.

Kiểm thử đã chạy đạt: 23 kiểm thử Python serving/hiệu chỉnh/bộ lọc, 10 kiểm thử evaluator và 9 kiểm thử quy trình benchmark. Kiểm thử Chrome thật xác minh lưu đúng WAV, tách phiếu hai người chấm, yêu cầu nghe trước khi lưu, chặn ghi đè và chặn request khác origin. Kiểm tra model thật trên CPU đạt; artifact số mẫu train được sinh lại và đối chiếu có checksum giống hệt. Những kết quả này xác minh phần mềm, không thay thế đánh giá phát âm bằng người thật.

## Thu âm và chấm độc lập

Công cụ chạy local tại [http://127.0.0.1:8013](http://127.0.0.1:8013). Từ gốc kho mã, chuẩn bị bộ thu thập nếu chưa có rồi mở trang. Ví dụ dưới đây dùng đường dẫn Python trên máy phát triển; đổi đường dẫn này nếu môi trường của bạn nằm ở nơi khác:

```powershell
$speakingPython = 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath reports/speaking-accuracy/vietnamese-pilot)) {
  & $speakingPython backend/scripts/speaking_benchmark.py prepare --workspace reports/speaking-accuracy/vietnamese-pilot --speakers 20
}
& $speakingPython backend/scripts/speaking_benchmark.py serve --workspace reports/speaking-accuracy/vietnamese-pilot --port 8013
```

1. Chọn **Thu thập bản ghi**, mã người nói và từng nhiệm vụ. Ghi bằng microphone hoặc nhập WAV PCM16. Bấm **Lưu bản thu** sau khi nghe lại. Mỗi mã cần là một người thật, dùng nhất quán; nên thu ở nhiều trình độ và thiết bị.
2. Bộ nhiệm vụ có đọc câu thông thường, hai ngữ cảnh của `read`, thiếu từ, đọc câu khác và tiếng nền. Làm theo hướng dẫn thu của từng nhiệm vụ. Đây là loại nhiệm vụ dự kiến, **không tự trở thành nhãn đúng/sai**.
3. Hai người có chuyên môn lần lượt chọn **Chấm độc lập** và đúng số người đánh giá của mình. Phiếu không hiện điểm AI, split hoặc câu được chỉ định đọc khác. Mỗi người nghe trước khi lưu nhận xét về nội dung, chất lượng âm thanh và điểm từng từ. Không tham khảo phiếu của người kia trước khi chấm.
4. Thống nhất tiêu chí 0–2 trước khi chấm. Thang điểm từ là thang thử nghiệm của bộ này, không phải điểm CEFR hay bản sao thang word-level chính thức của SpeechOcean762. Giọng Việt tự nó không phải lỗi phát âm.
5. Khi hai người bất đồng về nội dung/âm thanh hoặc lệch điểm từ hơn 1/2, mẫu được giữ lại để xem xét, không tự làm nhãn kết luận. Cần nghe và thống nhất lại độc lập trước khi đưa vào phân tích cuối.

Bản WAV đã lưu được giữ nguyên. Phiếu và dự đoán đều khóa theo SHA-256 của âm thanh; thay WAV sau khi chấm sẽ bị phát hiện. Dữ liệu ở `reports/speaking-accuracy/vietnamese-pilot`, không ghi database ứng dụng. Đây là công cụ local; số người đánh giá là quy ước làm việc, không có chức năng xác minh danh tính hoặc chuyên môn.

Theo bộ hiện tại, `vi001`–`vi012` thuộc train, `vi013`–`vi016` thuộc calibration, `vi017`–`vi020` thuộc test. Một người không được dùng nhiều mã để vượt qua cách chia này. Không mở kết quả test để điều chỉnh model hoặc ngưỡng; nếu đã dùng kết quả để điều chỉnh, cần người nói mới cho kiểm chứng tiếp theo.

## Chạy model và đo lỗi

Sau khi thu và chấm xong, chạy lần lượt. Dùng tên output mới cho từng lần để giữ lịch sử; công cụ từ chối ghi đè.

```powershell
$speakingPython = 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe'

# Chạy cùng pipeline đang phục vụ; mặc định chưa mở tập test.
& $speakingPython backend/scripts/speaking_benchmark.py score --workspace reports/speaking-accuracy/vietnamese-pilot --output reports/speaking-accuracy/run-01.results.jsonl

# Tìm ngưỡng từ chối ứng viên chỉ từ người nói calibration.
& $speakingPython backend/scripts/speaking_benchmark.py fit-gate --workspace reports/speaking-accuracy/vietnamese-pilot --results reports/speaking-accuracy/run-01.results.jsonl --output reports/speaking-accuracy/run-01.gate.json

# Sau khi đóng băng model và ứng viên, chấm cả test một lần.
& $speakingPython backend/scripts/speaking_benchmark.py score --workspace reports/speaking-accuracy/vietnamese-pilot --include-test --output reports/speaking-accuracy/run-01.with-test.results.jsonl

& $speakingPython backend/scripts/speaking_benchmark.py evaluate --workspace reports/speaking-accuracy/vietnamese-pilot --results reports/speaking-accuracy/run-01.with-test.results.jsonl --gate-candidate reports/speaking-accuracy/run-01.gate.json --output reports/speaking-accuracy/run-01.evaluation.json
```

Không thêm `--gate-candidate` khi tệp ứng viên vẫn là `insufficient_data`. `fit-gate` cần cả câu đúng và câu khác nội dung, ít nhất hai người nói calibration có dữ liệu đo được. Với dữ liệu ít, ứng viên chỉ là kết quả thăm dò; công cụ **không tự triển khai ngưỡng**. Khi dữ liệu đủ, cần kiểm tra độ ổn định theo người nói trước khi quyết định triển khai.

`score` nạp một model, xử lý lần lượt và dùng cache local. Có thể thêm `--limit 5` để thử trước. Đóng các tiến trình model không cần thiết hoặc chạy ở thời điểm phù hợp với RAM máy. Không cần cài/tải model mới cho quy trình này.

Trong báo cáo:

- `content_gate`: tỷ lệ từ chối câu đúng và chấp nhận câu khác nội dung của riêng cổng khoảng cách âm vị; loại bản thu méo/không rõ hoặc thiếu bằng chứng khỏi phép fit và thể hiện số mẫu đo được. Không coi đây là tỷ lệ lỗi của toàn pipeline.
- `recording_outcomes_by_human_content`: phân biệt đã chấm, cần ghi lại, lỗi căn chỉnh/âm thanh và thiếu dự đoán theo nhận xét nội dung của người chấm.
- `models/.../vietnamese_test/word`: MAE/RMSE trên những từ test được hai người chấm và model hỗ trợ đầy đủ. Không đổi MAE thành “AI đúng X%”. Tỷ lệ chấm được luôn phải đọc cùng sai số.
- Nhãn từ không được dùng để fit ngưỡng âm vị. Nếu cần đánh giá từng âm, phải gán nhãn và căn chỉnh vị trí thủ công rồi dùng công cụ `evaluate_speaking_human.py` cùng hướng dẫn trước tại `reports/speaking-human-validation/HUONG_DAN.md`. Các chỉ số âm vị không được tạo từ điểm từ.

## Pipeline train và phần còn cần

Báo cáo `pipeline-audit-final.json` xác nhận tên đặc trưng, nguồn manifest/nhãn và one-hot âm nguồn khớp. Cache cũ không lưu hash mã nguồn tính đặc trưng, vì vậy không thể xác nhận hồi tố mọi phép tính đặc trưng giống hệt phiên bản hiện tại. Việc căn chỉnh thời gian âm cũng chưa được người thật kiểm tra.

Mapping phục vụ ref2 vẫn cần được đánh giá/trích xuất lại trên nhãn âm vị đã căn chỉnh, đặc biệt các âm mới mở rộng hoặc rất ít mẫu. Chỉ nên train bổ sung sau khi xác định rõ âm nào chấm yếu và có nhãn phù hợp. Bản checkpoint, nhãn hiện có và artifact hiệu chỉnh điểm chưa bị thay thế trong lần này.

Các tệp kiểm chứng chính:

- `reports/speaking-accuracy/pipeline-audit-final.json`
- `reports/speaking-accuracy/real-model-smoke.json`
- `reports/speaking-accuracy/initial-evaluation.json`
- `reports/speaking-accuracy/gate-candidate.json`

`reports/` được Git bỏ qua theo mặc định; hướng dẫn được đưa vào kho mã riêng. Âm thanh, phiếu chấm thật, kết quả chạy và log giữ trên máy. Mã công cụ và artifact số mẫu train nằm ở `backend/`. Bộ 300 lượt dự kiến được sinh lại bằng lệnh `prepare`, không cần chia sẻ dữ liệu cá nhân để chạy công cụ.
