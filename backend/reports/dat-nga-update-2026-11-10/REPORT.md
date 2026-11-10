# Kiểm tra và gộp cập nhật nga — 2026-11-10

Nguồn: Dat `71c84f7` và origin/nga `5c1703dfbeff00ec98408856abf35d79d431d676`. Nhánh nga có merge `ccdef0f` và hai commit cập nhật `a663191`, `5c1703d` sau lần gộp trước. Đã kiểm tra trên worktree riêng trước khi cập nhật Dat chính.

## Nội dung giữ và cập nhật

- Giữ Speaking theo khóa/cụm, CEFR A1–C2, hồ sơ, Flashcards và cấu hình media của Dat.
- Nhận luyện nói tự do, giao diện Flashcards mới, nháp Listening, refresh phiên đăng nhập và kiểm tra câu mẫu mới.
- Giữ logic chọn media rõ ràng: Development local chỉ khi bật cờ và Cloudinary tắt; khi Cloudinary bật vẫn dùng cloud, không fallback khi lỗi.
- Không đổi entity, model, schema SQL hoặc migration so với Dat trước cập nhật.

Có 5 file xung đột: Program.cs, backend/README.md, frontend/README.md, trang chi tiết khóa học và CSS khóa học. Xung đột chủ yếu do di chuyển/định dạng cùng đoạn; đã giữ cấu trúc Dat, gộp phần cập nhật và loại đăng ký DI/đoạn CSS trùng. Không còn file unmerged.

Test catalog cũ giả định URL không có view=catalog. Đã cập nhật test để kiểm tra đủ level/skill/view trong query, đồng thời kiểm tra lối tắt Speaking tự do và đường vào catalog riêng. Không bỏ kiểm tra A1–C2.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| Backend build và bộ test local | 281 đạt, 0 lỗi, 65 bỏ qua; tổng 346 |
| HTTP đăng nhập → refresh → me → logout → token bị từ chối | Đạt, database in-memory |
| Frontend lint / typegen / TypeScript | Đạt |
| npm ci sạch | Đạt |
| Frontend unit/integration | 57 đạt, 0 lỗi, 1 live encoder test bỏ qua |
| Proxy Listening / Cloudinary media / quản trị khóa học | 3 suite đạt |
| Next production build | Đạt, có route /speaking và Proxy |
| Python mapping/calibration/serving/read-context | 22 đạt |
| Chấm thật qua .NET → Python: luyện tự do/theo bài | 1 test đạt |
| Chấm thật qua .NET → Python: luyện cụm | 1 test đạt |
| API, SQL health, MongoDB health | HTTP 200 |
| Health media | HTTP 200, cloud-only theo cấu hình local hiện có |
| Frontend production /, /login, /register | HTTP 200 |
| BFF đăng nhập bằng tài khoản giả không tồn tại | HTTP 401 đúng kỳ vọng |

Model thật đã nạp phiên bản có hậu tố `readctx1-16cc4f3168e7`. Dùng WAV mẫu công khai trong SpeechOcean762 để kiểm thử inference, không train lại. Các test lưu/đọc kết quả dùng EF InMemory và thư mục tạm; không ghi SQL thật.

Đã bổ sung 7 test frontend về proxy refresh/cookie, 3 test draft Listening, một test điều hướng Speaking và một test backend HTTP in-memory để kiểm tra phần cập nhật. Test refresh xác minh cookie HttpOnly/Secure, truyền token mới vào request hiện tại, xử lý mất kết nối và từ chối dữ liệu refresh sai. Backend kiểm tra logout thu hồi cả token cũ và mới.

65 test backend trong lượt mặc định cần opt-in/dịch vụ ngoài nên bỏ qua; hai test model thật sau đó được chạy riêng và đạt. Không chạy migration, seed, bootstrap tài khoản, initialize-vocabulary hoặc upload/migrate Cloudinary. Cloudinary trong lượt này chỉ được xác nhận nạp cấu hình qua health, không kiểm thử upload/delivery thật.

## Cấu hình và vận hành

Cấu hình SQL/MongoDB riêng của máy được giữ lại. Cloudinary dùng User Secrets ngoài repository; không đưa credential vào code hoặc báo cáo. Không khởi động API ở cổng 5000 trong lượt kiểm thử để tránh khóa file/chiếm cổng khi dùng Visual Studio.

Refresh sessions hiện nằm trong RAM của API: restart backend làm các phiên refresh cũ cần đăng nhập lại. Nháp Listening nằm trong sessionStorage; lịch sử/audio luyện tự do nằm trong IndexedDB trên trình duyệt, không phải đồng bộ SQL giữa các máy.

Log, TAP và TRX chi tiết nằm trong validation-artifacts của worktree `update-nga-20261110.tmp`. Các server kiểm thử 5101/3101 và Python test 8001 được dừng sau khi hoàn tất.
