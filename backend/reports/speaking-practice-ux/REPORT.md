# Hoàn thiện trải nghiệm luyện tập Speaking — 2026-10-27

## Thay đổi

- Ba bước rõ ràng: nghe mẫu, thu/nghe lại, xem phản hồi. Chọn tốc độ mẫu 0,75× / 1×, dừng nghe, chuyển câu trước/sau và tiếp tục từ kết quả.
- Bản nháp giữ riêng theo câu trong bộ nhớ tab, có nhãn trên nút chọn câu. Lỗi microphone hoặc gửi bài giữ bản ghi để thử lại. Hủy ghi và bỏ bản ghi tạm là hai thao tác riêng. Bản đã gửi không có nút gửi trùng trong luồng thông thường.
- Hiển thị thời gian ghi, mức âm lượng và trạng thái chờ. Microphone chỉ được mở sau thao tác ghi âm. Khi đổi câu, ghi hoặc phát nguồn khác, audio/giọng mẫu trước đó được dừng.
- Tiến độ chỉ tính lượt mở bài hiện tại, dựa trên câu có kết quả và không ở chế độ `record_again`. Hoàn tất có thể luyện thêm lượt mới. Đóng/tải lại trang sẽ mất bản nháp và tiến độ lượt; lịch sử đã lưu vẫn giữ.
- Nghe lại đoạn từ trong bản ghi, dựa trên mốc âm ước lượng, có đệm 0,12 giây và chặn biên audio. Có thể kèm âm lân cận. Điểm chi tiết được đưa vào mục mở rộng.
- So sánh với lần trước gần nhất cùng câu, cùng model và cùng các âm được hỗ trợ; không so sánh khác phiên bản/phạm vi hoặc bản ghi cần thu lại. Có thời điểm bản ghi để phân biệt phản hồi lịch sử và bản nháp mới.
- Tải lại lịch sử có trạng thái lỗi/thử lại riêng. Hợp nhất theo ID và thời điểm để tránh mất kết quả mới khi tải lại đồng thời. Bản ghi cũ có câu mẫu đã đổi không cho retry trực tiếp từ phản hồi đó.

Không thay đổi database, API, mapping, checkpoint hoặc cách tính điểm trong đợt này.

## Xác minh

- TypeScript `tsc --noEmit`: đạt.
- ESLint: đạt, không cảnh báo.
- `npm run test:speaking` với `SPEAKING_LIVE_TEST_AUDIO`: 12/12 đạt. Trong đó một ca gửi WAV được mã hóa bằng frontend tới bộ chấm Python thật; chỉ gọi `/score`, không lưu SQL.
- Production build: đạt, tạo đủ 28 trang. Hai lần trước hết bộ nhớ khi tạo trang bằng 11 worker; giảm `experimental.cpus` về 2 trong Next config thì hoàn tất. Máy tại thời điểm lỗi còn khoảng 2,3 GB virtual memory trống.
- `git diff --check`: đạt.

Kiểm tra UI qua `frontend/scripts/preview-speaking.mjs` trên loopback 3307. Fixture dùng component thật, giả lập fetch/microphone và kết quả có gắn nhãn; audio mẫu là WAV công khai SpeechOcean762. Link Next chỉ được thay bằng thẻ a trong fixture. Không dùng phiên đăng nhập thật, không ghi SQL, không thu microphone thực tế.

Các thao tác đã kiểm tra trực tiếp:

1. Chọn WAV, chuyển sang câu kế rồi quay lại: bản nháp còn và gửi được.
2. Microphone giả lập trả `NotAllowedError`: có hướng dẫn cấp quyền, WAV trước vẫn còn.
3. POST giả lập lỗi 503: giữ bản ghi; gửi lại thành công: hiện kết quả, tiến độ 1/3 và lịch sử mới; ẩn nút gửi trùng.
4. So sánh lần luyện cùng cấu hình hiển thị chênh lệch 0,0 điểm theo dữ liệu fixture. Các nhánh không so sánh và thứ tự thời gian có kiểm thử tự động.
5. Nghe đoạn từ “We”: chỉ audio đoạn phát, tự dừng; các audio còn lại ở trạng thái pause.
6. GET lịch sử giả lập lỗi rồi thử lại: hiện lỗi sau đó phục hồi, giữ kết quả vừa gửi.
7. Chọn tốc độ bình thường 1×: điều khiển hiển thị giá trị tương ứng.
8. Kiểm tra viewport 390×844 và 1280×900: `scrollWidth` bằng `clientWidth`, không tràn ngang; đã khôi phục kích thước trình duyệt.

Ảnh minh họa từ fixture: `overview.jpg`, `mobile.jpg`, `result-desktop.jpg`. Đây là bằng chứng giao diện/luồng thử, không phải điểm chấm của người dùng. Trang Speaking thật chuyển tới đăng nhập khi chưa có phiên; chưa kiểm tra microphone thực hoặc thao tác gửi bài bằng tài khoản thật trong đợt này.

Chạy fixture thủ công từ thư mục frontend:

```powershell
node scripts/preview-speaking.mjs
```

Fixture cần báo cáo live cal1 và đường dẫn WAV công khai đã có trên máy; lần GET/POST đầu cố ý trả lỗi để kiểm tra phục hồi. Bundle sinh trong `.next/speaking-preview`, không đưa vào sản phẩm. Dịch vụ fixture đã dừng sau kiểm tra.
