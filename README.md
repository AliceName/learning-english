

## 1. Chuẩn bị môi trường

| Thành phần | Yêu cầu | Dùng để làm gì? |
| --- | --- | --- |
| Git | Cài sẵn, có lệnh `git` | Clone và cập nhật mã nguồn |
| Node.js và npm | Node.js **20.9.0 trở lên**, theo yêu cầu của Next.js trong dự án | Chạy frontend Next.js 16.4.2 / React 19.3.0 |
| .NET SDK | **9.0.307** hoặc bản vá mới hơn trong nhánh **9.0.3xx**, theo [global.json](global.json) | Build và chạy backend .NET 9 |
| SQL Server | Instance đang chạy, tài khoản có quyền tạo/truy cập database | Lưu tài khoản, khóa học và kết quả học tập |
| `sqlcmd` hoặc SQL Server Management Studio (SSMS) | Kết nối được SQL Server của bạn | Chạy các script tạo schema |
| MongoDB | MongoDB local hoặc MongoDB Atlas; cần cho chức năng từ điển | Lưu các mục từ và cache nghĩa |
| Cloudinary | Tài khoản và thông tin API riêng; cần cho chức năng upload ảnh/audio và audio từ điển | Lưu media của ứng dụng |

Python **không bắt buộc** để chạy web hiện tại; xem phần tùy chọn ở cuối tài liệu. Cần Internet để tải dependencies; tra từ chưa có trong cache, lấy audio nguồn và truy cập Cloudinary cũng cần kết nối mạng.

Kiểm tra các công cụ đã vào `PATH`:

```powershell
git --version
node --version
npm --version
dotnet --list-sdks
```

Cài riêng SDK được yêu cầu trong `global.json`; chỉ có SDK thuộc nhánh lớn hơn không bảo đảm chạy được solution này.

## 2. Clone code và cài dependencies

```powershell
git clone https://github.com/AliceName/learning-english.git
cd learning-english

dotnet restore EnglishLearningSystem.sln --locked-mode
dotnet tool restore
npm --prefix frontend ci
```

`npm ci` sử dụng `frontend/package-lock.json`; không cần cài từng package thủ công. `dotnet tool restore` cài các công cụ trong `.config/dotnet-tools.json`, không tự tạo database.

GitHub chỉ cung cấp mã nguồn và tài nguyên được commit. Database, tài khoản đã tạo trên máy khác, .NET User Secrets, `.env.local`, cache và media trên Cloudinary **không được sao chép theo khi clone**. Các bước sau thiết lập chúng cho máy của bạn.

## 3. Cấu hình kết nối SQL Server và khóa JWT

Thay `'.\SQLEXPRESS'` bằng instance SQL Server thực tế, ví dụ `'localhost'` hoặc `'(localdb)\MSSQLLocalDB'`. Không giữ nguyên tên server của máy người phát triển trong `appsettings.Development.json`.

Ví dụ dùng **Windows Authentication**, lưu cấu hình vào User Secrets của backend:

```powershell
$sqlServerInstance = '.\SQLEXPRESS'

dotnet user-secrets set 'ConnectionStrings:DefaultConnection' "Server=$sqlServerInstance;Database=EnglishLearningDB;Trusted_Connection=True;TrustServerCertificate=True" --project backend/EnglishLearning.Api

.\backend\scripts\Initialize-JwtSecret.ps1
```

Tài khoản Windows chạy backend phải có quyền truy cập `EnglishLearningDB`. Nếu dùng SQL Authentication, cấu hình connection string tương ứng trong User Secrets, chẳng hạn qua **Manage User Secrets** của project `EnglishLearning.Api` trong Visual Studio.

Script JWT tạo khóa ngẫu nhiên khi chưa có và giữ nguyên khóa đã tồn tại. Backend cũng tự tạo khóa còn thiếu trong môi trường Development. Không cần chép khóa JWT từ máy khác.

User Secrets nằm ngoài repository, dùng cho cấu hình local. Không lưu mật khẩu database, khóa JWT hoặc Cloudinary API Secret vào source code hay frontend. `TrustServerCertificate=True` trong ví dụ phục vụ SQL Server local.

## 4. Tạo database và áp dụng schema SQL

Chạy **4 script theo thứ tự**, chỉ chuyển sang lệnh tiếp theo khi lệnh trước thành công. Nếu mở terminal mới, khai báo lại `$sqlServerInstance` với instance ở bước 3.

```powershell
$sqlServerInstance = '.\SQLEXPRESS'

sqlcmd -S $sqlServerInstance -d master -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/003_add_grammar_lesson_type.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/004_add_translation_practice.sql
```

| Script | Mục đích |
| --- | --- |
| `001_initial_schema.sql` | Tạo `EnglishLearningDB` và các bảng còn thiếu |
| `002_add_user_role.sql` | Bổ sung role `admin` / `user` |
| `003_add_grammar_lesson_type.sql` | Cho phép bài học Grammar |
| `004_add_translation_practice.sql` | Tạo kho câu, kho đáp án và lịch sử phát đề cho Luyện phiên dịch |

Các lệnh trên dùng Windows Authentication (`-E`). Nếu chỉ dùng SSMS, mở và chạy lần lượt các file trong [backend/database](backend/database). Chọn database `EnglishLearningDB` cho script 002 đến 004.

Backend **không tự tạo hoặc cập nhật schema khi khởi động**. Không dùng `dotnet ef database update` hoặc `EnsureCreated` thay cho các script này. Với database đã có cấu trúc khác, cần đối chiếu [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) trước khi áp dụng.

## 5. Cấu hình MongoDB cho từ điển

Khởi động MongoDB local, hoặc chuẩn bị URI MongoDB Atlas có quyền truy cập database của bạn. Ví dụ cấu hình local:

```powershell
dotnet user-secrets set 'MongoDbSettings:ConnectionString' 'mongodb://localhost:27017' --project backend/EnglishLearning.Api
dotnet user-secrets set 'MongoDbSettings:DatabaseName' 'EnglishLearningDB' --project backend/EnglishLearning.Api
dotnet user-secrets set 'MongoDbSettings:VocabularyCollectionName' 'VocabularyEntries' --project backend/EnglishLearning.Api

dotnet run --project backend/EnglishLearning.Api --launch-profile http -- --initialize-vocabulary=true
```

Nếu dùng Atlas, thay URI local bằng URI của môi trường riêng và cho phép máy của bạn kết nối. Giữ URI có mật khẩu trong User Secrets.

Lệnh `--initialize-vocabulary=true` tạo collection/validator theo [MONGODB_SCHEMA.md](MONGODB_SCHEMA.md), sau đó thoát; đây chưa phải lệnh chạy API. Khởi động bình thường không tự áp dụng validator. Từ điển sẽ lấy và lưu mục từ khi người đã đăng nhập tra lần đầu, không cần nhập sẵn toàn bộ từ vựng.

Nếu chỉ cần xem giao diện hoặc dùng phần tài khoản/khóa học, có thể chưa chạy MongoDB; chức năng từ điển sẽ không có đầy đủ khả năng lưu cache. Việc MongoDB mất kết nối không ngăn API khởi động, nhưng cấu hình MongoDB vẫn phải hợp lệ.

## 6. Cấu hình Cloudinary nếu sử dụng ảnh/audio

API khởi động được khi `Cloudinary:Enabled=false` như cấu hình mẫu. Tuy nhiên, upload ảnh/audio mới và chuẩn bị audio từ điển cần Cloudinary; khi tắt, ứng dụng **không tự chuyển sang ghi file local**.

Để bật các chức năng media, lấy **Cloud Name**, **API Key**, **API Secret** từ tài khoản Cloudinary của bạn rồi chạy:

```powershell
.\backend\scripts\Set-CloudinarySecrets.ps1
```

Script hỏi thông tin cấu hình, che API Key/Secret khi nhập, lưu vào User Secrets và bật Cloudinary với prefix Development `els/dev`. Script giữ nguyên các cấu hình SQL, MongoDB và JWT đã có. Không đặt credentials vào `frontend/.env.local`.

Có thể kiểm tra kết nối bằng script riêng; lệnh này tạo rồi dọn các asset thử nghiệm của chính lượt kiểm tra:

```powershell
.\backend\scripts\Test-CloudinaryEnvironment.ps1
```

Xem [hướng dẫn backend](backend/README.md) nếu cần cấu hình nâng cao hoặc chuyển dữ liệu media đã có từ một môi trường khác. Máy mới không cần chạy các lệnh migration/cleanup media để bắt đầu.

## 7. Chạy backend

Mở **terminal thứ nhất** tại thư mục gốc repository:

```powershell
.\backend\scripts\Start-Development.ps1
```

Script chọn môi trường Development, kiểm tra khóa JWT và chạy profile HTTP. Lệnh tương đương khi chạy trực tiếp:

```powershell
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

Giữ terminal đang chạy. API mặc định tại [http://localhost:5000](http://localhost:5000); Swagger tại [http://localhost:5000/swagger](http://localhost:5000/swagger).

Từ terminal khác, kiểm tra các dịch vụ:

```powershell
Invoke-RestMethod http://localhost:5000/api/v1/health
Invoke-RestMethod http://localhost:5000/api/v1/health/database
Invoke-RestMethod http://localhost:5000/api/v1/health/mongodb
```

Endpoint đầu chỉ xác nhận API đang chạy. Hai endpoint sau kiểm tra kết nối SQL Server và MongoDB, trả `503` khi kết nối lỗi. MongoDB health chỉ ping, không thay thế bước khởi tạo collection/validator.

## 8. Cấu hình và chạy frontend

Mở **terminal thứ hai** từ thư mục gốc repository:

```powershell
cd frontend
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Trong `frontend/.env.local`, kiểm tra giá trị sau khớp địa chỉ backend:

```dotenv
API_BASE_URL=http://localhost:5000
```

Biến này được đọc ở server Next.js, không cần tiền tố `NEXT_PUBLIC_`. Nếu đổi cổng backend, sửa giá trị rồi khởi động lại frontend. Các yêu cầu đăng nhập/khóa học/từ điển đi qua proxy cùng origin của Next.js.

Mở [http://localhost:3000](http://localhost:3000). Frontend cũng cho phép địa chỉ local [http://127.0.0.1:3000](http://127.0.0.1:3000) trong Development; nên dùng nhất quán một địa chỉ khi đăng nhập vì cookie của hai hostname không dùng chung.

| Đường dẫn | Chức năng |
| --- | --- |
| `/` | Trang chủ |
| `/register` | Tạo tài khoản học viên |
| `/login` | Đăng nhập |
| `/account` | Tài khoản học viên, cần đăng nhập |
| `/courses` | Danh sách khóa học, cần đăng nhập |
| `/translation-practice` | Luyện phiên dịch Việt → Anh, cần đăng nhập và [nạp kho đề](backend/README.md#luyện-phiên-dịch) |
| `/admin/courses` | Quản trị khóa học, cần role `admin` |

Database mới chưa có tài khoản hoặc khóa học mẫu. Tạo học viên tại `/register`; để biên soạn nội dung, tạo admin ở bước tiếp theo rồi tạo/xuất bản khóa học. Trang chủ vẫn xem được khi backend chưa chạy, nhưng đăng ký/đăng nhập và dữ liệu học tập cần API/SQL Server hoạt động.

## 9. Tạo tài khoản quản trị

Sau khi cấu hình backend và chạy đủ schema SQL, mở thêm terminal tại thư mục gốc:

```powershell
.\backend\scripts\Initialize-Admin.ps1
.\backend\scripts\Initialize-Admin.ps1 -ShowCredentials
```

Email mặc định là `admin@linguaai.local`; mật khẩu được tạo ngẫu nhiên và lưu trong User Secrets của máy bạn. `-ShowCredentials` chỉ hiển thị thông tin đã lưu để bạn đăng nhập tại `/login`. Không có một mật khẩu admin chung được lấy từ GitHub.

Chạy lại script không tạo admin trùng hoặc tự reset mật khẩu. Đăng ký công khai luôn tạo role `user`, không tạo admin. Sau khi đăng nhập admin, mở `/admin/courses` để tạo và xuất bản khóa học.

## 10. Những lần chạy tiếp theo

Khởi động SQL Server và MongoDB nếu dùng từ điển, sau đó chạy lại hai terminal ở bước 7 và 8. Không cần tạo lại database, JWT hoặc admin mỗi lần mở dự án.

Khi pull code mới, kiểm tra thay đổi trong README/schema. Chạy lại `npm --prefix frontend ci` khi dependencies frontend đổi và `dotnet restore EnglishLearningSystem.sln --locked-mode` khi dependencies backend đổi; chỉ áp dụng script SQL/MongoDB bổ sung khi phiên bản đó yêu cầu.

## 11. Kiểm tra build và test

Tại thư mục gốc:

```powershell
dotnet build EnglishLearningSystem.sln
dotnet test EnglishLearningSystem.sln --configuration Release
npm --prefix frontend run lint
npm --prefix frontend run build
```

Dừng `npm run dev` bằng `Ctrl+C` trước khi build frontend, rồi chạy lại dev nếu tiếp tục phát triển. Sau khi đổi `.env.local` hoặc cấu hình Next.js, khởi động lại frontend và tải lại trang.

Các integration test SQL/MongoDB cần cấu hình kiểm thử riêng; nhiều test sẽ được bỏ qua khi chưa đặt biến môi trường tương ứng. Xem [backend/README.md](backend/README.md) cho `ENGLISHLEARNING_TEST_CONNECTION_STRING`, `ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING` và các smoke test. Dùng database kiểm thử riêng.

Kiểm thử trình duyệt và yêu cầu Playwright được mô tả trong [frontend/README.md](frontend/README.md).

## 12. Python AI — tùy chọn

## Lỗi thường gặp sau khi clone

| Hiện tượng | Kiểm tra/cách xử lý |
| --- | --- |
| Không tìm được .NET SDK phù hợp | Cài SDK đúng nhánh trong `global.json`, kiểm tra bằng `dotnet --list-sdks` |
| `sqlcmd` không được nhận diện | Cài công cụ vào `PATH`, hoặc chạy 3 script SQL bằng SSMS |
| SQL health trả `503`, đăng ký/đăng nhập lỗi | Kiểm tra instance SQL đang chạy, connection string trên máy mới và quyền của tài khoản kết nối |
| Lỗi cột `Role` hoặc không lưu được Grammar | Kiểm tra đã chạy script 002 và 003 trên đúng database |
| Lỗi `JwtOptions.SigningKey` | Chạy `Initialize-JwtSecret.ps1`; nếu đã có khóa sai/quá ngắn, sửa cấu hình trong User Secrets. Chạy backend bằng môi trường Development |
| Từ điển không lưu được dữ liệu | Kiểm tra MongoDB, URI/quyền truy cập và chạy `--initialize-vocabulary=true` trên đúng database |
| Upload/audio báo chưa cấu hình storage | Chạy `Set-CloudinarySecrets.ps1`, kiểm tra Cloudinary rồi khởi động lại API |
| Frontend báo không kết nối được API | Kiểm tra backend đang chạy và `API_BASE_URL`; sửa `.env.local` rồi khởi động lại Next.js |
| Next.js chặn dev resource khi dùng địa chỉ khác | Dùng `localhost:3000` hoặc `127.0.0.1:3000` đã được cấu hình; hostname khác cần khai báo cụ thể trong `allowedDevOrigins` rồi khởi động lại dev server |
| Danh sách khóa học trống | Database mới không tự có khóa học; đăng nhập admin, tạo nội dung hợp lệ và xuất bản |

## Tài liệu trong repository

| Tài liệu/thư mục | Nội dung |
| --- | --- |
| [frontend/README.md](frontend/README.md) | Giao diện, các luồng sử dụng và kiểm thử frontend |
| [backend/README.md](backend/README.md) | API, cấu hình nâng cao, Cloudinary và integration test |
| [backend/database](backend/database) | Các script schema SQL chạy tường minh |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Thiết kế dữ liệu SQL Server |
| [MONGODB_SCHEMA.md](MONGODB_SCHEMA.md) | Collection và validator từ điển |
| [requirements.txt](requirements.txt) | Dependencies Python tùy chọn |
