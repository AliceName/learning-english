# Hồ sơ cá nhân

Mở `/account` hoặc chọn **Hồ sơ**. Phiên bản ngày 2026-11-10 triển khai yêu cầu hoàn thiện hồ sơ; phần thống kê, tiến độ và hoạt động học tập mới được hoãn đến khi Writing/Listening hoàn thành.

## Sử dụng

- Mặc định xem hồ sơ: thẻ avatar, tên, email, vai trò, ngày tham gia và mục tiêu CEFR; thông tin cá nhân, mục tiêu học và bảo mật ở các thẻ riêng. Bố cục hai cột trên màn hình rộng, xếp dọc trên điện thoại.
- Bấm **Chỉnh sửa hồ sơ** để đổi họ tên, điện thoại, ngày sinh, địa chỉ, mục tiêu CEFR, mục đích học, kỹ năng ưu tiên và số phút mỗi ngày. Email và vai trò không chỉnh từ form. Các trường bổ sung đều không bắt buộc; có thể xóa giá trị đã lưu.
- Điện thoại nhận 8–15 chữ số, có thể có dấu `+`, khoảng trắng, ngoặc và dấu gạch; API bỏ các dấu định dạng. Ngày sinh từ 1900 đến hôm nay theo UTC+7; địa chỉ tối đa 500 ký tự; mục tiêu thời gian từ 5 đến 180 phút/ngày.
- Avatar: mèo, gấu, cáo × sáu màu nền, hoặc chữ cái tên. Sáu avatar cũ vẫn được hiển thị và chấp nhận. Không tải ảnh từ máy, không dùng Cloudinary cho avatar.
- **Lưu thay đổi** cập nhật dữ liệu và thanh điều hướng. **Hủy thay đổi** khôi phục lần lưu gần nhất. Khi có thay đổi chưa lưu, liên kết điều hướng, tìm kiếm nhanh, nút đăng xuất và thao tác đóng/tải lại trang có cảnh báo. Nút quay lại của điều hướng SPA trong trình duyệt chưa có cơ chế chặn riêng.
- Mục tiêu CEFR là mục tiêu tự chọn, không phải đánh giá trình độ. Mục tiêu và sở thích được lưu để sử dụng về sau; chưa tự phân loại trình độ, thống kê hay sinh lộ trình.

## Bảo mật

- **Đổi mật khẩu** yêu cầu mật khẩu hiện tại; mật khẩu mới từ 8–128 ký tự, khác mật khẩu cũ, xác nhận phải khớp. Mật khẩu dùng PBKDF2 qua `PasswordHasher<User>`. Thành công thu hồi tất cả phiên và chuyển về đăng nhập. Giới hạn thử mật khẩu dùng limiter hiện có.
- **Đăng xuất phiên khác** có hộp xác nhận, thay phiên hiện tại bằng cookie HttpOnly mới và thu hồi các phiên khác, kể cả access token kiểu cũ không có refresh token. Các tab trong cùng trình duyệt dùng chung cookie nên tiếp tục hoạt động.
- JWT có `auth_ver`, đối chiếu `Users.AuthVersion` trên mỗi yêu cầu đã xác thực; tài khoản bị vô hiệu hóa hoặc phiên cũ trả 401. Token cũ thiếu claim được coi là phiên bản 0 cho đến lần thay đổi bảo mật đầu tiên. Lỗi SQL khi kiểm tra phiên trả 503, không giả làm hết phiên.
- Refresh session lưu phiên bản tài khoản để một yêu cầu login/refresh cũ đang chạy không khôi phục lại phiên bị thu hồi. Kho refresh vẫn ở bộ nhớ như phiên bản trước: API khởi động lại yêu cầu đăng nhập lại đối với phiên có refresh. Chưa có danh sách thiết bị/IP hoặc lưu refresh session qua nhiều instance.
- Không trả số phiên bản xác thực hoặc hash mật khẩu qua DTO hồ sơ. Thông tin cá nhân chỉ trả cho chủ tài khoản qua `/auth/me`. Khi đang chỉnh hồ sơ, thao tác bảo mật bị khóa để tránh mất bản nháp.

## API và database

- `GET /api/v1/auth/me`, `PUT /api/v1/auth/me` (BFF: `PUT /api/account/profile`). Body cũ gồm `fullName`, `targetLevel`, `avatarUrl` vẫn dùng được; bỏ qua nhóm thông tin mới sẽ giữ dữ liệu nhóm đó.
- Body mở rộng:

```json
{
  "fullName": "Tên của bạn",
  "targetLevel": "B2",
  "avatarUrl": "/avatars/mascot-cat-blue.svg",
  "personalDetails": { "phoneNumber": null, "dateOfBirth": null, "address": null },
  "learningPreferences": { "learningPurpose": "communication", "preferredSkill": "speaking", "dailyGoalMinutes": 15 }
}
```

- `POST /api/v1/auth/change-password` (BFF: `/api/account/password`), body `currentPassword`, `newPassword`, `confirmPassword`. API trả 204, BFF xóa cả hai cookie và trả thông báo.
- `POST /api/v1/auth/sessions/revoke-others` (BFF: `/api/account/sessions/others`). BFF lấy refresh token từ cookie, không nhận token từ JavaScript phía khách; API xác nhận refresh thuộc chính phiên hiện tại trước khi thay phiên. Access token cũ không có SID vẫn được hỗ trợ.
- Các BFF kiểm tra Origin, giữ JWT trên server, giới hạn body thực và trả `Cache-Control: no-store`. Backend chỉ dùng UserId từ JWT; bỏ qua trường quyền/ID do client cố gửi thêm.
- Phạm vi schema được duyệt ghi trong `DATABASE_SCHEMA.md` mục 2.1: chỉ thêm `PhoneNumber`, `DateOfBirth`, `Address`, `LearningPurpose`, `PreferredSkill`, `DailyGoalMinutes`, `AuthVersion` vào `Users`. `AuthVersion` là concurrency token của EF. Không tạo bảng/quan hệ/index hay seed mới.

## Đồng bộ máy khác

Theo quy trình SQL trong README, máy đã áp dụng 001–003 chạy thêm script sau (thay instance bằng SQL Server của máy bạn):

```powershell
sqlcmd -S localhost -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/004_profile_details_and_security.sql
```

Riêng máy đã quản lý lịch sử bằng EF như máy triển khai hiện tại, từ thư mục gốc có thể chạy migration tương ứng sau khi cấu hình kết nối và User Secrets:

```powershell
dotnet tool restore
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet ef database update --project backend/EnglishLearning.Api
```

Migration `20261110092157_ProfileDetailsAndSecurity` nhúng script `003` đã được duyệt trước đó để đồng bộ Grammar giữa EF và các máy quản lý bằng SQL, rồi script `004_profile_details_and_security.sql`. Script 004 thêm cột nếu thiếu, kiểm tra kiểu/nullability/default nếu cột đã có; chạy lại không ghi đè dữ liệu. Không sửa migration ban đầu. Máy quản lý bằng SQL có thể chạy riêng 004 sau 001–003; EF vẫn nhận được schema đã cập nhật khi chạy migration sau đó. Không có migration tự chạy lúc API khởi động.

Migration đã được áp dụng trên SQL Server cục bộ trong phiên triển khai này. `Down` chủ động từ chối xóa cột, tránh mất hồ sơ hoặc vô tình phục hồi hiệu lực token cũ; nếu cần quay lui phải có phương án sao lưu/khôi phục được rà soát riêng.

## Kiểm chứng

- Backend: hồi quy 285 bài đạt; các bài cần dịch vụ ngoài chỉ chạy khi bật cấu hình tương ứng; các bài mới dùng HTTP + InMemory cho lưu/xóa/kiểm tra dữ liệu, bảo vệ tài khoản khác, đổi mật khẩu, thu hồi phiên refresh và JWT cũ. Một bài SQL bổ sung chạy qua HTTP trong transaction được rollback, xác minh cả hồ sơ và bảo mật trên SQL Server thật.
- Frontend: hồi quy 66 bài đạt, 1 bài mô hình thật bỏ qua; gồm 9 bài kiểm thử mới cho thông tin hồ sơ, ngày tháng, avatar, BFF, Origin/body limit và cookie bảo mật; kiểm tra TypeScript, lint, production build.
- Kiểm tra trình duyệt dùng thành phần thật với API giả tách biệt: xem/chỉnh sửa, số điện thoại sai, lưu ngày sinh riêng, avatar/màu nền, hủy, cảnh báo rời trang, hộp bảo mật; màn hình điện thoại không tràn ngang. Không đổi mật khẩu hay thông tin của tài khoản thật bằng trình duyệt.

Sau thay đổi, khởi động lại API và frontend để nạp mã mới. Dừng phiên debug API cũ trước khi chạy lại; tránh chạy hai API cùng binary/cổng 5000.
