# Điều kiện phê duyệt benchmark GEC–Gemini

Trạng thái **BLOCKED** cho đến khi chốt và ghi nhận các mục dưới đây. Protocol đang dùng ở [GEC_GEMINI_PROTOCOL.vi.md](GEC_GEMINI_PROTOCOL.vi.md).

- Xác nhận Gemini model ID/version, tài khoản, vùng xử lý và loại dịch vụ. Ghim prompt, schema, tham số, timeout, retry và quy tắc chọn đoạn cho Hybrid.
- Duyệt tổng ngân sách, giới hạn số lượt gọi/token, tốc độ, mức đồng thời và ngưỡng dừng. Báo chi phí và độ trễ kèm lượt lỗi.
- Chỉ định bộ dữ liệu, nguồn và quyền gửi cho bên thứ ba. Tách development khỏi tập đánh giá đã khóa, khử trùng với train/dev và thống nhất cách xử lý thông tin định danh.
- Duyệt trường được ghi trong phản hồi, nơi lưu, quyền đọc, thời hạn, xóa, chính sách của nhà cung cấp và cách lưu hash, provenance, lỗi, timeout. API key chỉ đi qua cơ chế secret đã duyệt.
- Chốt hai người chấm độc lập, rubric giữ nghĩa/diễn đạt CEFR, xử lý bất đồng và ngưỡng nghiệm thu. Dùng cùng ca cho GEC-only, Gemini-only và Hybrid, so ERRANT P/R/F0.5, sửa thừa, lỗi bỏ sót, lỗi gọi, độ trễ và chi phí.
- Xác nhận mọi can thiệp của Hybrid chỉ chạy trên bản sao nghiên cứu. Quyền tác động kết quả trong ứng dụng cần quyết định riêng.
