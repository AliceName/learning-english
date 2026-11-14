# Protocol đánh giá AI Writing

## 1. Khóa dữ liệu và giao thức trước khi sinh kết quả

- Mỗi nguồn cần bản mô tả gồm quyền sử dụng, quyền chia sẻ, biến thể thu thập, consent/PII, người chấm, vai trò train/dev/test và thời điểm khóa. Cambridge Write & Improve Corpus 2024 v2 có điều khoản riêng. Mỗi người xin access trực tiếp, không phân phối lại corpus và xin phép trước khi phát hành model hay thống kê dẫn xuất, kể cả khi nơi lưu riêng tư. Tôn trọng quy tắc không gửi bài người học ra dịch vụ ngoài khi chưa có phê duyệt. [Cambridge CUP&A](https://researchdatasets.cambridge.org/datasets/write-and-improve-corpus-2024)
- Chia theo learner và user–prompt set, giữ các revision cùng nhóm; thêm thử nghiệm prompt chưa thấy để đo dịch chuyển đề. Loại exact và near-duplicate trước khi khóa test, ghi nguồn, số mẫu bị loại và lý do. [data.py](../../ai/writing/data.py) hữu ích để tái dùng logic split/hash, cần bổ sung kiểm near-duplicate và prompt nếu làm bộ mới. Tách riêng các nhóm synthetic regression, dev rà lỗi và holdout kiểm cuối. Bộ lịch sử đã xem là dữ liệu chẩn đoán, không tái đặt tên thành blind test.
- Ghi manifest cùng SHA-256 từng split, ID và thứ tự item, bản tham chiếu, rubric, seed, script/source SHA và thư viện. Khóa adapter, base revision, tokenizer, phân đoạn, budgets, decoding, chính sách bỏ qua, guard, dữ liệu đầu vào và chính sách timeout. Benchmark candidate/control theo cặp trên cùng nguồn, cấu hình chỉ thay đúng biến đã đăng ký. Lưu đầu ra gốc và sản phẩm dẫn xuất trong kho riêng đã duyệt.

## 2. GEC · Tách chất lượng sửa khỏi độ phủ và UI

| Lớp | Đầu ra cần giữ | Phép đo |
|---|---|---|
| Raw model | Câu thô, EOS, lỗi/budget, thời gian | ERRANT TP/FP/FN, precision, recall, F0.5; lỗi theo loại và độ dài/nhiều mệnh đề |
| Sau hậu xử lý/guard | Bản giữ hoặc bỏ, reason, edit raw đã đạt/bị chặn | Các metric trên cùng mẫu; chênh lệch raw/guarded, tỷ lệ raw đúng bị chặn, raw sai lọt |
| Runtime cấp bài | Trạng thái accepted/rejected/over-budget/incomplete/timeout, 6 nhóm coverage, nội dung đầu ra | Tỷ lệ câu cần sửa bỏ sót toàn bộ/một phần, tỷ lệ câu đúng bị sửa, tỷ lệ bài có lỗi còn lại/được thêm, độ trễ/censoring |
| Trình bày | Span UTF‑16, baseline/result, loại diff, trạng thái review | Tỷ lệ ánh xạ đúng, reconstruction chính xác, ca lặp/CRLF/emoji/chồng lấn, chênh lệch giữa edit được đề xuất và edit được expert chấp nhận |

Dùng ERRANT 3.0.2 và spaCy model/seed cố định, cùng protocol khi đối chiếu. Precision = TP/(TP+FP), recall = TP/(TP+FN), F0.5 ưu tiên precision. Báo câu không sinh, quá budget, guard-hold và timeout trong mẫu số toàn bộ, song song chỉ số có điều kiện trên ca xử lý. Câu no-op gold có thể không hoàn hảo, cần rà thủ công ca tranh luận. Xác nhận sửa giữ nghĩa bằng nhân sự có chuyên môn chấm mù, có rubrics cho polarity, agent/action/time/quantity, yêu cầu đề và độ tự nhiên. Ghi lý do và trích span. Đo clean-edit rate trên bài sạch, và FP split theo clean/error contexts.

Công cụ có sẵn gồm [evaluate_gec.py](../../ai/writing/evaluate_gec.py) cho dev cân bằng raw, [audit_gec.py](../../ai/writing/audit_gec.py) cho chẩn đoán chi tiết, [gec_evaluation.py](../../ai/writing/gec_evaluation.py) cho ERRANT, và [gec_safety.py](../../ai/writing/gec_safety.py) cho guard. `--data-root` giải đường dẫn cũ và xác minh hash. Các file M2, predictions và report phát sinh có thể chứa dẫn xuất corpus, đặt ở thư mục riêng, không stage. Lệnh dưới đây là lệnh đánh giá có quyền, chạy vào thư mục **mới** và có thể mất thời gian trên CPU:

```powershell
$py = '.\ai\writing\.venv\Scripts\python.exe'
$run = '.\ai\writing\artifacts\gec-viet-full-18ep-bs2-ga8-20261111'
$data = '.\ai\writing\data\prepared-first-final'
$output = Join-Path $env:TEMP ('lewa-gec-dev-' + [guid]::NewGuid())
& $py .\ai\writing\evaluate_gec.py --run $run --data-root $data --output $output --device cpu
```

Không so trực tiếp số dev cân bằng raw với endpoint guarded, full dev hoặc held-out. Đối với GEC–Gemini lấy cùng input cho A/B/C, giữ nguyên A khi tạo C, báo riêng task diễn đạt theo CEFR, chi phí và timeout. Chỉ replay offline được phép trong bàn giao này. [Protocol](../../ai/writing/GEC_GEMINI_PROTOCOL.vi.md) · [Điều kiện benchmark](../../ai/writing/GEC_GEMINI_BENCHMARK_APPROVAL.vi.md) · [Replay](../../ai/writing/gec_gemini_replay.py)

## 3. CEFR · Độ chính xác, độ phủ và hiệu chuẩn

Báo accuracy, macro-F1 cố định sáu lớp, precision/recall/support từng band, MAE band, QWK, ma trận nhầm lẫn và số vượt budget/abstain. Chia theo độ dài, prompt seen/unseen, thể loại, nhóm learner, band và thiết bị nếu đủ mẫu. So với majority baseline và bootstrap theo learner/task. Dùng `predict.py` cho inference hoặc held-out khóa riêng, không chạy lặp với test lịch sử để chọn mô hình. Nếu đưa confidence vào sản phẩm sau này, lưu logits offline, kiểm reliability diagram/Brier/ECE, coverage–risk, fit calibration trên dev riêng. Tách probe stability thay whitespace/CRLF và lặp inference khỏi độ chính xác mức CEFR. [predict.py](../../ai/writing/predict.py)

## 4. Task relevance/completion · Gold riêng và chấm mù

Dùng rubric [CEFR và bám đề](05_CEFR_AND_TOPIC_ADHERENCE.md), mỗi requirement có ID, khái niệm và ví dụ `partial`. Hai người chấm độc lập, đánh dấu insufficient và sao chép đề, đồng thuận bằng người thứ ba hoặc phiên adjudication. Tính weighted kappa giữa người chấm trước khi xem model, sau đó macro-F1 theo độ bám đề, recall nhóm lạc đề, requirement-level precision/recall/F1, coverage, độ chính xác câu bằng chứng và độ nhất quán ở minimal pair. Đo false positive với keyword-stuffing và false negative với bài diễn đạt yếu mà vẫn trả lời đúng.

## 5. Tiêu chí nâng cấp

- Chốt ngưỡng trước test: mức cải thiện tối thiểu có ý nghĩa và khoảng tin cậy ghép cặp, guardrail clean FP/đổi nghĩa/hallucination/timeout, mức tối đa regression từng band và từng loại lỗi, bộ test quan sát được trên frontend. Khi sample nhỏ, báo khoảng không chắc chắn và nhận định có điều kiện.
- GEC candidate chỉ đi tiếp khi lợi ích trên holdout có gold, giảm omission hoặc tăng F0.5 theo gate, giữ nghĩa đạt human review, và không suy giảm precision/clean preservation ngoài biên đã duyệt. CEFR và bám đề có gate riêng. Model promotion còn cần quyền dữ liệu, latency/VRAM, rollback checkpoint, provenance và phê duyệt nhóm.
- HTTP 200, training loss, unit tests và synthetic replay chỉ xác nhận vận hành/hợp đồng. Báo quality verdict riêng. Lưu cả lượt lỗi và kết quả bất lợi. Nếu fail dừng ở checkpoint đã duyệt và chẩn đoán trước khi đề xuất train tiếp.
