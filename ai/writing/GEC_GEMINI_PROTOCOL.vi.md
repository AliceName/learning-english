# GEC–Gemini · Đề cương thực nghiệm

Trạng thái **chuẩn bị offline**. Writing Studio tiếp tục dùng CEFR/GEC hiện tại. Quyền duyệt, phủ quyết hoặc tự áp dụng bản sửa trong sản phẩm chưa được quyết định.

## Dữ liệu và các nhánh

1. Dùng synthetic để kiểm hợp đồng. Dùng development để chốt prompt, quy tắc chọn đoạn và ngưỡng. Khóa tập nghiệm thu độc lập sau khi xác nhận nguồn, giấy phép, quyền truyền cho nhà cung cấp, khử trùng với train/dev và rà soát của chuyên gia. Giữ cấu trúc cặp cùng ID, nguyên văn, xuống dòng, dấu câu, yêu cầu đề và mục tiêu CEFR nếu có. Lưu hash, thứ tự, nhóm ca và phiên bản giao thức.
2. **A · GEC-only** dùng đúng checkpoint, tokenizer, guard, giới hạn câu và chế độ giải mã phục vụ. Lưu bản raw, bản sau guard, mã guard và độ phủ. Chốt trước dùng bản sau guard cho so sánh chính.
3. **B · Gemini-only** nhận cùng đầu vào tiếng Anh và nhiệm vụ sửa tối thiểu, độc lập với A. Chạy diễn đạt có mục tiêu CEFR như nhiệm vụ riêng để tránh chấm rewrite bằng gold sửa lỗi.
4. **C · Hybrid** là nhánh nghiên cứu. Ghi A làm bản gốc bất biến. Gửi danh sách ứng viên cần đối chiếu đã được chọn bằng rule đóng băng trên dev. Candidate có thể bị đánh dấu để người chấm xem lại. Để tính điểm C, áp dụng quy tắc thử nghiệm đã đăng ký trước trên bản sao kết quả. Báo riêng tỷ lệ được gửi đi và kiểm tra một mẫu đối chứng ngoài cổng chọn.
5. Đo lỗi bỏ sót bằng một nhánh kiểm tra riêng trên câu GEC không đổi, câu bị chặn và đoạn vượt giới hạn. Chỉ chấm gợi ý GEC đã tạo sẽ bỏ qua tập này. Mỗi ca sạch cần đo cả sửa thừa cấp câu lẫn cấp bài.

## Hợp đồng adapter nghiên cứu

Driver offline dùng interface `run(case, arm) -> recorded outcome`. Adapter A đọc kết quả GEC riêng, adapter B được cung cấp sau phê duyệt, adapter C nhận bản A bất biến cùng kết quả đối chiếu riêng. Mọi ghi chép nằm ngoài tầng phục vụ. Nhà cung cấp nhận nội dung như dữ liệu trích dẫn. Tắt tools, grounding và truy cập URL. Dùng schema JSON với các trường bắt buộc, rồi kiểm tra lại ngữ nghĩa ở client. [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

- Input gồm ID ca, đoạn nguồn, tác vụ và mục tiêu CEFR tùy chọn. Với C, thêm ID/span và đề xuất A chỉ cho đoạn cần đối chiếu. Span dùng UTF‑16, kiểm tra trích dẫn khớp nguồn, không chồng lấn và không cắt surrogate.
- Output cho sửa lỗi gồm mảng `{start, end, source, replacement}`. Output đối chiếu gồm candidate ID, `keep|question|abstain` và lý do. Output diễn đạt có câu gốc, bản đề xuất và lý do ở lớp riêng. Từ chối trường thừa, ID lạ, offset sai, trích dẫn lệch, hoặc kết quả quá giới hạn. Dùng timeout cố định và ghi rõ policy retry, không loại ca timeout khỏi mẫu.
- Lưu request hash, phiên bản model/provider, cấu hình sampling, prompt/schema hash, kết quả A/B/C độc lập, trạng thái, thời gian, token và giá đã chốt. Chi phí mỗi nhóm dùng token đã tính phí và bảng giá tại ngày chạy. [GenerateContent API](https://ai.google.dev/api/generate-content) · [Bảng giá](https://ai.google.dev/gemini-api/docs/pricing)

## Chấm và phân tích

- Tính TP/FP/FN, Precision/Recall/F0.5 theo cùng ERRANT và cùng cặp dữ liệu. Tách sửa sai, lỗi bỏ sót, sửa thừa trên ca sạch và ca chấp nhận nhiều gold. Đóng băng tokenizer/ERRANT/spaCy. Dùng paired bootstrap theo bài, công bố khoảng tin cậy và nhóm phân tích. Tập dev đã dùng tinh chỉnh chỉ là bằng chứng development.
- Hai người chấm độc lập, ẩn tên nhánh và đảo thứ tự. Chấm nghĩa, đúng ngữ pháp, tự nhiên, phù hợp mục tiêu CEFR và rủi ro đổi chủ thể, phủ định, tên riêng, số liệu. Chốt rubric và cách xử lý bất đồng trước. Đầu ra Gemini chỉ là một dự đoán.
- Báo tỷ lệ timeout, JSON sai và từ chối cùng p50/p95 trên các lượt gọi. Giữ thời gian timeout dưới dạng cận dưới và nêu cách tính, song song với số đo trên các lượt hoàn tất. Chi phí của C gồm cả lượt gọi đối chiếu. Chốt yêu cầu chất lượng và ngưỡng độ trễ/chi phí trước khi mở tập nghiệm thu.

## Replay cục bộ

`gec_gemini_replay.py` chỉ đọc JSON có sẵn. Tệp cases là mảng `{id, original, reference}`. Tệp records có đúng một dòng JSON-object trong mảng cho mỗi cặp `case_id` và `arm` (`gec_only`, `gemini_only`, `hybrid`). Mỗi bản ghi có `input_sha256`, `status`, `elapsed_ms`, `corrected` và `provenance` cho ca thành công. Trạng thái lỗi giữ `corrected: null`; replay đưa nguồn nguyên văn vào M2 của ca lỗi và giữ đếm lỗi trong manifest. Điều này mô phỏng fallback giữ nguyên bài, cần ghi cùng điểm số để thấy ảnh hưởng của lượt lỗi.

```text
python gec_gemini_replay.py --cases cases.json --records recorded.json --output replay --fixture-kind synthetic
python -m errant.commands.compare_m2 -hyp replay/gec_only.m2 -ref replay/reference.m2
```

Lặp lệnh chấm với hai nhánh còn lại, giữ thư mục kết quả riêng theo giao thức. Unit test synthetic kiểm bất đồng, nguồn CRLF, timeout, JSON sai và thiếu bản ghi. Benchmark API thật **BLOCKED** cho đến khi có phê duyệt model/version cụ thể, hạn mức/ngân sách, bộ dữ liệu được phép gửi, trách nhiệm lưu/xóa và điều khoản dữ liệu. Điều khoản có khác biệt theo loại dịch vụ và vùng, cần xác nhận trên tài khoản sẽ dùng. [Điều khoản Gemini API](https://ai.google.dev/gemini-api/terms)
