# Backlog cải thiện AI Writing

`P0` xử lý chất lượng trước. `P1` giải quyết nền dữ liệu/CEFR và độ tin cậy triển khai. `P2` chuẩn bị nâng cấp sau khi có nguồn và quyền. Các tiêu chí dưới đây cần được chốt với nhóm trước khi mở holdout.

## P0 · GEC Reliability

- **Vấn đề và tái hiện.** Có omission trong câu synthetic đã được sửa một phần, phản ánh sửa thừa/đổi nghĩa chưa được đo trên tập đích. Chạy lệnh localhost trong [GEC hiện hành](04_GEC_MODEL_AND_FAILURES.md) và kiểm đầu ra raw riêng với endpoint guarded.
- **Nguồn và bước làm.** [inference.py](../../ai/writing/inference.py), [gec_safety.py](../../ai/writing/gec_safety.py), [evaluate_gec.py](../../ai/writing/evaluate_gec.py), [audit_gec.py](../../ai/writing/audit_gec.py), [writing-revision.ts](../../frontend/src/lib/writing-revision.ts). Khóa run, hash data/config/order, gom clean & error cases có gold. Phân loại ERRANT FP/FN/meaning change rồi ablate phân đoạn, token budget, decoding và guard từng biến. Kiểm tra mất mệnh đề, coverage và offset riêng. Chỉ khi rõ nguyên nhân mới đề xuất hard negatives, làm sạch gold, bổ sung nhóm lỗi hoặc thử fine-tune có control. So baseline theo rule nếu được phê duyệt.
- **Phụ thuộc và nghiệm thu.** Adapter/cache đúng hash, dữ liệu có quyền, người chấm. Bộ regression tái hiện có raw/guarded/served và TP/FP/FN theo nhóm. Candidate phải qua [gate](06_AI_EVALUATION_PROTOCOL.md). Rủi ro chính là lấy recall đổi precision, guard chặn sửa đúng và tối ưu quá khớp dev. Chưa có xác nhận cải thiện với adapter hiện hành trên test độc lập.

## P0 · Topic Adherence Evaluation

- **Vấn đề và tái hiện.** Cùng bài với hai prompt khác nhau đi vào `/analyze` bằng cùng text, corrections. Check [test_service.py](../../ai/writing/tests/test_service.py) cho hợp đồng không nhận topic. Feedback mở rộng hiện tắt.
- **Nguồn và bước làm.** [WritingTaskCatalogue.cs](../../backend/EnglishLearning.Api/Services/WritingTaskCatalogue.cs), [WritingAiClient](../../backend/EnglishLearning.Api/Services/WritingAiClient.cs), [local_feedback.py](../../ai/writing/local_feedback.py). Chốt rubric Relevance và Completion tách CEFR, soạn minimal pairs đúng đề/lạc đề/trùng từ khóa/chép đề/vắng requirement, chấm hai người. Đo baseline lexical rồi embeddings/cross-encoder với bằng chứng cấp yêu cầu. Model học hoặc LLM là phương án sau khi baseline và quyền đã chốt.
- **Phụ thuộc và nghiệm thu.** Rubric, người chấm, tài liệu cấp quyền. Báo per-class recall nhóm lạc đề và F1 requirement, consistency trên bộ tương phản, agreement người chấm và protocol dữ liệu tách prompt. Chưa có gold độc lập hoặc evaluator được nghiệm thu. Rủi ro là đo giỏi tiếng Anh thay độ bám đề, và cho điểm cao bài chỉ nhắc lại từ khóa.

## P1 · CEFR Quality

- **Vấn đề và tái hiện.** So `run.json` và `test-metrics.json` của adapter, phân tích nhầm giữa band lân cận và support A1/C2. Tái chạy [predict.py](../../ai/writing/predict.py) trên bài synthetic cho lỗi policy và `>512` token chỉ để xác nhận hợp đồng.
- **Bước làm.** Khóa model hiện tại, chuẩn hóa so sánh từ [CEFR và bám đề](05_CEFR_AND_TOPIC_ADHERENCE.md). Thu nhãn đủ support theo band, kiểm tương tác độ dài/đề/learner, chọn ngưỡng abstain/calibration trên dev riêng. Không đánh đồng dự đoán và mục tiêu hồ sơ. Chỉ so prompt-aware/pilot khi dataset thiết kế được khả năng tổng quát hóa.
- **Nghiệm thu.** Báo QWK, MAE, accuracy, fixed6 macro-F1, confusion matrix, coverage và khoảng bất định theo band/prompt. Không promote khi còn thiếu nhóm đích hoặc hạ độ tin cậy chỉ để tăng accuracy tổng. Calibration và giá trị sư phạm còn thiếu.

## P1 · Evaluation Data and Benchmarks

- **Vấn đề và tái hiện.** Mở manifest GEC và CEFR, kiểm data hashes so với split cục bộ. Held-out GEC nguồn/ID thiếu gold, CEFR test lịch sử đã xem. Không tải/sao chép corpus từ đồng nghiệp.
- **Bước làm.** [data.py](../../ai/writing/data.py), [training_state.py](../../ai/writing/training_state.py) và [protocol đánh giá](06_AI_EVALUATION_PROTOCOL.md). Lập registry mục đích, consent/license, learner–prompt split, adjudication, ID/order/hash và số ca bị loại. Tạo mẫu nhỏ synthetic cho guard trước, rồi bộ dev hợp lệ và bộ độc lập khóa một lần. Lưu các lỗi busy/timeout/model unavailable và adapter provenance, tránh giữ dữ liệu nhạy cảm trong logs/test fixture.
- **Nghiệm thu.** Identity của mỗi run tái lập được trên môi trường được duyệt, đủ nhóm lỗi và dữ liệu chấm độc lập. Mọi phép đo so candidate/control cùng protocol. Nếu thiếu quyền hoặc người chấm giữ BLOCKED. Rủi ro chính là trùng phiên bản/learner, nhãn gián tiếp và lộ corpus.

## P1 · SQL và khả năng chạy lại

- **Vấn đề.** Migration history lệch ID baseline và model Grammar có khác CHECK, SQL lock/concurrency chưa nghiệm thu. Hồ sơ runtime hoạt động cục bộ, quyền phân phối adapter chưa xác nhận.
- **Bước làm và nghiệm thu.** Theo [bàn giao database](08_DATABASE_AND_PENDING_WORK.md) và [danh mục artifact](09_ENV_MODELS_AND_ARTIFACTS.md). Duyệt catalog test, chạy test hai connection và cleanup theo scope, giữ dữ liệu ứng dụng. Duyệt nguồn artifact, kiểm SHA và thử cold start trên máy mới trước xác nhận handoff AI. Tránh đánh dấu done khi chỉ pass ASP.NET InMemory hoặc chỉ health 200.

## P2 · Vocabulary Recommendations và nguồn Flashcards

- **Vấn đề và tái hiện.** Gợi ý dựa vào GEC và 17 mẫu cụm từ. Xem test `FlashcardTests` để tái hiện dedupe và ghi chú `validatedSource`; thử bài chứa biến thể ngoài 17 mẫu trên môi trường test để đo miss. Mục tiêu CEFR của bài chỉ cung cấp ngữ cảnh; thiếu xếp hạng vocabulary theo nghĩa.
- **Bước làm.** [WritingCardCandidates.cs](../../backend/EnglishLearning.Api/Services/WritingCardCandidates.cs), [đề xuất vocabulary](../../ai/writing/WRITING_VOCABULARY_CEFR_PROPOSAL.vi.md), [đề xuất provenance](../../WRITING_FLASHCARDS_SOURCE_PROPOSAL.vi.md). Lập gold theo lemma/cụm/nghĩa/span, đo candidate recall trước ranking, chỉ thử nguồn lexical CEFR có quyền. Sau duyệt schema, bind card+submission và kiểm xóa/quyền/duplicate trên SQL. Review state hiện theo phiên trình duyệt; nếu cần đồng bộ đa thiết bị, thêm yêu cầu riêng cho quyền sở hữu, conflict và dữ liệu legacy.
- **Nghiệm thu.** Báo candidate coverage, precision@K và tính phù hợp nghĩa theo band trên bộ độc lập. Không gán CEFR từ cấp bài cho từng thẻ. Link chỉ đạt khi ghi theo transaction, truy xuất đúng owner và có test SQL nhiều nguồn. Chưa có cơ sở chất lượng hoặc quyền corpus lexical được duyệt.

## P2 · GEC/Gemini Hybrid Research

- **Vấn đề và tái hiện.** Offline replay synthetic có ba nhánh, không có benchmark provider thực tế. Chạy `test_gec_gemini_replay.py`, kiểm M2 và trạng thái timeout.
- **Bước làm.** [Protocol](../../ai/writing/GEC_GEMINI_PROTOCOL.vi.md) · [Quyền benchmark](../../ai/writing/GEC_GEMINI_BENCHMARK_APPROVAL.vi.md) · [Replay](../../ai/writing/gec_gemini_replay.py). Ghim model/version, budget, latency, corpus được phép và người chấm độc lập. So GEC-only, Gemini-only, Hybrid paired, giữ A bất biến. Đánh giá diễn đạt phù hợp CEFR riêng. Ghi error, chi phí, cache và retention.
- **Nghiệm thu.** Có benchmark thật được duyệt, kết quả định lượng và đánh giá mù về giữ nghĩa, omission và false edit, đủ baseline và các ca timeout. Gemini chưa có bằng chứng cải thiện, không dùng để duyệt hoặc thay đầu ra production. Rủi ro gồm sai gold, biến động model, chi phí, riêng tư và độ trễ.
