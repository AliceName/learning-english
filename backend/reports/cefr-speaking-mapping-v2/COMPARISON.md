# Cải thiện mapping tham chiếu Speaking

So sánh trên cùng 3313 câu CEFR-SP, cùng dữ liệu và cùng bảng âm vị đã dùng để train. Không đổi trọng số, vocabulary, feature schema, câu mẫu hoặc nhãn CEFR.

| Chỉ số | Trước | Sau |
|---|---:|---:|
| Mapping đầy đủ | 300 | 326 |
| Mapping một phần | 2281 | 2671 |
| Từ chối mapping | 732 | 316 |
| Coverage trung bình theo câu, từ chối tính 0 | 56.18% | 70.81% |

Khôi phục 416 câu từng bị từ chối; 0 câu giảm coverage; 0 từ từng được chấm chuyển thành không hỗ trợ.

Thay đổi: dùng tất cả cách phát âm CMUdict khi khôi phục ranh giới; dùng G2P từ riêng lẻ chỉ làm bằng chứng ranh giới cho tên/từ ngoài từ điển; giữ các âm đối chiếu một-một chắc chắn trong từ có token gộp. Token gộp và vị trí còn mơ hồ không nhận điểm âm. Không dùng khoảng cách chỉnh sửa, dự đoán học viên hoặc nhãn giáo viên để ép đối chiếu.

Cấu hình/weights train giữ nguyên; phục vụ dùng modelVersion có hậu tố ref2 và hash module để phân biệt kết quả lịch sử. Không so sánh điểm trước/sau như thể cùng phiên bản.

Bản đo TTS được tái sử dụng từ audit cũ: IDs và câu gốc đã được đối chiếu, không tổng hợp lại hay đo người đọc thật. Số ứng viên mới trong summary.json chỉ là kết quả lọc kỹ thuật; không tự nhập thêm bài.

Đây là cải thiện tương thích ký hiệu và độ phủ. Chưa đo độ chính xác chấm âm, ranh giới âm hoặc chất lượng trên người đọc thật. Không suy ra phần trăm accuracy từ coverage.

## Kiểm tra dịch vụ thực tế

Phiên bản trước: gop-ctc-mlp-68505cc756b1fbf8. Phiên bản sau: gop-ctc-mlp-68505cc756b1fbf8-ref2-470077d127db.

6 audio tổng hợp được chọn từ nhóm từng lỗi: trước [422, 422, 422, 422, 422, 422], sau [200, 200, 200, 200, 200, 200]. Không đại diện accuracy trên người học.

WAV mẫu công khai We call it bear: coverage 77.78% → 88.89%. Không chấm tách token rhotic gộp. Xem live-before.json / live-after.json để đối chiếu.
