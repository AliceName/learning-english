# English Learning API

Backend ASP.NET Core Web API dùng .NET 9, Controllers và Entity Framework Core cho SQL Server.

## Chạy ứng dụng

Cài .NET SDK 9.0.307 hoặc bản vá mới hơn trong nhánh 9.0.3xx. Từ thư mục gốc repository:

```powershell
dotnet restore EnglishLearningSystem.sln
dotnet tool restore
./backend/scripts/Start-Development.ps1
```

`Start-Development.ps1` kiểm tra/tạo khóa JWT trong User Secrets, đặt môi trường Development rồi chạy API với profile `http`. Dùng `./backend/scripts/Start-Development.ps1 -LaunchProfile https` để chạy profile HTTPS.

Nếu dùng Visual Studio, mở `EnglishLearningSystem.sln`, chọn project khởi động `EnglishLearning.Api` và profile `http` hoặc `https`, rồi bấm F5. Cả hai profile đặt rõ môi trường Development. API tự đọc khóa JWT đã lưu trong User Secrets; nếu chưa có khóa thì tạo một khóa ngẫu nhiên 64 byte và lưu lại cho những lần chạy sau. Không cần chạy script trước khi bấm F5.

### Lỗi thiếu khóa JWT khi khởi động

`OptionsValidationException` với `JwtOptions.SigningKey` là lỗi cấu hình lúc khởi động; build có thể vẫn thành công. API cần khóa ký JWT ít nhất 32 byte UTF-8. Từ thư mục gốc repository, chạy:

```powershell
./backend/scripts/Initialize-JwtSecret.ps1
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

Khóa được lưu ngoài repository tại `%APPDATA%\Microsoft\UserSecrets\464087af-810d-4b10-95fc-37a9adaa019d\secrets.json`, mục `Jwt:SigningKey`. Trong Development, API tự khởi tạo khóa còn thiếu tại đây khi chạy trực tiếp bằng Visual Studio hoặc `dotnet run`. Khóa có sẵn được giữ nguyên; khóa cấu hình qua biến môi trường hoặc tham số dòng lệnh vẫn được ưu tiên. Nếu khóa đã cấu hình nhưng quá ngắn, API vẫn báo lỗi để yêu cầu sửa cấu hình. Khi triển khai, API không tự tạo khóa: cung cấp khóa qua `Jwt__SigningKey` hoặc nơi lưu secrets của môi trường triển khai.

- Swagger UI: http://localhost:5000/swagger
- OpenAPI JSON: http://localhost:5000/openapi/v1.json
- Kiểm tra ứng dụng: `GET http://localhost:5000/api/v1/health`
- Kiểm tra SQL Server: `GET http://localhost:5000/api/v1/health/database`

API kiểm tra SQL Server trả `200` khi kết nối thành công và `503` khi thất bại. API ứng dụng không truy vấn CSDL.

## Cấu hình CSDL

`EnglishLearning.Api/appsettings.Development.json` dùng cấu hình local đã kiểm tra:

- Vị trí: `backend/EnglishLearning.Api/appsettings.Development.json`, mục `ConnectionStrings:DefaultConnection`.
- Server: `MSI\MSSQLSERVER01`.
- Database: `EnglishLearningDB`
- Xác thực Windows: tài khoản chạy ứng dụng phải có quyền truy cập database.

Trong `appsettings.json`, `ConnectionStrings:DefaultConnection` để trống; file `appsettings.Development.json` cung cấp giá trị khi chạy Development. User Secrets (`ConnectionStrings:DefaultConnection`), biến môi trường `ConnectionStrings__DefaultConnection` và tham số dòng lệnh có thể ghi đè giá trị trong file theo thứ tự ưu tiên tăng dần.

Khi chạy ngoài môi trường Development, cung cấp `ConnectionStrings__DefaultConnection` qua biến môi trường hoặc nơi lưu secrets. Không ghi mật khẩu SQL Server vào source code. `TrustServerCertificate=True` trong cấu hình Development phục vụ SQL Server local; môi trường triển khai cần cấu hình chứng chỉ phù hợp.

CORS cho phép frontend tại `http://localhost:3000`; thay đổi danh sách `Cors:AllowedOrigins` nếu frontend chạy ở địa chỉ khác. Swagger chỉ được bật trong Development.

## Dependencies .NET

Dependencies NuGet được quản lý trong `EnglishLearning.Api/EnglishLearning.Api.csproj`:

- `Microsoft.AspNetCore.Authentication.JwtBearer` 9.0.21: xác thực chữ ký, issuer, audience và thời hạn JWT.
- `Microsoft.AspNetCore.OpenApi` 9.0.21 và `Swashbuckle.AspNetCore.SwaggerUI` 9.0.6: tài liệu API và giao diện Swagger.
- `Microsoft.EntityFrameworkCore.SqlServer` 9.0.21: kết nối SQL Server qua EF Core.
- `Microsoft.EntityFrameworkCore.Design` và `Microsoft.EntityFrameworkCore.Tools` 9.0.21: công cụ thiết kế và Package Manager Console trong Visual Studio.

CLI `dotnet-ef` 9.0.21 được khai báo riêng trong `.config/dotnet-tools.json` ở thư mục gốc repository. Cài lại bằng `dotnet tool restore`, kiểm tra bằng `dotnet ef --version`. Việc restore/cài công cụ không chạy migration hoặc thay đổi CSDL.

`EnglishLearning.Api/packages.lock.json` ghi lại phiên bản NuGet đã resolve, gồm cả dependencies gián tiếp. Dùng `dotnet restore EnglishLearningSystem.sln --locked-mode` để kiểm tra việc khôi phục đúng bộ phiên bản này.

## Dependencies Python AI

`requirements.txt` tại thư mục gốc dành cho nền tảng dịch vụ AI Python. Dùng Python 3.13 và môi trường ảo riêng:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

Danh sách gồm FastAPI, Uvicorn, Pydantic Settings, Python Multipart và HTTPX. Các gói CSDL Python cũ như SQLAlchemy, Alembic và pyodbc đã được bỏ vì backend .NET quản lý SQL Server. PyTorch/CUDA, Transformers, OCR và thư viện đọc tài liệu sẽ được chọn khi triển khai engine tương ứng.

## Phạm vi project hiện tại

- Đã ánh xạ đủ 13 bảng và 122 cột theo `DATABASE_SCHEMA.md`, bao gồm `Users.Role` được duyệt ngày 2026-10-21.
- Có API đăng ký tài khoản, chuẩn hóa email, kiểm tra email trùng và băm mật khẩu bằng `PasswordHasher<User>` (PBKDF2 với salt).
- Có API đăng nhập cấp JWT và API tài khoản cần xác thực; đăng ký trả về thông tin công khai của tài khoản vừa tạo.
- Ứng dụng không tự tạo database, bảng, dữ liệu hoặc chạy migration khi khởi động.
- Trước khi thêm entity hoặc migration, đối chiếu `DATABASE_SCHEMA.md`, `DATABASE_RULES.md` và schema thực tế.
- Dịch vụ Python xử lý AI sẽ được tích hợp qua HTTP ở bước phát triển tiếp theo.

## Tạo CSDL theo tài liệu

Migration SQL đầu tiên là `backend/database/001_initial_schema.sql`, lấy các cột và ràng buộc từ mục 2.1–2.13 của `DATABASE_SCHEMA.md`. Script tạo `EnglishLearningDB` và các bảng còn thiếu, không sửa hoặc xóa bảng/dữ liệu đã tồn tại. Nếu CSDL có cấu trúc khác tài liệu, cần đánh giá một migration riêng; script này không tự đồng bộ các khác biệt đó.

Chạy từ thư mục gốc repository bằng tài khoản Windows có quyền tạo CSDL:

```powershell
sqlcmd -S 'MSI\MSSQLSERVER01' -d master -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
```

Thay server bằng instance SQL Server của bạn. Baseline này có đúng 13 bảng nghiệp vụ, 121 cột, 20 FK, 14 CHECK và 4 UNIQUE; chỉ `Lessons.CourseId` và `Flashcards.DeckId` có xóa cascade. Chưa dùng EF migrations history; không chạy `database update` hoặc `EnsureCreated` để khởi tạo lại CSDL này.

### Role và tài khoản admin mặc định

Người dùng phê duyệt `Users.Role` ngày 2026-10-21: `NVARCHAR(20) NOT NULL DEFAULT 'user'`, CHECK chỉ nhận `admin`/`user` chữ thường. Sau baseline, chạy migration riêng (cũng áp dụng cho database hiện có):

```powershell
sqlcmd -S 'MSI\MSSQLSERVER01' -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
./backend/scripts/Initialize-Admin.ps1
```

Migration có transaction, chạy lại được, gán role `user` cho tài khoản cũ; không sửa email, mật khẩu, PK/FK hoặc dữ liệu nghiệp vụ khác. Schema sau migration: 13 bảng, 122 cột, 20 FK, 15 CHECK, 4 UNIQUE. Không sửa baseline `001` đã được dùng trước đó.

Script admin tạo mặc định `admin@linguaai.local` (tên Quản trị viên), sinh mật khẩu ngẫu nhiên 24 byte, lưu các khóa `BootstrapAdmin:Email`, `BootstrapAdmin:FullName`, `BootstrapAdmin:Password` vào User Secrets ngoài repository. Mật khẩu chuyển cho CLI bằng stdin, không nằm trong source, SQL, tham số tiến trình hoặc log. Để xem thông tin đăng nhập đã lưu trên máy của bạn:

```powershell
./backend/scripts/Initialize-Admin.ps1 -ShowCredentials
```

`-ShowCredentials` chỉ đọc thông tin đã lưu, không chạy bootstrap hoặc đổi mật khẩu. User Secrets của project: `%APPDATA%\Microsoft\UserSecrets\464087af-810d-4b10-95fc-37a9adaa019d\secrets.json`. Có thể mở bằng **Manage User Secrets** của project API trong Visual Studio.

Bootstrap dùng `PasswordHasher<User>` như đăng ký thường. Chạy lại không tạo bản sao, không reset mật khẩu/tên/trạng thái; nếu email thuộc user thường hoặc admin bị vô hiệu hóa, lệnh báo lỗi và giữ nguyên tài khoản. Ứng dụng khởi động bình thường/F5 không tự tạo/reset admin. Script là công cụ Development; môi trường khác có thể cấp `BootstrapAdmin__Email`, `BootstrapAdmin__FullName`, `BootstrapAdmin__Password` qua secret store và chạy lệnh provisioning riêng:

```powershell
dotnet run --project backend/EnglishLearning.Api --configuration Release --no-launch-profile -- --bootstrap-admin=true
```

API đăng ký công khai luôn gán `user`, bỏ qua trường role do client tự thêm. Đăng ký, đăng nhập và `/auth/me` trả `role` công khai; JWT có claim `role`, cấu hình `RoleClaimType = "role"` để hỗ trợ `[Authorize(Roles = UserRoles.Admin)]` cho API quản trị sau này. Chưa có màn hình/API quản trị trong thay đổi này. Role trong JWT phản ánh thời điểm đăng nhập; sau khi thay role trực tiếp trong SQL cần đăng nhập lại, token cũ còn hiệu lực tối đa 30 phút theo cấu hình hiện tại.

## Đăng ký tài khoản

`POST /api/v1/auth/register`, nội dung JSON:

```json
{
  "email": "learner@example.com",
  "fullName": "Người học tiếng Anh",
  "password": "Learning@2026",
  "confirmPassword": "Learning@2026",
  "targetLevel": "B1"
}
```

Email tối đa 255 ký tự, họ tên tối đa 150 ký tự, mật khẩu dài 8–128 ký tự và phải khớp mật khẩu xác nhận. Email được bỏ khoảng trắng đầu/cuối và chuyển thành chữ thường. `targetLevel` không bắt buộc; nếu có phải là A1, A2, B1, B2, C1 hoặc C2.

- `201`: tạo tài khoản, trả `message` và `user` gồm `userId`, `email`, `fullName`, `targetLevel`, `createdAt`, `role` (`user`).
- `400`: dữ liệu không hợp lệ, lỗi từng trường trong `errors`.
- `409`: email đã đăng ký, bao gồm trường hợp hai yêu cầu đồng thời trùng email.
- `503`: CSDL chưa sẵn sàng; phản hồi không chứa chi tiết SQL.

Mật khẩu và hash không được đưa vào response. Các giá trị mặc định và thời điểm tạo tài khoản lấy từ CSDL đúng thiết kế; role đăng ký được cố định là `user`. Không thêm bảng Identity, Roles hoặc cột ngoài schema đã duyệt.

Giao diện Next.js tại `http://localhost:3000/register` gọi API thông qua route proxy `/api/auth/register`; hướng dẫn chạy frontend ở `frontend/README.md`.

## Đăng nhập và phiên làm việc

`POST /api/v1/auth/login` nhận `{ "email": "learner@example.com", "password": "Learning@2026" }`:

- `200`: trả `accessToken`, `tokenType`, `expiresIn`, `expiresAt` và thông tin `user` công khai.
- `400`: email/mật khẩu không hợp lệ.
- `401`: thông báo chung cho email không tồn tại, mật khẩu sai hoặc tài khoản bị vô hiệu hóa.
- `429`: vượt 30 lần thử cho cùng email trong một phút; hạn mức lưu trong bộ nhớ của instance API và không chặn email khác.
- `503`: CSDL chưa sẵn sàng.

`GET /api/v1/auth/me` yêu cầu header `Authorization: Bearer <accessToken>`. API xác thực JWT và kiểm tra tài khoản vẫn tồn tại, còn hoạt động. Swagger có nút **Authorize** để dán access token và thử API này.

JWT dùng HS256, có thời hạn mặc định 30 phút, kiểm tra issuer/audience và chỉ chấp nhận thuật toán đã cấu hình. Khóa ký không nằm trong source code: API tự tạo khóa còn thiếu trong User Secrets khi chạy Development và giữ nguyên khóa đã có. Script `backend/scripts/Initialize-JwtSecret.ps1` cũng có thể khởi tạo khóa trước khi chạy. Khi triển khai, cấu hình `Jwt__SigningKey` bằng một giá trị bí mật đủ mạnh, ít nhất 32 byte; có thể ghi đè `Jwt__Issuer`, `Jwt__Audience`, `Jwt__AccessTokenMinutes` (1–60).

Next.js nhận token ở server rồi lưu vào cookie HttpOnly, SameSite=Lax, thời hạn tương ứng JWT; Secure được bật khi chạy production, cần triển khai qua HTTPS. Token không được trả trong JSON cho trình duyệt hoặc lưu vào localStorage. Trang `/account` xác thực lại qua API `/me`; `/api/auth/logout` xóa cookie và chuyển về `/login`.

Đăng xuất kết thúc phiên tại trình duyệt. JWT đã phát vẫn có thể dùng qua Bearer API đến khi hết hạn; chưa có refresh token hoặc cơ chế thu hồi từng token. Không thêm bảng/cột để quản lý phiên ngoài thiết kế hiện tại. Các giới hạn thử đăng nhập đang áp dụng trong từng instance; khi triển khai nhiều instance cần cấu hình giới hạn dùng chung ở hạ tầng phù hợp.

### Hủy yêu cầu và lỗi kết nối khi debug

Các endpoint đăng ký, đăng nhập và `/me` truyền cancellation token của request xuống EF Core. Khi client đóng kết nối hoặc frontend hết thời gian chờ, truy vấn có thể ném `TaskCanceledException`/`OperationCanceledException`; API xử lý trường hợp request đã bị hủy bằng trạng thái `499`, không coi là sai mật khẩu và không cấp JWT. Nếu thao tác CSDL bị hủy khi request vẫn còn hiệu lực, API trả `503` như các lỗi SQL khác.

Log `Microsoft.EntityFrameworkCore.Database.Connection[20004]` chỉ cho biết thao tác kết nối thất bại; cần đọc exception đi kèm để phân biệt request bị hủy, hết thời gian chờ, lỗi xác thực Windows hoặc server không truy cập được. Không đổi connection string chỉ dựa trên mã log này.

Frontend chờ backend tối đa 120 giây trong Development để có thời gian bước qua breakpoint của Visual Studio; production dùng 30 giây, lớn hơn ngân sách kết nối SQL 5 giây cộng hai lệnh SQL tối đa 10 giây/lệnh. Khi dừng debug quá lâu, request vẫn có thể bị hủy; tiếp tục chạy API rồi gửi lại yêu cầu. Không cần bỏ cancellation token hoặc tắt kiểm tra lỗi SQL.

## Kiểm thử

Kiểm thử unit/model có thể chạy bằng `dotnet test EnglishLearningSystem.sln --configuration Release`. Để chạy thêm kiểm thử API và đối chiếu schema trên SQL Server, tạo CSDL ở trên trước rồi đặt biến môi trường:

```powershell
$env:ENGLISHLEARNING_TEST_CONNECTION_STRING = 'Server=MSI\MSSQLSERVER01;Database=EnglishLearningDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5'
dotnet test EnglishLearningSystem.sln --configuration Release
```

Các kiểm thử tích hợp chạy trong transaction riêng và rollback sau mỗi test. Nếu không đặt biến môi trường, chúng được báo skipped; các kiểm thử còn lại vẫn chạy bình thường.

## Danh sách khóa học

- `GET /api/v1/courses`: danh sách có phân trang. Query: `search` (tên/mô tả, tối đa 200 ký tự), `level` (A1–C2), `skill` (speaking/writing/listening/reading), `source` (system/user_upload), `status` (all/in_progress/completed/not_started), `sort` (updated/newest/popular/title), `page` (1–10000), `pageSize` (1–24, mặc định 6). Query không hợp lệ trả `400`.
- Response có `items`, `totalCount`, `page`, `pageSize`, `totalPages` và `summary` tổng khóa học/đang học/hoàn thành trước khi áp dụng bộ lọc. Trang vượt phạm vi trả danh sách trống. Sort luôn có CourseId để giữ thứ tự ổn định khi các giá trị bằng nhau.
- `GET /api/v1/courses/{courseId}`: thông tin khóa học và danh sách bài học đang hoạt động, sắp theo OrderIndex rồi LessonId. Không trả nội dung bài học hoặc dữ liệu học viên khác.
- Cả hai API yêu cầu JWT của tài khoản còn hoạt động (`401` khi thiếu/hết hạn/vô hiệu hóa), trả `Cache-Control: no-store`. Chỉ trả khóa học đã xuất bản: khóa học hệ thống và khóa học `user_upload` do chính người đăng nhập tạo. Khóa học nháp, khóa học của người khác hoặc ID không tồn tại trả `404` ở endpoint chi tiết. Database lỗi/timed out trả `503`; request bị hủy trả `499`.
- Dùng nguyên schema Courses, Lessons, UserCourses, Users trong `DATABASE_SCHEMA.md`; không thêm cột, migration hay seed. Cấp độ/kỹ năng/số bài/thời lượng tổng hợp từ Lessons.IsActive. Khi lọc đồng thời cấp độ và kỹ năng, phải có một bài học thỏa cả hai. `TimedLessonCount` cho biết số bài đã có thời lượng. `popular` đếm lượt tham gia có Status khác abandoned. ProgressPercent/Status chỉ lấy bản ghi UserCourses của người đăng nhập.
- Database chưa có dữ liệu sẽ trả `200` với items trống. Không tạo số liệu đánh giá sao, giá hoặc gia sư AI từ giao diện mẫu. Chưa triển khai API đăng ký học, học bài, bookmark hoặc tạo khóa học AI trong phạm vi danh sách này.
- Kiểm thử trong `CourseCatalogTests.cs` dùng SQL Server thật trong transaction và rollback khi kết thúc; chạy cùng nhóm `RegistrationSqlServerTests` với biến `ENGLISHLEARNING_TEST_CONNECTION_STRING` như hướng dẫn trên.

## Kiểm tra build

```powershell
dotnet build EnglishLearningSystem.sln
```
