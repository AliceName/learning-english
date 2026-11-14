# CEFR và độ bám đề

## Khả năng đang có

**PARTIAL · Ước lượng CEFR ngôn ngữ.** `cefr-my-first-run` dùng `microsoft/deberta-v3-base` với LoRA sequence classification sáu mức A1–C2. Runtime tokenize nguyên bài gốc, giới hạn 512 token, chế độ essay-only, softmax logits và lấy argmax nội bộ. Kết quả API trả band, không có confidence đã hiệu chuẩn. Bài quá giới hạn hoặc không đạt input policy bị từ chối. Policy kiểm lượng/chất lượng đầu vào sơ bộ, không phải detector đáng tin cho tiếng Anh hay nội dung hợp lý. [inference.py](../../ai/writing/inference.py) · [cefr_input.py](../../ai/writing/cefr_input.py)

**DONE trong luồng API · Hai giá trị CEFR độc lập.** CEFR dự đoán lưu ở `WritingSubmissions.CefrLevel`. Mục tiêu xuất phát từ Hồ sơ cá nhân `Users.TargetLevel`, được snapshot theo phiên bản trong JSON `practice.targetCefr`. `POST /submissions` bác override `targetCefr`; retry trả snapshot cũ. Khi xem lịch sử, giữ mục tiêu đã lưu, hoặc ghi nhận chưa có snapshot trên bài legacy. [WritingController.cs](../../backend/EnglishLearning.Api/Controllers/WritingController.cs) · [writing-comparison.tsx](../../frontend/src/app/writing/writing-comparison.tsx)

**BLOCKED về chất lượng bám đề · Chưa có bộ chấm Task Relevance/Completion đã kiểm định.** Thư viện đề và rubric có ở [WritingTaskCatalogue.cs](../../backend/EnglishLearning.Api/Services/WritingTaskCatalogue.cs) và [writing-task-library.tsx](../../frontend/src/app/writing/writing-task-library.tsx). Backend giải ID/version và lưu snapshot đề trong phân tích, hoặc lưu topic tự nhập. Payload chính `/analyze` chỉ chứa `text` và `corrections`. Tick yêu cầu và ngưỡng số từ là hỗ trợ tự kiểm, không được tính thành điểm. Đề có thể đi đến nhánh nhận xét riêng qua `FeedbackAsync` nếu cờ local bật. [WritingAiClient.cs](../../backend/EnglishLearning.Api/Services/WritingAiClient.cs) · [local_feedback.py](../../ai/writing/local_feedback.py)

Nhánh nhận xét tùy chọn dùng Qwen2.5-1.5B-Instruct GGUF qua llama.cpp local. Prompt nhận bài gốc, đề hoặc topic và gợi ý GEC đã chấp nhận bởi pipeline. Output có thể sinh nhận xét định tính có bằng chứng trích dẫn cho `content`/organization/vocabulary/grammar, qua kiểm tra schema và chuỗi trích dẫn. Kiểm tra hợp đồng chỉ bảo đảm định dạng và trích dẫn, chưa xác nhận nhận xét đúng. `/health` ở lượt bàn giao trả feedback disabled. Template GEC vẫn có thể giải thích edit, tách biệt với nhận xét. [Feedback local trong README](../../README.md)

## Bằng chứng CEFR

- `run.json` của adapter lưu base revision, seed, hyperparameter, hash train/dev, tokenizer budget và `dev_metrics`. Dữ liệu chọn bài cuối có nhãn CEFR của người chấm, giữ split chính thức W&I và lọc trùng đầu vào theo pipeline [data.py](../../ai/writing/data.py).
- `test-metrics.json` là phép đo held-out lịch sử đã xem, có accuracy, macro-F1 cố định A1–C2, MAE, within-one, QWK, majority baseline, ma trận nhầm lẫn, support/F1 mỗi band và bài vượt budget. Các nhóm cần rà trước là B1/B2 và hai đầu thang A1/C2. Rà support và hướng nhầm từ matrix trước khi diễn giải F1. F1 quy ước bằng 0 ở lớp rỗng không đo được năng lực thật. Số liệu corpus cụ thể nằm trong artifact được kiểm soát, không chép lên Git.
- Báo cáo cục bộ `artifacts/cefr-evaluation-foundation-20261028-v2/REPORT.vi.md` đối chiếu dev và các probe synthetic. Khi xem ảnh hưởng độ dài, rà support và phân phối band/topic mỗi bin. Kiểm trùng prompt giữa train/dev trước khi suy ra kết quả cho đề mới. Một nhóm probe lặp bài và thay whitespace/CRLF cho band ổn định; probe ngoại ngữ và đoạn vô nghĩa vẫn có thể trả band. Đây là giới hạn vận hành từng ca.
- Chưa xác nhận calibration, generalization độc lập theo learner/prompt/domain hay ổn định đa thiết bị trên tập chuẩn. Model A1/C2 chưa đủ bằng chứng để dùng cho quyết định học tập. Pilot boundary/11 sublevel và prompt-essay là nghiên cứu riêng. Ghi chú cục bộ: `ai/writing/CEFR_BOUNDARY_PILOT.vi.md` nếu được cấp quyền.

## Rubric nghiên cứu dự kiến

| Chiều | Mức và cơ sở chấm |
|---|---|
| Language Proficiency | Nhãn CEFR theo khả năng sử dụng tiếng Anh. Báo độ tin cậy và chênh lệch band với người chấm. |
| Task Relevance | 0 lạc đề; 1 chỉ có liên hệ bề mặt hoặc chủ yếu chung chung; 2 phần lớn liên quan; 3 trả lời trực tiếp vấn đề/ngữ cảnh của đề. Trích câu hỗ trợ. |
| Task Completion | Mỗi yêu cầu có ID. 0 vắng/không trả lời; 1 có đề cập hoặc hoàn thành một phần; 2 trả lời có nội dung. Báo từng yêu cầu và dẫn chứng. |
| Coherence & Organization | 0 khó theo dõi đến 3 cấu trúc hợp lý và liên kết rõ. Chấm độc lập với Relevance, ghi lý do khi không đủ bằng chứng. |

Thêm trạng thái `insufficient` cho bài quá ngắn và cờ sao chép đề, không đổi CEFR chỉ vì bám đề hay đổi điểm task chỉ vì ngữ pháp sạch. Bộ test tối thiểu theo cùng đề có bài hoàn chỉnh, một phần, chung chung, tiếng Anh tốt nhưng lạc đề, keyword-stuffing, bám đề nhưng tiếng Anh yếu, chép đề, quá ngắn và thiếu một yêu cầu riêng. Giữ nguyên bài nhưng đổi đề làm đối chứng, giữ nguyên nghĩa và thay độ trôi chảy để phát hiện nhầm tín hiệu.

## Lộ trình

1. Dùng rubric từng task và hai người chấm độc lập, khóa cách resolve bất đồng trên development trước khi đánh giá mù.
2. So độ trùng từ khóa như baseline yếu với sentence embeddings đa đoạn và cross-encoder `prompt/requirement × đoạn`. Kiểm tra trích dẫn đúng vị trí và bao phủ từng yêu cầu. Similarity cao vẫn có thể do lặp lại đề.
3. Nếu cần, huấn luyện hoặc hiệu chuẩn classifier task relevance trên prompt/learner tách khỏi test. LLM evaluator chỉ thử khi quyền dữ liệu, model, chi phí và rubric đã chốt, đánh giá ngang các phương án khác. Đề xuất endpoint độc lập khi có bằng chứng và phê duyệt.
4. Báo macro-F1, per-class recall (nhất là lạc đề), weighted kappa, lỗi bị từ chối/coverage, F1 theo từng requirement và độ đồng thuận giữa người chấm. Đọc [protocol](06_AI_EVALUATION_PROTOCOL.md) để chọn phép đo và gate trước khi mở holdout.
