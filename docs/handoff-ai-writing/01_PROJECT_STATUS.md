# Trạng thái dự án và Writing Studio

Mốc kiểm kê là working tree nhánh `Viet` trên HEAD đầu vào `ac4cd71`. Các dòng live health ghi nhận lần kiểm tra đầu, khi backend và AI đang nghe. Lần kiểm sau không thấy listener ở cổng 5000/8000, nên cần gọi lại health khi dựng phiên mới. Xem [bàn giao Git](11_GIT_HANDOFF_AND_RELEASE.md) để biết commit và các kết quả test của đợt bàn giao.

**DONE** nghĩa là có mã triển khai và bằng chứng trong phạm vi ghi rõ. **PARTIAL** nghĩa là chỉ đạt một phần hành vi. **BLOCKED** nghĩa là thiếu điều kiện để hoàn thành hoặc nghiệm thu. **NOT VERIFIED** nghĩa là chưa có phép đo hoặc test phù hợp.

| Hạng mục | Triển khai | Kiểm thử và giới hạn |
| --- | --- | --- |
| Frontend · Phase 1 | **DONE**. Next.js có trang Writing, bản gốc và bản nháp đối chiếu, CEFR dự đoán, lịch sử, preflight, trạng thái lỗi và nháp theo phiên. | Test frontend kiểm tra render, proxy, nháp và giới hạn nhập. Bố cục responsive có trong mã. Nghiệm thu browser với SQL thật là **NOT VERIFIED**. |
| Frontend · Phase 2 | **DONE**. Nhận, bỏ qua và hoàn tác gợi ý. Bộ lọc loại/trạng thái và liên kết span–thẻ. Khôi phục quyết định trong session, xử lý Unicode, UTF-16, CRLF và câu lặp. | Test diff, review và draft kiểm các trường hợp này. Chỉnh sửa thủ công làm mất ánh xạ chính xác thì UI giới hạn thao tác dựa trên span. Đồng bộ qua thiết bị là **NOT VERIFIED** và chưa được triển khai. |
| Backend · Phase 3 | **DONE** ở tầng mã. Tạo phiên bản từ bài nguồn, giữ kết quả lịch sử, dùng request ID để phát lại lần nộp, lưu CEFR mục tiêu từ hồ sơ. | Frontend và EF InMemory dùng fixture kiểm luồng. Nghiệm thu numbering, transaction, retry đồng thời trên SQL thật là **BLOCKED**. |
| Flashcards · Phase 4 | **PARTIAL**. Gợi ý từ GEC và 17 mẫu cục bộ, xem trước, chỉnh, chọn lưu vào bộ thẻ chung, dùng lịch SM-2 và dò trùng. | Test InMemory kiểm quyền sở hữu, dò trùng và nguồn hợp lệ lúc lưu. Quan hệ nguồn Card–Submission bền vững và xếp hạng từ/cụm theo CEFR đã kiểm định còn thiếu. |
| SQL Server | **PARTIAL**. Kết nối ứng dụng và metadata hiện tại đọc được. | SQL writes và concurrency chưa được nghiệm thu. Baseline lệch ID, ràng buộc Grammar còn lệch model hiện hành, catalog test riêng chưa được xác nhận. Xem [tồn đọng SQL](08_DATABASE_AND_PENDING_WORK.md). |
| CEFR classifier | **DONE** cho phục vụ và hiển thị ước lượng trên bài. Live health báo `cefr-my-first-run`. | Chất lượng theo từng lớp, domain, độ dài và generalization cần đánh giá lại theo bằng chứng ở [CEFR và bám đề](05_CEFR_AND_TOPIC_ADHERENCE.md). |
| GEC | **PARTIAL**. Live health báo `gec-viet-full-18ep-bs2-ga8-20261111`, sửa lỗi đang bật. ByT5 + guard tạo đề xuất và coverage. | Sửa thừa, bỏ sót và đổi nghĩa là ưu tiên chẩn đoán. Bằng chứng benchmark và giới hạn riêng của đúng run ở [GEC và lỗi](04_GEC_MODEL_AND_FAILURES.md). |
| Độ bám đề và feedback | **BLOCKED** cho nghiệm thu chất lượng bám đề. Runtime trả `feedbackStatus=disabled`. | Đề, hướng dẫn số từ và tự kiểm yêu cầu đã có. Chưa có bộ đánh giá Task Relevance/Task Completion được kiểm định. |
| Gemini | **DONE** cho protocol và offline replay. **BLOCKED** cho benchmark API thật. | Replay synthetic kiểm contract, cách ghi outage và provenance. Chưa có kết quả chất lượng Gemini hoặc hybrid. Cần phê duyệt theo [checklist benchmark](../../ai/writing/GEC_GEMINI_BENCHMARK_APPROVAL.vi.md). |

Đọc [luồng dữ liệu](03_ARCHITECTURE_AND_DATA_FLOW.md) để tìm code của từng phase. Dùng [backlog](07_AI_IMPROVEMENT_BACKLOG.md) để chọn hai việc P0 đầu tiên. Khả năng chạy trên máy mới phụ thuộc artifact ngoài Git như mô tả trong [danh mục model](09_ENV_MODELS_AND_ARTIFACTS.md).
