# Màu từng từ trong kết quả Speaking — 2026-10-31

Trước đây câu chỉ tô tối đa ba từ lấy từ `practiceTargets`; chế độ cần ghi âm lại xóa danh sách này nên toàn câu đen. Hiện việc phân màu toàn câu độc lập với giới hạn ba gợi ý chi tiết.

| Màu | Điều kiện ở cal1 | Ý nghĩa |
|---|---|---|
| Xanh | Điểm âm thấp nhất ≥ 1,50; từ được hỗ trợ đầy đủ | Điểm tốt theo mô hình, không bảo đảm phát âm đúng |
| Vàng | 1,10 ≤ điểm âm thấp nhất < 1,50 | Nên nghe lại |
| Đỏ | Điểm âm thấp nhất < 1,10 | Ưu tiên luyện |
| Xám | Chưa hỗ trợ, thiếu/không hợp lệ điểm, từ mới chấm một phần nhưng điểm cao | Chưa đủ dữ liệu cho toàn từ |
| Xám toàn câu | `feedbackMode=record_again` | Cần ghi âm lại trước khi kết luận đúng/sai |

Ngưỡng đọc từ metadata của từng kết quả; bản cũ dùng ngưỡng 1,50. Từ chấm một phần có thêm gạch dưới nét đứt. Màu cảnh báo đỏ/vàng có thể áp dụng cho âm đã chấm trong từ một phần, vẫn giữ nhãn phạm vi. Màu dựa trên âm yếu nhất để điểm trung bình từ không che khuất âm yếu. Không đổi điểm, model, API hay database.

`sentenceFeedback` ghép theo index và đối chiếu nội dung từ, không ghép theo chữ đơn thuần. Giữ dấu câu/khoảng trắng, phân biệt vị trí các từ lặp, hỗ trợ dấu nháy thẳng/cong. Từ thiếu hoặc không khớp trả trạng thái xám. Chú thích màu, tooltip điểm và nhãn ẩn hỗ trợ người dùng không chỉ dựa vào màu sắc.

## Xác minh

- Kiểm thử frontend: 21 đạt, 1 ca live-model tùy chọn bỏ qua; không lỗi. Trong đó 13 ca feedback, có 10 ca mới về biên ngưỡng, nhiều hơn ba từ yếu, từ chấm một phần, bản ghi cần thu lại, điểm không hợp lệ, vị trí từ/dấu câu và ngưỡng cũ.
- TypeScript, ESLint: đạt, không cảnh báo.
- Next production build: đạt, đủ 28 trang.
- `git diff --check`: đạt.
- Giao diện fixture dùng component thật và điểm giả lập: normal hiển thị đủ bốn màu cho tám từ, bao gồm từ `is` màu vàng dù nằm ngoài ba gợi ý chi tiết; từ partial điểm cao `titanium` vẫn xám và gạch nét đứt.
- limited_coverage giữ các màu của phần được hỗ trợ và thêm cảnh báo phạm vi. record_again chuyển đủ 8/8 từ sang xám, không còn từ xanh/đỏ/vàng, có giải thích xám không nghĩa đọc sai toàn bộ.
- Đã đọc CSS computed thực tế để xác minh nền/chữ của bốn màu khác nhau. `normal.jpg` và `record-again.jpg` là ảnh giao diện giả lập, không phải kết quả chấm thật của người dùng.

Chạy lại fixture từ frontend: `node scripts/preview-speaking.mjs --word-colors`. Không cần đăng nhập, không thu mic, không gửi yêu cầu chấm thật hoặc ghi SQL. Dịch vụ fixture được dừng sau kiểm tra.
