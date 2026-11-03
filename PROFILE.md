# Hồ sơ cá nhân

## Ảnh đại diện từ máy — đã gỡ theo yêu cầu

Chức năng tải ảnh từ máy, xử lý ảnh, API upload và đọc ảnh đã được gỡ. Hiện tại chỉ chọn sáu mẫu có sẵn hoặc chữ cái tên. Không xóa tệp ảnh từng tải lên hoặc tự cập nhật dữ liệu tài khoản; URL ảnh tải lên cũ không còn được phục vụ, giao diện dùng chữ cái thay thế. Phần mô tả bên dưới ghi lại phiên bản upload trước khi gỡ, không phải chức năng hiện hành.

Người dùng có thể chọn JPG/PNG/WebP tối đa 10 MB (tối đa 25 megapixel). Trình duyệt giải mã ảnh, cắt vuông ở giữa và xuất PNG 256 × 256, bỏ metadata gốc. Xem trước ngay trong hồ sơ; chỉ gắn URL ảnh vào tài khoản sau khi bấm **Lưu thay đổi**. Có thể dùng lại ảnh có sẵn hoặc chữ cái tên; **Hủy thay đổi** khôi phục ảnh đã lưu.

Upload: `POST /api/v1/account/avatar`, đọc ảnh: `GET /api/v1/account/avatar/{userId}/{name}.png`, qua proxy `/api/account/avatar/...`. Backend giới hạn PNG 1 MB và cạnh ảnh 1024 px, kiểm tra cấu trúc PNG, CRC, kích thước và dữ liệu giải nén. Đường dẫn có tên ngẫu nhiên, nằm trong `App_Data/avatars/{userId}`, chỉ chủ sở hữu đang hoạt động được đọc hoặc chọn vào hồ sơ. Proxy giữ JWT trên server, kiểm tra Origin khi upload và giới hạn body thực. Ảnh được phục vụ private/no-store và nosniff. Không thay đổi schema, tiếp tục lưu URL ở Users.AvatarUrl.

Ảnh tải lên nhưng chưa lưu/hủy và các phiên bản ảnh cũ hiện được giữ trong kho riêng; chưa có tác vụ tự dọn tệp. Tải ảnh không tự sửa các trường hồ sơ khác. Các mô tả bên dưới về chỉ có ảnh tĩnh là phạm vi của phiên bản ban đầu.

Mở `/account` hoặc chọn **Hồ sơ** trên thanh điều hướng. Người dùng xem thông tin tài khoản, chỉnh họ tên (tối đa 150 ký tự), mục tiêu A1–C2 hoặc chưa chọn, và chọn một trong sáu ảnh đại diện có sẵn hoặc chữ cái tên. Nút **Hủy thay đổi** khôi phục lần lưu gần nhất; **Lưu thay đổi** cập nhật hồ sơ và thanh điều hướng. Mục tiêu CEFR là mục tiêu tự chọn, không phải kết quả kiểm tra.

API: `GET /api/v1/auth/me` hiện có và `PUT /api/v1/auth/me` mới; frontend gửi qua `PUT /api/account/profile`. JWT nằm trong cookie HttpOnly, proxy kiểm tra Origin và giới hạn body 16 KB. Backend lấy UserId từ JWT và kiểm tra tài khoản còn hoạt động; không nhận ID tài khoản từ form. Chỉ cập nhật FullName, TargetLevel, AvatarUrl và UpdatedAt. Email, vai trò, mật khẩu, chuỗi ngày học và ngày tạo không thay đổi. Ảnh là SVG tĩnh trong `frontend/public/avatars`, không có upload tệp.

Phạm vi database: dùng đúng bảng `dbo.Users` theo `DATABASE_SCHEMA.md` mục 2.1 và `EnglishLearningModel.cs`. Cột có sẵn: FullName nvarchar(150) NOT NULL, TargetLevel nvarchar(10) NULL, AvatarUrl nvarchar(500) NULL, UpdatedAt datetime2 NOT NULL. Không sửa entity, mapping, constraint hoặc migration. Không tạo dữ liệu mẫu hay sửa tài khoản thật khi kiểm thử.

Kiểm thử: `ProfileTests` dùng InMemory riêng, chạy qua HTTP với JWT; kiểm tra xác thực, lưu/đọc lại, trim họ tên, giá trị rỗng, cấp độ sai, URL ảnh ngoài danh sách, tên quá dài/ký tự điều khiển, giữ nguyên trường được bảo vệ khi client cố gửi thêm, không sửa người khác, xóa lựa chọn ảnh/mục tiêu và tài khoản bị vô hiệu hóa. Frontend kiểm tra bằng lint, TypeScript và production build.

Sau khi thay đổi backend, dừng phiên debug cũ trong Visual Studio rồi build và chạy lại (F5) để nạp API mới. Không chạy đồng thời một API nền và Visual Studio trên cùng binary/cổng.
