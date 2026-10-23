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

API đăng ký công khai luôn gán `user`, bỏ qua trường role do client tự thêm. Đăng ký, đăng nhập và `/auth/me` trả `role` công khai; JWT có claim `role`, cấu hình `RoleClaimType = "role"`. Các API quản trị khóa học dùng `[Authorize(Roles = UserRoles.Admin)]` và kiểm tra lại Role/IsActive từ database cho mỗi request để chặn tài khoản đã bị hạ quyền. Role trong JWT phản ánh thời điểm đăng nhập; đăng nhập lại để nhận claim mới sau khi đổi role.

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

## Admin tạo và biên soạn khóa học

Các API `/api/v1/admin/*` yêu cầu JWT role `admin` **và** kiểm tra lại Users.Role/IsActive trong database. Tài khoản thường hoặc admin đã bị hạ quyền trả `403`; tài khoản không hoạt động trả `401`. Không thêm bảng/cột hoặc seed dữ liệu. Riêng loại Grammar cần mở rộng ràng buộc bằng script 003 như hướng dẫn bên dưới.

| API | Chức năng |
|---|---|
| `GET /api/v1/admin/courses?search=&page=1&pageSize=12` | Danh sách khóa học hệ thống, gồm bản nháp và đã xuất bản |
| `POST /api/v1/admin/courses` | Tạo nháp với Title, Description, CoverImageUrl, DifficultyLevel, EstimatedMinutes, Skills (`speaking`/`listening`/`reading`/`writing`/`grammar`) |
| `GET /api/v1/admin/courses/{id}` | Nội dung biên soạn, gồm các bài học và JSON đã giải mã |
| `PUT /api/v1/admin/courses/{id}` | Lưu tên, mô tả, ảnh bìa bản nháp |
| `POST /api/v1/admin/courses/{id}/lessons` | Thêm bài Speaking/Listening/Reading/Writing/Grammar |
| `PUT /api/v1/admin/courses/{id}/lessons/{lessonId}` | Lưu bài học thuộc đúng khóa học |
| `POST /api/v1/admin/courses/{id}/publish` | Kiểm tra và xuất bản |
| `POST /api/v1/admin/uploads` | Multipart `file` + `kind=cover/audio`; trả URL dùng trong frontend |
| `POST /api/v1/admin/pronunciation/ipa` | Tạo IPA Mỹ từ `{ "text": "câu tiếng Anh" }`, tối đa 1000 ký tự; không lưu dữ liệu |
| `GET /api/v1/media/{fileName}` | Đọc ảnh/audio, hỗ trợ Range/206; cần JWT và quyền đọc nội dung |

Tạo khóa học luôn đặt SourceType=system, CreatedBy từ JWT, IsPublished=false; không lấy các giá trị này từ client. Mỗi kỹ năng được chọn khởi tạo một Lesson trống với cấp độ/thời lượng mặc định, vì schema lưu CEFR, thời lượng và kỹ năng ở Lessons. Tiếp tục chỉnh riêng từng bài ở bước 2. Các request ghi dùng transaction; không cho chỉnh khóa học đã xuất bản qua trình tạo này (`409`). Không chỉnh nội dung user_upload bằng các API quản trị khóa học hệ thống.

`Lessons.Content` lưu JSON version 1 `{ version, speaking, listening, grammar }`. Speaking gồm `goals`, `sentences[{text,ipa,audioUrl}]`. Listening gồm `transcript`, `hideTranscriptFirstListen`, `questions[]` hỗ trợ multiple_choice (options/correctOptionIndex), fill_blank (prompt có [blank]/answer/caseSensitive) và matching (pairs left/right); mỗi câu có explanation/atSeconds tùy chọn. Audio chính lưu ở Lessons.AudioUrl. Bản nháp được phép chưa có câu/audio; xuất bản yêu cầu mô tả, ảnh bìa và ít nhất một bài active hoàn chỉnh. Audio Listening, transcript và câu hỏi phải đủ; Speaking phải có câu luyện nói. Chưa có TTS AI hoặc chấm điểm phát âm. API học viên hiện chỉ trả tóm tắt bài học, không trả JSON đáp án quản trị.

IPA được sinh offline từ 125.927 mục từ Mỹ của ipa-dict/CMUdict, đóng gói trong assembly (không cần Python/API key hoặc kết nối Internet). API trả `ipa`, `accent: en-US`, `unknownWords`, `alternatives`. Mặc định chọn cách đọc đầu tiên; đây là phiên âm theo từ, chưa phân biệt nghĩa/ngữ cảnh hoặc nối âm cả câu. Từ chưa biết, số và ký hiệu không hỗ trợ trả `ipa: null` và danh sách cần kiểm tra, không trả câu phiên âm bị thiếu. Khi lưu Speaking, backend tự điền IPA còn trống nếu tra được toàn bộ câu; giữ nguyên bản sửa thủ công. IPA tối đa 8000 ký tự trong JSON hiện có, không thay đổi schema. Nguồn dữ liệu, checksum và giấy phép ở `EnglishLearning.Api/Resources/Pronunciation/README.md`. Tests bao gồm câu thường, contractions, từ ghép, nhiều cách đọc, input bounds, unknown words, quyền admin bị thu hồi và lưu/tải lại IPA.

Upload ảnh tối đa 5 MB (JPG/PNG/WebP), audio tối đa 25 MB (MP3/WAV/AAC/M4A). Server kiểm tra phần mở rộng và magic bytes, đổi tên GUID; không dùng tên tệp của client để tạo đường dẫn. Tệp lưu ngoài wwwroot tại `App_Data/uploads` (gitignored); có thể cấu hình `MediaStorage:RootPath`. Cần lưu giữ thư mục này khi triển khai/sao lưu. Tệp nháp chỉ Admin được đọc; học viên chỉ đọc tệp được tham chiếu bởi khóa học đã xuất bản mà họ có quyền xem. Chưa có cơ chế dọn tệp tải lên nhưng không còn được dùng.

Kiểm thử `CourseAuthoringTests.cs` bao gồm quyền Admin, role bị thu hồi, nháp → Speaking/Listening → xuất bản, validation, truy cập bài thuộc khóa khác, định dạng upload và HTTP Range. Tất cả dữ liệu SQL dùng transaction rollback; tệp kiểm thử nằm trong thư mục temp riêng và được dọn sau test.

## Danh sách khóa học

- `GET /api/v1/courses`: danh sách có phân trang. Query: `search` (tên/mô tả, tối đa 200 ký tự), `level` (A1–C2), `skill` (speaking/writing/listening/reading/grammar), `source` (system/user_upload), `status` (all/in_progress/completed/not_started), `sort` (updated/newest/popular/title), `page` (1–10000), `pageSize` (1–24, mặc định 6). Query không hợp lệ trả `400`.
- Response có `items`, `totalCount`, `page`, `pageSize`, `totalPages` và `summary` tổng khóa học/đang học/hoàn thành trước khi áp dụng bộ lọc. Trang vượt phạm vi trả danh sách trống. Sort luôn có CourseId để giữ thứ tự ổn định khi các giá trị bằng nhau.
- `GET /api/v1/courses/{courseId}`: thông tin khóa học và danh sách bài học đang hoạt động, sắp theo OrderIndex rồi LessonId. Không trả nội dung bài học hoặc dữ liệu học viên khác.
- Cả hai API yêu cầu JWT của tài khoản còn hoạt động (`401` khi thiếu/hết hạn/vô hiệu hóa), trả `Cache-Control: no-store`. Chỉ trả khóa học đã xuất bản: khóa học hệ thống và khóa học `user_upload` do chính người đăng nhập tạo. Khóa học nháp, khóa học của người khác hoặc ID không tồn tại trả `404` ở endpoint chi tiết. Database lỗi/timed out trả `503`; request bị hủy trả `499`.
- Dùng nguyên schema Courses, Lessons, UserCourses, Users trong `DATABASE_SCHEMA.md`; không thêm cột, migration hay seed. Cấp độ/kỹ năng/số bài/thời lượng tổng hợp từ Lessons.IsActive. Khi lọc đồng thời cấp độ và kỹ năng, phải có một bài học thỏa cả hai. `TimedLessonCount` cho biết số bài đã có thời lượng. `popular` đếm lượt tham gia có Status khác abandoned. ProgressPercent/Status chỉ lấy bản ghi UserCourses của người đăng nhập.
- Database chưa có dữ liệu sẽ trả `200` với items trống. Không tạo số liệu đánh giá sao, giá hoặc gia sư AI từ giao diện mẫu. Chưa triển khai API đăng ký học, học bài, bookmark hoặc tạo khóa học AI trong phạm vi danh sách này.
- Kiểm thử trong `CourseCatalogTests.cs` dùng SQL Server thật trong transaction và rollback khi kết thúc; chạy cùng nhóm `RegistrationSqlServerTests` với biến `ENGLISHLEARNING_TEST_CONNECTION_STRING` như hướng dẫn trên.

## Bài học Grammar

Áp dụng `database/003_add_grammar_lesson_type.sql` sau hai script trước khi triển khai phiên bản hỗ trợ Grammar. Script chỉ mở rộng `CK_Lessons_SkillType` thêm `grammar`, có transaction và kiểm tra định nghĩa trước khi sửa; chạy lại được. Không thêm bảng/cột, không sửa dữ liệu bài học, không tự chạy lúc API khởi động. Database local `EnglishLearningDB` đã được cập nhật ngày 2026-10-22.

Các API tạo/sửa bài hiện có nhận `skillType: "grammar"` và `grammar: { topic, rules, commonMistakes, questions }`; các nội dung của loại khác và `audioUrl` phải là null. API tạo khóa học nhận Skills gồm Speaking, Listening, Reading, Writing, Grammar (1–5 loại, không trùng). Nội dung Grammar nằm trong Lessons.Content JSON version 1; các bài Speaking/Listening cũ vẫn đọc được.

Grammar có tối đa 30 câu hỏi với `type` là `multiple_choice`, `fill_blank`, `error_correction`. Mỗi câu có prompt, explanation và tag. Trắc nghiệm/sửa lỗi có 2–4 options và correctOptionIndex; sửa lỗi cần correction. Điền từ cần `[blank]`, answer, acceptedAnswers (tối đa 10 đáp án thay thế) và caseSensitive. Backend kiểm tra null, độ dài, số lựa chọn và chỉ số đáp án. Có thể lưu lý thuyết trống khi còn nháp; xuất bản cần topic, rules và ít nhất một câu hỏi hợp lệ. Chỉ Admin còn hoạt động được ghi; bài đã xuất bản không sửa ở luồng này.

Danh sách/chi tiết khóa học hiển thị loại Grammar; `GET /api/v1/courses?skill=grammar` lọc khóa học có bài Grammar active. API học viên vẫn chỉ trả tóm tắt bài, không lộ đáp án quản trị. Chưa triển khai lưu điểm/bài nộp Grammar hay ErrorLogs cho học viên. `GrammarAuthoringTests.cs` kiểm tra migration chạy lại trong transaction rollback, khởi tạo/thêm/sửa, validation, xuất bản, lọc khóa học và quyền ghi; không để lại dữ liệu kiểm thử.

## Bài học Writing và Reading

Đã hỗ trợ biên soạn đủ 5 loại Speaking, Listening, Reading, Writing và Grammar. `writing`/`reading` đã nằm trong CHECK Lessons.SkillType; chức năng này chỉ mở rộng DTO và JSON Lessons.Content, không có migration hay thay đổi schema mới. Skills lúc tạo khóa học nhận 1–5 loại không trùng. Các API POST/PUT lessons dùng chung và kiểm tra quyền Admin hiện tại trong database như trước.

Writing: `writing: { taskType, topic, prompt, instructions, minWords, maxWords, sampleAnswer, rubric }`. TaskType nhận essay/email/paragraph/report/proposal. Topic là chủ đề riêng, tối đa 255 ký tự; bài cũ không có topic vẫn đọc được. MinWords/MaxWords từ 1–5000 và min ≤ max. Rubric tối đa 8 tiêu chí `{name,description,weight}`; khi có tiêu chí, tổng weight phải bằng 100. Có thể lưu nháp chưa có đề hoặc rubric; xuất bản cần đề bài và ít nhất một tiêu chí, tổng trọng số 100%. Bài mẫu không bắt buộc. Xem trước nhập bài thử và kiểm tra số từ; chưa có chấm điểm/nhận xét AI hoặc lưu bài nộp học viên.

Reading: `reading: { passageTitle, category, passage, translation, instructions, vocabulary, questions }`. Category tối đa 255 ký tự; passage/translation tối đa 30000 ký tự mỗi trường, translation là bản dịch admin nhập tùy chọn. Vocabulary tối đa 30 mục `{word,meaning,example}`. Questions tối đa 30, hỗ trợ multiple_choice (options/correctOptionIndex), fill_blank (prompt có [blank], answer, acceptedAnswers, caseSensitive), short_answer (answer, acceptedAnswers, caseSensitive; không yêu cầu [blank]), true_false_not_given (answer true/false/not_given), matching (pairs left/right). Mỗi câu có focus (skimming/scanning/inference/vocabulary, mặc định scanning) và points (0.1–10, mặc định 1), explanation/reference cho dẫn chứng. Xuất bản cần bài đọc và ít nhất một câu hỏi. Preview hiển thị [blank] thành dấu chấm, giữ nguyên marker trong bản biên soạn và JSON lưu trữ.

Mỗi bài chỉ được gửi đúng một nội dung tương ứng skillType; audioUrl của Reading/Writing phải null. GET quản trị trả nội dung Reading/Writing đã lưu; API danh mục/chi tiết học viên chỉ trả tóm tắt và hỗ trợ lọc skill=reading/writing, không lộ đáp án/bài mẫu/rubric qua danh mục. `ReadingWritingAuthoringTests.cs` kiểm tra khởi tạo 5 loại, thêm vào khóa hiện có, save/reload/publish/filter, validation, giới hạn từ/trọng số, quyền ghi và isolation giữa khóa học. Dữ liệu test được rollback. `ReadingWritingDemoTests.cs` kiểm tra các trường của demo mới, short_answer, validation điểm/kỹ năng và tương thích JSON version 1 cũ.

Writing/Reading hỗ trợ định dạng Markdown giới hạn: tiêu đề H2/H3, đậm, nghiêng, gạch chân (++), tô sáng (==), danh sách, trích dẫn và inline code. HTML/links/embeds không được thực thi. Frontend Reading mô phỏng chia đôi màn hình, chú giải từ vựng tại chỗ, song ngữ từ bản dịch nhập sẵn và Review tiến độ kiểm tra. Chưa kết nối dịch vụ chấm bài, dịch tự động hoặc sinh câu hỏi AI.

## Kiểm tra build

```powershell
dotnet build EnglishLearningSystem.sln
```

Câu trắc nghiệm Reading/Listening/Grammar (và chọn phần sai của Grammar) có 2–4 lựa chọn không trống, mỗi lựa chọn tối đa 500 ký tự và một correctOptionIndex hợp lệ. API từ chối ít hơn 2 hoặc nhiều hơn 4 lựa chọn. Không thay đổi schema database.
