# LEWA — Learning English With AI

Ứng dụng học tiếng Anh với khóa học 5 kỹ năng, bộ thẻ từ vựng và lộ trình cá nhân tạo từ tài liệu. Hướng dẫn này dùng **Windows PowerShell** để chạy nhánh **`Viet`** trên máy cá nhân.

## Tính năng hiện có

| Tính năng | Cách sử dụng |
| --- | --- |
| Khóa học | Học viên tìm, lọc và học các khóa đã xuất bản; Admin biên soạn Speaking, Listening, Reading, Writing, Grammar và quản lý hiển thị |
| Reading | Đọc bài có ảnh, phóng to ảnh, điều chỉnh cỡ chữ, làm câu hỏi và xem kết quả; tô sáng, gạch chân, ghi chú đoạn tiếng Anh trong Sổ tay |
| Flashcards khóa học | Tổng hợp từ vựng Reading và bộ thẻ do Admin tạo; nút mũi tên chuyển thẻ, nhấn đúp để lật thẻ; lưu bản riêng để ôn |
| Tạo khóa học AI | Tải PDF/DOCX, chọn mục tiêu, CEFR và kỹ năng; duyệt dàn ý, tạo nội dung rồi lưu khóa học riêng. Giao diện có nền pastel và hình mèo minh họa |
| Listening và Grammar | Làm bài, nộp đáp án và xem phản hồi theo nội dung đã biên soạn |
| Speaking | Nghe mẫu, ghi âm/chọn WAV, gửi chấm và xem lịch sử khi đã cấu hình dịch vụ mô hình local |
| Từ điển và luyện phiên dịch | Tra từ Anh–Anh/Anh–Việt/Việt–Anh; luyện dịch với kho đề và dịch vụ chấm được cấu hình riêng |
| Writing | Biên soạn bài trong khóa học; công cụ hỗ trợ viết tại `/writing` dùng dịch vụ Python và checkpoint local |

**Để chạy lần đầu:** làm lần lượt mục 1–9 bên dưới. SQL Server cần cho tài khoản và dữ liệu học tập. MongoDB, Cloudinary và các dịch vụ AI được bật theo tính năng bạn muốn dùng; không cần huấn luyện mô hình để mở website hoặc học Reading/Grammar/Flashcards.

- [Chuẩn bị môi trường](#1-chuẩn-bị-môi-trường) · [Lấy mã nguồn](#2-clone-code-và-cài-dependencies) · [Tạo database](#4-tạo-database-và-áp-dụng-schema-sql)
- [Chạy ứng dụng local](#7-chạy-ứng-dụng-local) · [Chạy frontend](#8-cấu-hình-và-chạy-frontend) · [Dùng các tính năng mới](#sử-dụng-các-tính-năng-mới)
- [Cập nhật bản đã cài](#10-những-lần-chạy-tiếp-theo) · [Xử lý lỗi](#lỗi-thường-gặp-sau-khi-clone)

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
| Gemini API | API key có quyền dùng model văn bản; cần thêm model TTS nếu tạo Listening | Tạo khóa học AI; không cần cho các bài học được Admin biên soạn sẵn |

Python **không bắt buộc** để chạy giao diện, tài khoản, Reading, Grammar, Flashcards hoặc tạo khóa học qua Gemini. Chấm Speaking và hỗ trợ Writing bằng mô hình local cần Python cùng checkpoint riêng; xem [SPEAKING.md](SPEAKING.md) và mục 12. Cần Internet để tải dependencies và gọi các dịch vụ ngoài như Gemini, nguồn từ điển, Cloudinary.

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
git clone --branch Viet --single-branch https://github.com/AliceName/learning-english.git
cd learning-english

dotnet restore EnglishLearningSystem.sln --locked-mode
dotnet tool restore
npm --prefix frontend ci
```

`npm ci` sử dụng `frontend/package-lock.json`; không cần cài từng package thủ công. `dotnet tool restore` cài các công cụ trong `.config/dotnet-tools.json`, không tự tạo database.

Kiểm tra nhánh hiện tại bằng `git branch --show-current`. Nếu đã có repository trên máy, xem mục 10 để cập nhật.

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

Chạy **6 script theo thứ tự**, chỉ chuyển sang lệnh tiếp theo khi lệnh trước thành công. Nếu mở terminal mới, khai báo lại `$sqlServerInstance` với instance ở bước 3.

```powershell
$sqlServerInstance = '.\SQLEXPRESS'

sqlcmd -S $sqlServerInstance -d master -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/003_add_grammar_lesson_type.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/004_add_translation_practice.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/005_link_flashcard_decks_to_courses.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/006_add_learning_activity.sql
```

| Script | Mục đích |
| --- | --- |
| `001_initial_schema.sql` | Tạo `EnglishLearningDB` và các bảng còn thiếu |
| `002_add_user_role.sql` | Bổ sung role `admin` / `user` |
| `003_add_grammar_lesson_type.sql` | Cho phép bài học Grammar |
| `004_add_translation_practice.sql` | Tạo kho câu, kho đáp án và lịch sử phát đề cho Luyện phiên dịch |
| `005_link_flashcard_decks_to_courses.sql` | Thêm `FlashcardDecks.CourseId INT NULL` và khóa ngoại tới `Courses` cho bộ thẻ trong khóa học; giữ các bộ thẻ cũ |
| `006_add_learning_activity.sql` | Tạo bảng lưu loại hoạt động theo ngày và tài khoản cho chuỗi ngày học |

Các lệnh trên dùng Windows Authentication (`-E`). Nếu chỉ dùng SSMS, mở và chạy lần lượt các file trong [backend/database](backend/database). Chọn database `EnglishLearningDB` cho script 002 đến 006.

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

Lệnh `--initialize-vocabulary=true` tạo collection/validator từ điển Anh–Anh theo [MONGODB_SCHEMA.md](MONGODB_SCHEMA.md), sau đó thoát; đây chưa phải lệnh chạy API. Để dùng thêm Anh–Việt và Việt–Anh, chạy tiếp:

```powershell
dotnet run --project backend/EnglishLearning.Api --launch-profile http -- --initialize-bilingual-vocabulary=true
```

Khởi động bình thường không tự áp dụng validator. Từ điển sẽ lấy và lưu mục từ khi người đã đăng nhập tra lần đầu, không cần nhập sẵn toàn bộ từ vựng.

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

### Cấu hình Gemini cho tạo khóa học AI (tùy chọn)

Lưu API key của bạn ở backend, thay giá trị mẫu trước khi chạy:

```powershell
dotnet user-secrets set 'CourseGenerationAi:ApiKey' 'THAY_BANG_GEMINI_API_KEY_CUA_BAN' --project backend/EnglishLearning.Api
```

Model văn bản và TTS được khai báo trong [appsettings.json](backend/EnglishLearning.Api/appsettings.json), lần lượt là `CourseGenerationAi:Model` và `CourseGenerationAi:TtsModel`. Chọn model mà API key của bạn có quyền truy cập; có thể ghi đè bằng User Secrets:

```powershell
dotnet user-secrets set 'CourseGenerationAi:Model' 'TEN_MODEL_VAN_BAN_CUA_BAN' --project backend/EnglishLearning.Api
dotnet user-secrets set 'CourseGenerationAi:TtsModel' 'TEN_MODEL_TTS_CUA_BAN' --project backend/EnglishLearning.Api
```

Hai lệnh ghi đè model chỉ cần chạy khi đổi cấu hình mặc định; các giá trị `TEN_MODEL_...` là chỗ điền, không phải model dùng được. API key không được đặt trong frontend. Khởi động lại backend sau khi cấu hình.

Tạo bài Listening cần **cả Gemini TTS và Cloudinary đã bật** để sinh/lưu audio. Nếu chưa cấu hình media/TTS, bỏ chọn Listening trước khi tạo; các kỹ năng khác dùng model văn bản. Chức năng này gửi văn bản trích xuất từ tài liệu đến Gemini và có thể sử dụng hạn mức/chi phí của API key của bạn.

Nếu chưa có key, bạn vẫn chạy ứng dụng, học khóa có sẵn và dùng các chức năng không gọi Gemini. Trang tạo khóa học AI sẽ báo chưa khả dụng.

## 7. Chạy ứng dụng local

Chạy `.\Start-Dev.cmd` từ thư mục gốc để khởi động frontend, backend và AI Writing. Launcher đợi cả ba dịch vụ sẵn sàng. Nhấn Ctrl+C trong terminal của launcher để dừng các tiến trình do nó khởi tạo. Nếu muốn chạy frontend và backend ở hai terminal riêng, làm theo phần dưới.

### Chạy backend riêng

Mở **terminal thứ nhất** tại thư mục gốc repository:

```powershell
.\backend\scripts\Start-Development.ps1
```

Script chọn môi trường Development, kiểm tra khóa JWT và chạy profile HTTP. Lệnh tương đương khi chạy trực tiếp:

```powershell
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

Giữ terminal đang chạy. API mặc định tại [http://localhost:5000](http://localhost:5000); Swagger tại [http://localhost:5000/swagger](http://localhost:5000/swagger).

Trên Windows, backend Development tự khởi động AI Writing nếu cổng 8000 đang trống và model đã có sẵn local. Backend tái sử dụng AI đã healthy trên cổng 8000 và chỉ dừng AI do nó khởi tạo. Nếu AI không sẵn sàng, kiểm tra log backend. API vẫn chạy và Writing báo không khả dụng. Tắt auto-start bằng `$env:WritingAi__AutoStart = 'false'` trước khi chạy backend, hoặc đặt `WritingAi:AutoStart` thành `false` trong cấu hình Development. Khi chạy bằng `Start-Dev.cmd`, launcher quản lý AI trực tiếp.

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
# Máy mới chưa có mô hình Speaking: bỏ qua bước tự khởi động bộ chấm local.
$env:SPEAKING_AUTO_START = '0'
npm run dev
```

Trong `frontend/.env.local`, kiểm tra giá trị sau khớp địa chỉ backend:

```dotenv
API_BASE_URL=http://localhost:5000
```

Biến này được đọc ở server Next.js, không cần tiền tố `NEXT_PUBLIC_`. Nếu đổi cổng backend, sửa giá trị rồi khởi động lại frontend. Các yêu cầu đăng nhập/khóa học/từ điển đi qua proxy cùng origin của Next.js.

`SPEAKING_AUTO_START=0` chỉ áp dụng cho terminal hiện tại, giúp chạy web khi chưa chuẩn bị mô hình Speaking. Khi đã cài mô hình theo [SPEAKING.md](SPEAKING.md), đặt `SPEAKING_TRAINING_ROOT` tới thư mục training có `.venv` và checkpoint, rồi bỏ biến trên bằng `Remove-Item Env:SPEAKING_AUTO_START -ErrorAction SilentlyContinue`. Lần chạy `npm run dev` tiếp theo sẽ tự kiểm tra/khởi động bộ chấm. Bỏ qua bộ chấm không ngăn giao diện chạy, nhưng chưa thể gửi bản ghi để chấm phát âm.

Mở [http://localhost:3000](http://localhost:3000). Frontend cũng cho phép địa chỉ local [http://127.0.0.1:3000](http://127.0.0.1:3000) trong Development; nên dùng nhất quán một địa chỉ khi đăng nhập vì cookie của hai hostname không dùng chung.

| Đường dẫn | Chức năng |
| --- | --- |
| `/` | Trang chủ |
| `/register` | Tạo tài khoản học viên |
| `/login` | Đăng nhập |
| `/account` | Tài khoản học viên, cần đăng nhập |
| `/courses` | Danh sách khóa học, cần đăng nhập |
| `/courses/create-ai` | Tạo khóa học cá nhân từ PDF/DOCX bằng Gemini, cần đăng nhập |
| `/courses/{courseId}` | Chi tiết khóa học và đường dẫn vào từng bài |
| `/courses/{courseId}/lessons/{lessonId}/reading` | Bài đọc có ảnh, câu hỏi và công cụ ghi chú |
| `/courses/{courseId}/flashcards` | Từ vựng Reading và bộ thẻ của khóa học |
| `/flashcards` | Thư viện bộ thẻ và ôn tập cá nhân |
| `/speaking` | Chọn bài luyện phát âm; gửi chấm cần mô hình Speaking |
| `/translation-practice` | Luyện phiên dịch Việt → Anh, cần đăng nhập và [nạp kho đề](backend/README.md#luyện-phiên-dịch) |
| `/admin/courses` | Quản trị khóa học, cần role `admin` |
| `/admin/courses/{courseId}/flashcards` | Admin tạo bộ thẻ hoặc lấy từ vựng Reading của khóa học |
| `/admin/ai-usage` | Admin xem lượt gọi, hạn mức và lỗi tạo khóa học AI |
| `/writing` | Công cụ gợi ý sửa bài Writing; cần backend và model run phù hợp |

Database mới chưa có tài khoản hoặc khóa học mẫu. Tạo học viên tại `/register`; để biên soạn nội dung, tạo admin ở bước tiếp theo rồi tạo/xuất bản khóa học. Trang chủ vẫn xem được khi backend chưa chạy, nhưng đăng ký/đăng nhập và dữ liệu học tập cần API/SQL Server hoạt động.

## 9. Tạo tài khoản quản trị

Sau khi cấu hình backend và chạy đủ schema SQL, mở thêm terminal tại thư mục gốc:

```powershell
.\backend\scripts\Initialize-Admin.ps1
.\backend\scripts\Initialize-Admin.ps1 -ShowCredentials
```

Email mặc định là `admin@linguaai.local`; mật khẩu được tạo ngẫu nhiên và lưu trong User Secrets của máy bạn. `-ShowCredentials` chỉ hiển thị thông tin đã lưu để bạn đăng nhập tại `/login`. Không có một mật khẩu admin chung được lấy từ GitHub.

Chạy lại script không tạo admin trùng hoặc tự reset mật khẩu. Đăng ký công khai luôn tạo role `user`, không tạo admin. Sau khi đăng nhập admin, mở `/admin/courses` để tạo và xuất bản khóa học.

## Sử dụng các tính năng mới

### Reading có ảnh và Sổ tay

Từ **Khóa học**, mở khóa học rồi chọn bài Reading. Hình trong bài có thể phóng to; nút **A− / A+** thay đổi cỡ chữ. Bản dịch đã được biên soạn được mở sau khi nộp bài, không tự dịch bằng AI.

Để đánh dấu, chọn **Tô sáng**, **Gạch chân** hoặc **Ghi chú**, chọn màu rồi kéo chọn đoạn tiếng Anh. **Sổ tay** liệt kê các đoạn đã đánh dấu, cho phép mở lại, sửa hoặc xóa ghi chú; có hoàn tác/làm lại. Chọn **Đọc** để quay về thao tác tra từ thông thường.

Ghi chú tự lưu **trên trình duyệt hiện tại**, tách theo tài khoản, bài học và phiên bản nội dung. Chúng chưa đồng bộ sang máy khác; xóa dữ liệu trình duyệt sẽ mất ghi chú. Khi nội dung bài đổi, ghi chú của phiên bản cũ không được áp lên văn bản mới. Đáp án chưa nộp chỉ giữ trong lần mở bài; bấm **Nộp bài & xem kết quả** để chấm và lưu kết quả vào tài khoản.

### Bộ thẻ từ vựng trong khóa học

- **Admin:** mở khóa trong trang quản trị → **Từ vựng & Flashcards**; tạo bộ thủ công hoặc lấy từ vựng đã lưu trong các bài Reading, sau đó chỉnh từ, nghĩa và câu ví dụ.
- **Học viên:** mở **Bộ thẻ từ vựng** trong chi tiết khóa học hoặc từ bài Reading. Nút mũi tên trái/phải chuyển thẻ; **nhấn đúp** trên thẻ để lật. Khi focus vào thẻ, có thể dùng **Enter** để lật; cũng có nút chọn mặt trước/mặt sau.
- Bộ từ Reading hiển thị từ nội dung đã biên soạn. Muốn có lịch ôn riêng, lưu bộ Reading hoặc tạo bản sao bộ của Admin vào thư viện cá nhân; thao tác ôn không sửa bộ gốc.

Nếu trang báo không tải được bộ thẻ hoặc backend báo `Invalid column name 'CourseId'`, kiểm tra script **005** đã chạy trên đúng database trong connection string, rồi tải lại trang.

### Tạo khóa học riêng từ tài liệu

1. Đăng nhập và mở **Tạo khóa học AI** tại `/courses/create-ai`.
2. Chọn PDF có văn bản hoặc DOCX, tối đa **10 MB**; PDF tối đa **30 trang**, văn bản trích xuất cần từ **100 đến 50.000 ký tự**. PDF scan cần được chuyển thành văn bản trước; hệ thống chưa có OCR.
3. Chọn mục tiêu, CEFR và 1–5 kỹ năng. **Số bài là số bài cho mỗi kỹ năng**: chọn 3 kỹ năng × 2 bài sẽ tạo 6 bài. Có thể đặt 3–5 câu luyện mỗi bài; Writing dùng đề viết và rubric.
4. Bấm **Tạo dàn ý khóa học**, kiểm tra và sửa tên, mô tả, tiêu đề/mục tiêu các bài trước khi xác nhận tạo nội dung.
5. Xem nội dung và audio nếu có, sau đó bấm **Lưu vào khóa học của tôi**. Khóa này thuộc tài khoản đã tạo; mở lại qua **Khóa học của tôi** hoặc bộ lọc nguồn khóa cá nhân.

**Lượt tạo gần đây** cho phép quay lại công việc đang làm. Bản thử giới hạn **3 yêu cầu tạo khóa mỗi tài khoản/ngày**; mặc định chỉ xử lý một lượt đang chạy cho mỗi tài khoản. Khi có lỗi, mở đúng lượt cũ và chọn **Thử lại từ bước đã lưu** thay vì tạo lại toàn bộ. Các bài đã hoàn tất được giữ để tiếp tục bước còn thiếu.

Nội dung AI được kiểm tra cấu trúc và có một lần yêu cầu sinh lại khi chưa hợp lệ. Nếu vẫn báo “Nội dung AI chưa đúng cấu trúc bài học”, dùng nút thử lại; Admin xem lỗi tại `/admin/ai-usage` và kiểm tra model/hạn mức. Đây là nội dung luyện tập do AI sinh, cần rà soát trước khi sử dụng.

## 10. Những lần chạy tiếp theo

Khởi động SQL Server và MongoDB nếu dùng từ điển, sau đó chạy lại hai terminal ở bước 7 và 8. Không cần tạo lại database, JWT hoặc admin mỗi lần mở dự án.

Để cập nhật từ GitHub, trước hết lưu các thay đổi riêng bằng commit hoặc stash. Từ thư mục gốc repository, khi đang ở nhánh `Viet` và không có thay đổi chưa lưu:

```powershell
git fetch origin
git switch Viet
git pull --ff-only origin Viet
dotnet restore EnglishLearningSystem.sln --locked-mode
npm --prefix frontend ci
```

Nếu clone cũ chưa có nhánh `Viet`, sau `git fetch origin`, dùng `git switch --track origin/Viet` thay cho `git switch Viet`. Nếu clone ban đầu chỉ lấy một nhánh khác bằng `--single-branch`, dùng `git remote set-branches --add origin Viet` trước khi fetch. `--ff-only` dừng khi lịch sử local và remote đã tách, để bạn xử lý thay đổi riêng trước.

**Nâng cấp database đã có:** nếu database mới có script 001–003, chạy tiếp 004 rồi 005. Nếu đã chạy 004, chỉ cần chạy 005. Dùng instance và tên database mà backend đang kết nối:

```powershell
$sqlServerInstance = '.\SQLEXPRESS'
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/004_add_translation_practice.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/005_link_flashcard_decks_to_courses.sql
```

Sau đó khởi động lại backend và frontend. API không tự chạy SQL; không xóa/tạo lại database chỉ để lấy giao diện hoặc tính năng mới. Giữ `.env.local`, User Secrets và các thư mục dữ liệu local. Ngoài SQL, tiến trình tạo khóa AI được lưu tại `backend/EnglishLearning.Api/App_Data/ai-courses/` (hoặc `CourseGeneration:DataRoot` đã cấu hình); cần giữ thư mục này nếu muốn tiếp tục các lượt cũ sau khi đổi máy/triển khai lại. Git không mang theo dữ liệu đó.

## 11. Kiểm tra build và test

Tại thư mục gốc:

```powershell
dotnet build EnglishLearningSystem.sln
dotnet test EnglishLearningSystem.sln --configuration Release
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend run test:ai-courses
npm --prefix frontend run test:reading
npm --prefix frontend run test:grammar
npm --prefix frontend run test:speaking
npm --prefix frontend run test:writing
npm run test:dev
```

Dừng `npm run dev` bằng `Ctrl+C` trước khi build frontend, rồi chạy lại dev nếu tiếp tục phát triển. Sau khi đổi `.env.local` hoặc cấu hình Next.js, khởi động lại frontend và tải lại trang.

Các integration test SQL/MongoDB cần cấu hình kiểm thử riêng; nhiều test sẽ được bỏ qua khi chưa đặt biến môi trường tương ứng. Xem [backend/README.md](backend/README.md) cho `ENGLISHLEARNING_TEST_CONNECTION_STRING`, `ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING` và các smoke test. Dùng database kiểm thử riêng.

Kiểm thử trình duyệt và yêu cầu Playwright được mô tả trong [frontend/README.md](frontend/README.md).

### Phạm vi kiểm thử

Các lệnh `test:ai-courses`, `test:reading`, `test:grammar`, `test:speaking` và `test:writing` trong frontend dùng unit/contract test; không tự tạo tài khoản hoặc gọi Gemini. Một số kiểm thử mô hình thật và SQL/MongoDB chỉ chạy khi có biến môi trường, dữ liệu và dịch vụ tương ứng; các ca chưa đủ điều kiện có thể được bỏ qua. Build thành công xác nhận mã biên dịch được, chưa xác nhận thông tin kết nối hoặc quyền gọi dịch vụ AI trên máy mới.

## 12. AI Writing (GEC/CEFR) — nghiên cứu tùy chọn

Tính năng Writing chạy qua ba thành phần local: trang Next.js `/writing`, API .NET và dịch vụ Python FastAPI tại `127.0.0.1:8000`. Dịch vụ Python dùng checkpoint đã huấn luyện; cài package không tự cung cấp checkpoint. Trang Writing là công cụ gợi ý sửa và phản hồi theo khả năng được bật, không phải chứng nhận CEFR/IELTS/TOEFL. Kết quả phụ thuộc dữ liệu, checkpoint và cấu hình local; cần tự xem xét trước khi áp dụng.

> **Cài đặt và chạy Writing trên máy mới (dành cho agent/người mới):** làm theo [docs/WRITING_SETUP_FOR_AGENTS.md](docs/WRITING_SETUP_FOR_AGENTS.md). Tài liệu này gồm thư viện đề, điểm bám đề, giải thích lỗi v2, kịch bản nghiệm thu và các quy tắc giấy phép.

### Quyền dữ liệu và mô hình

Pipeline có thể dùng Write & Improve Corpus 2024. Mỗi thành viên phải tự tải và chấp thuận giấy phép từ [Cambridge](https://researchdatasets.cambridge.org/datasets/write-and-improve-corpus-2024). Giấy phép chỉ cho nghiên cứu/giáo dục phi thương mại; không cung cấp corpus cho người khác hoặc đưa lên GitHub, kể cả khi họ cũng đã ký giấy phép. Điều 6 cho phép một ngoại lệ giới hạn đối với trích đoạn xuất bản dưới 100 từ. Cambridge yêu cầu xin chấp thuận trước khi phát hành mô hình hoặc thống kê dẫn xuất. Không commit corpus, dữ liệu chuẩn bị, predictions riêng tư, cache, checkpoint hoặc adapter vào Git; các đường dẫn dữ liệu/runtime tương ứng đã được ignore cục bộ. Không gửi learner text tới dịch vụ bên ngoài. Nếu định dùng trong sản phẩm/dịch vụ, cần giải quyết quyền sử dụng với Cambridge trước.

Model base và revision được pin trong `ai/writing/modeling.py`: `google/byt5-small` (`68377bdc18a2ffec8a0533fef03b1c513a4dd49d`) cho GEC và `microsoft/deberta-v3-base` (`8ccc9b6f36199bec6961081d44eb72fb3f7353f3`) cho CEFR. `Train-Expanded.ps1` đặt `HF_HUB_OFFLINE=1` trước khi chạy Python; launcher không tải model và sẽ lỗi nếu revision chưa có trong cache. Trước training, tải từng revision đúng vào cùng `HF_HOME` mà tiến trình training sẽ dùng. Mặc định `train.py` dùng `ai/writing/.cache/huggingface`; nếu đặt `HF_HOME` tùy chỉnh, hãy giữ nguyên giá trị đó cho cả bước tải và training:

```powershell
$python = '.\ai\writing\.venv\Scripts\python.exe'
$env:HF_HOME = Join-Path $PWD 'ai\writing\.cache\huggingface'
$env:HF_HUB_OFFLINE = '0'
& $python -c "from huggingface_hub import snapshot_download; print(snapshot_download(repo_id='google/byt5-small', revision='68377bdc18a2ffec8a0533fef03b1c513a4dd49d'))"
# Chỉ cần cho CEFR:
& $python -c "from huggingface_hub import snapshot_download; print(snapshot_download(repo_id='microsoft/deberta-v3-base', revision='8ccc9b6f36199bec6961081d44eb72fb3f7353f3'))"
```

Lệnh tải cần mạng và chỉ chuẩn bị base-model cache; không chạy model. Sau khi tải xong, có thể bật offline mode lại hoặc mở terminal mới. Service chạy offline và cũng cần base model cùng các adapter/checkpoint đã có sẵn. Không đưa base weights/checkpoint lên Git. Đọc [model card ByT5-small](https://huggingface.co/google/byt5-small) và [model card DeBERTa-v3-base](https://huggingface.co/microsoft/deberta-v3-base), kiểm tra giấy phép của revision trước khi dùng hoặc phân phối. Cài dependencies không tự tải corpus hay tạo adapter run.

Local feedback benchmark là tùy chọn và mặc định tắt. Nhánh không chứa essay fixture benchmark; các contract tests dùng fixture hư cấu được tạo tạm trong thư mục test. Muốn bật benchmark runtime, chỉ dùng bộ câu tự viết/được phép sử dụng ở máy cục bộ và truyền manifest/fixture riêng; không lấy nội dung Cambridge hoặc dữ liệu người học chưa được phép.

### Python environment và kiểm tra không huấn luyện

Windows PowerShell, từ thư mục gốc:

```powershell
py -3.11 --version
.\ai\writing\Install-Training.ps1
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\check_environment.py
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\train.py --help
.\ai\writing\.venv\Scripts\python.exe -m pip install -r .\ai\writing\requirements-service.txt -r .\ai\writing\requirements-evaluation.txt
.\ai\writing\.venv\Scripts\python.exe -B -m unittest discover -s .\ai\writing\tests -v
```

`Install-Training.ps1` lấy PyTorch 2.9.1 cho CUDA 12.6 và các bản pin trong `requirements.txt`; script có thể tải package từ mạng. Với kiểm thử CPU-only, dùng `-CpuOnly`, nhưng nó thay torch wheel trong environment local và không phù hợp huấn luyện GPU. Dùng environment `ai/writing/.venv` riêng, không dùng `.venv` của backend. `train.py --help` chỉ hiển thị tham số; nó không tải model hay huấn luyện.

Hai requirements bổ sung cài dependencies cho service và evaluator; `requirements-evaluation.txt` có model spaCy tiếng Anh cần cho một số test ERRANT. Nếu chỉ định huấn luyện, không cần cài các dependencies tùy chọn này.

`Train-Expanded.ps1` là GPU launcher: nó cần `nvidia-smi`, GPU compute-process query thành công và free VRAM tối thiểu thay đổi theo batch (900 MiB cho smoke; 1.600/2.200/3.000 MiB cho batch ≤4/≤8/>8). VRAM threshold không bảo đảm run sẽ vừa bộ nhớ. Mã Python trực tiếp có `--cpu`, nhưng CPU rất chậm và không qua các admission checks của PowerShell launcher; chỉ dùng cho kiểm tra nhỏ, tách riêng. `check_environment.py` báo CUDA, BF16, GPU và dung lượng đĩa nếu có; đây là preflight, không chứng minh một run sẽ thành công.

### Chuẩn bị dữ liệu và chạy thử

Đặt bản corpus đã được cấp phép trong thư mục local riêng, không thuộc Git. `data.py` nhận một ZIP hoặc thư mục đã giải nén giữ cấu trúc chính thức gồm `whole-corpus/en-writeandimprove2024-corpus.tsv` và các thư mục `user-prompt-first-versions/`, `user-prompt-final-versions/` chứa các cặp `.orig`, `.corr`, `.ids` theo split. Xác minh tùy chọn và schema bằng `data.py --help`; pipeline kiểm tra ID, version/split, căn hàng và hash. `Train-Expanded.ps1 -PrepareOnly` tạo `ai/writing/data/prepared-first-final/` với `gec-{train,dev,test}.jsonl`, `cefr-{train,dev,test}.jsonl` và `preparation-report.json`. JSONL giữ ID/provenance, source text, corrected text (GEC) hoặc human-final CEFR label; report giữ source/prepared hashes và số lượng theo split. Test GEC của corpus không có correction reference. Việc chuẩn bị vẫn đọc learner data và ghi derivative local; chỉ làm trên máy được phép lưu corpus.

Khi đã có dữ liệu và đã kiểm tra GPU/chi phí, ví dụ chạy GEC bằng cấu hình mặc định historical (6 epochs, batch 16, learning rate 2e-4, LoRA q/v) với tên run riêng:

```powershell
$source = Join-Path $env:USERPROFILE 'Downloads\write-and-improve-corpus-2024-v2'
.\ai\writing\Train-Expanded.ps1 -Source $source -ModelTask gec -PrepareOnly
.\ai\writing\Train-Expanded.ps1 -Source $source -ModelTask gec -RunName 'gec-team-local-01'
```

Đây là lệnh **huấn luyện thật**, có thể tốn nhiều giờ và GPU; không chạy như bước cài đặt thông thường. Dùng `Get-Help .\ai\writing\Train-Expanded.ps1 -Full` để yêu cầu trợ giúp PowerShell mà không chạy launcher, sau đó xác minh dữ liệu, quyền sử dụng, cache model, GPU và dung lượng. Script không có comment-based help block; nếu PowerShell chỉ hiện trợ giúp chung, xem tham số khai báo ở đầu file và phần này của README. Script tạo log dưới `ai/writing/.cache/training-launcher-logs/` và output/checkpoints dưới `ai/writing/artifacts/<run-name>/`; manifest ghi cấu hình, data/model hashes và metrics. GEC mặc định: 6 epochs, batch 16, LR `2e-4`, LoRA q/v. CEFR mặc định: 6 epochs, batch 8, LR `2e-4`. `-BatchSize`, `-Epochs`, `-LearningRate`, `-GecLoraProfile` cho phép thay đổi cấu hình; ghi lại lựa chọn để so sánh công bằng. `-Resume` chỉ dùng khi có checkpoint cùng run đầy đủ; nó khôi phục optimizer/scheduler/state. `-InitRun` khởi tạo adapter weights từ run khác nhưng dùng optimizer/run mới. Không đặt `-StopLocalAi` trừ khi chủ động chấp thuận dừng dịch vụ Writing đang chạy. Không truyền private path/essay vào log được chia sẻ.

`Train-VerifiedCorpus.ps1` là thí nghiệm riêng trên verified Unicode train profile, yêu cầu dữ liệu prepared tương ứng và mặc định khởi tạo từ `ai/writing/artifacts/gec-expanded-v1`; run nền tảng phải có trước hoặc truyền `-InitRun` hợp lệ. Không coi đây là lệnh bắt đầu sạch trên clone mới.

Nếu máy không có CUDA, có thể dùng `Install-Training.ps1 -CpuOnly` rồi gọi trực tiếp `train.py --cpu`; wrapper PowerShell `Train-Expanded.ps1` không hỗ trợ CPU training vì luôn kiểm tra GPU. Sau khi đã chạy bước `-PrepareOnly`, ví dụ smoke hai optimizer steps (không đánh giá chất lượng):

```powershell
$python = '.\ai\writing\.venv\Scripts\python.exe'
& $python .\ai\writing\train.py gec --train-file .\ai\writing\data\prepared-first-final\gec-train.jsonl --dev-file .\ai\writing\data\prepared-first-final\gec-dev.jsonl --preparation-report .\ai\writing\data\prepared-first-final\preparation-report.json --output .\ai\writing\artifacts\gec-cpu-smoke --cpu --epochs 1 --max-steps 2 --limit-train 16 --limit-dev 8
```

Lệnh này thực sự tải/khởi tạo base model và cập nhật adapter trên CPU; nó có thể chậm và chỉ để kiểm tra đường chạy. Không dùng `--max-steps` smoke như kết quả train hoặc chất lượng.

Với CEFR, cùng launcher dùng `-ModelTask cefr`; ví dụ sau cũng là **huấn luyện thật** và tạo run riêng:

```powershell
$source = Join-Path $env:USERPROFILE 'Downloads\write-and-improve-corpus-2024-v2'
.\ai\writing\Train-Expanded.ps1 -Source $source -ModelTask cefr -PrepareOnly
.\ai\writing\Train-Expanded.ps1 -Source $source -ModelTask cefr -RunName 'cefr-team-local-01'
```

### Phục vụ local và đánh giá

Cài dependency phục vụ riêng nếu cần bằng Python trong đúng environment: `ai/writing/.venv/Scripts/python.exe -m pip install -r ai/writing/requirements-service.txt`. Cả hai cách khởi động đọc mặc định GEC `gec-viet-full-18ep-bs2-ga8-20261111` từ `ai/writing/model-defaults.json`. CEFR mặc định là `cefr-my-first-run`, feedback mặc định tắt. Cần có artifacts local và base models trong HF cache trước khi khởi động. Model weights không đi kèm Git.

Với cả hai cách chạy, đặt `WRITING_CEFR_RUN` hoặc `WRITING_GEC_RUN` trước khi khởi động để trỏ đến run đã có. Dùng đường dẫn tuyệt đối nếu run nằm ngoài checkout và đặt `HF_HOME` nếu cache nằm ngoài `ai/writing/.cache/huggingface`. Để dùng lại baseline, đặt `$env:WRITING_GEC_RUN = 'artifacts/gec-expanded-v1'` hoặc truyền `-GecRun artifacts/gec-expanded-v1` khi chủ động chạy riêng `Start-Writing.ps1`. Bỏ override GEC để dùng lại mặc định mới. Kiểm tra `gecRun` ở `http://127.0.0.1:8000/health` và SHA adapter trong `provenance` của kết quả phân tích.

Để cài dependency evaluator, chạy `ai/writing/.venv/Scripts/python.exe -m pip install -r ai/writing/requirements-evaluation.txt`. Đánh giá GEC offline:

```powershell
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\evaluate_gec.py --run .\ai\writing\artifacts\gec-team-local-01 --output .\ai\writing\.cache\eval-gec-team-local-01 --device cuda
```

Nếu đã chuyển dữ liệu của run huấn luyện sang checkout hiện tại, chạy từ thư mục gốc và chỉ định thư mục prepared tương ứng:

```powershell
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\evaluate_gec.py --run .\ai\writing\artifacts\gec-viet-full-18ep-bs2-ga8-20261111 --data-root .\ai\writing\data\prepared-first-final --output .\ai\writing\.cache\eval-gec-local --device cpu
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\audit_gec.py --run .\ai\writing\artifacts\gec-viet-full-18ep-bs2-ga8-20261111 --data-root .\ai\writing\data\prepared-first-final --output .\ai\writing\.cache\audit-gec-local
```

Bỏ `--data-root` nếu các đường dẫn trong `run.json` vẫn dùng được. Khi có tham số, mỗi tên file train/dev ghi trong manifest phải xuất hiện đúng một lần dưới thư mục đã chọn và khớp SHA-256. Nếu thiếu file, kiểm tra đúng bộ prepared của run. Nếu trùng tên, chọn thư mục hẹp hơn. `--sample-file` vẫn yêu cầu xác minh dev gốc. Chế độ audit experiment dùng đường dẫn gốc để xác minh toàn bộ provenance. Khi dùng `--rescore`, điểm và M2 được ghi lại trong thư mục kết quả đã lưu.

Script lấy mẫu dev cân bằng (mặc định 128 câu mỗi nhóm), chạy inference và chấm edit bằng ERRANT. Đây là diagnostic sample, không phải toàn bộ dev hay test accuracy. Dùng thư mục output mới; predictions và report chứa dữ liệu dẫn xuất riêng tư. Corpus GEC chính thức không có test correction references nên pipeline không thể đưa ra test F-score đáng tin cậy từ corpus này. Các sample dev được dùng nhiều lần để tuning không phải holdout độc lập. Exact/reference-match không chứng minh chất lượng ngữ pháp tổng quát.

CEFR có hai cách kiểm tra tổng quát: single-input prediction bằng `predict.py --run ... --input <UTF-8-file> --output <new-private-json>`, hoặc final held-out evaluation chỉ sau khi đã khóa model/config bằng `--evaluate-test`. Ví dụ chỉ chạy một lần sau khi chọn model xong:

```powershell
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\predict.py --run .\ai\writing\artifacts\cefr-team-local-01 --evaluate-test --output .\ai\writing\.cache\eval-cefr-team-local-01.json
```

`--evaluate-test` chỉ hỗ trợ CEFR và nên dùng đúng một lần sau khi hoàn tất lựa chọn checkpoint; không xem lại điểm để tiếp tục tuning. `audit_cefr_model.py --help` cung cấp load audit và tùy chọn dev diagnostics; dev đã dùng để chọn checkpoint không phải holdout. Nhánh chỉ phát hành classifier sáu band; predictor 11 sublevel thử nghiệm bị loại vì cần model/evidence manifest mà workflow training hiện tại không tạo.

Để thử local inference qua service sau khi đã có adapter runs, cài dependency phục vụ, cấu hình run và khởi chạy:

```powershell
ai\writing\.venv\Scripts\python.exe -m pip install -r ai/writing/requirements-service.txt
.\ai\writing\Start-Writing.ps1 -CefrRun artifacts/cefr-team-local-01 -GecRun artifacts/gec-team-local-01 -Device auto
```

Trong terminal khác, kiểm tra health rồi gửi câu synthetic để gọi CEFR/GEC inference:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
$body = @{ text = 'The student are learning English.'; corrections = $true } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/internal/writing/analyze -Method Post -ContentType 'application/json' -Body $body
```

Service chỉ bind loopback; `/internal/writing/analyze` là API nội bộ local, không thay API .NET có xác thực. Dừng bằng `Ctrl+C`. POST thực hiện model inference; ví dụ chỉ gửi câu synthetic, không train hoặc ghi SQL.

Các model/checkpoint, dữ liệu, cache, báo cáo riêng và environment local nằm ngoài Git theo `.gitignore`. Trước khi chia sẻ kết quả hoặc artifact dẫn xuất, kiểm tra lại giấy phép corpus và quyền phát hành của model base.


## Lỗi thường gặp sau khi clone

| Hiện tượng | Kiểm tra/cách xử lý |
| --- | --- |
| Không tìm được .NET SDK phù hợp | Cài SDK đúng nhánh trong `global.json`, kiểm tra bằng `dotnet --list-sdks` |
| `sqlcmd` không được nhận diện | Cài công cụ vào `PATH`, hoặc chạy đủ 5 script SQL theo thứ tự bằng SSMS |
| SQL health trả `503`, đăng ký/đăng nhập lỗi | Kiểm tra instance SQL đang chạy, connection string trên máy mới và quyền của tài khoản kết nối |
| Lỗi cột `Role` hoặc không lưu được Grammar | Kiểm tra đã chạy script 002 và 003 trên đúng database |
| Bộ thẻ khóa học không tải được / `Invalid column name 'CourseId'` | Chạy script 005 trên database mà backend đang kết nối; database cũ đã có 001–004 chỉ cần bổ sung 005 |
| Lỗi `JwtOptions.SigningKey` | Chạy `Initialize-JwtSecret.ps1`; nếu đã có khóa sai/quá ngắn, sửa cấu hình trong User Secrets. Chạy backend bằng môi trường Development |
| Từ điển không lưu được dữ liệu | Kiểm tra MongoDB, URI/quyền truy cập và chạy `--initialize-vocabulary=true` trên đúng database |
| Upload/audio báo chưa cấu hình storage | Chạy `Set-CloudinarySecrets.ps1`, kiểm tra Cloudinary rồi khởi động lại API |
| Frontend báo không kết nối được API | Kiểm tra backend đang chạy và `API_BASE_URL`; sửa `.env.local` rồi khởi động lại Next.js |
| Next.js chặn dev resource khi dùng địa chỉ khác | Dùng `localhost:3000` hoặc `127.0.0.1:3000` đã được cấu hình; hostname khác cần khai báo cụ thể trong `allowedDevOrigins` rồi khởi động lại dev server |
| Danh sách khóa học trống | Database mới không tự có khóa học; đăng nhập admin, tạo nội dung hợp lệ và xuất bản |
| Trang tạo khóa học AI báo chưa khả dụng | Đặt `CourseGenerationAi:ApiKey` trong User Secrets của backend, kiểm tra model rồi khởi động lại API |
| Tạo khóa học có Listening báo chưa cấu hình media | Bật Cloudinary theo mục 6 và bảo đảm API key dùng được model TTS; hoặc bỏ chọn Listening |
| AI báo nội dung chưa đúng cấu trúc bài học | Mở lượt tạo cũ, chọn **Thử lại từ bước đã lưu**; kiểm tra model/lỗi trong `/admin/ai-usage` nếu lặp lại |
| Gemini báo hạn mức / dịch vụ bận | Chờ thời gian thử lại hiển thị; Admin kiểm tra hạn mức ứng dụng và tài khoản Gemini. Tạo lượt mới không giải quyết hạn mức |
| PDF không đọc được hoặc quá dài | Dùng PDF chọn được chữ hoặc DOCX; kiểm tra 10 MB, 30 trang PDF và 100–50.000 ký tự trích xuất |
| Ghi chú Reading không xuất hiện trên máy khác | Ghi chú lưu local theo trình duyệt/tài khoản/phiên bản bài, chưa có đồng bộ đa thiết bị |
| Frontend chờ Speaking hoặc không tìm thấy Python | Máy chưa cài bộ chấm: đặt `$env:SPEAKING_AUTO_START='0'` trước khi chạy npm. Muốn chấm thật, chuẩn bị mô hình và `SPEAKING_TRAINING_ROOT` theo `SPEAKING.md` |
| `Install-Training.ps1` không tìm thấy Python | Cài Python 3.11 x64 và Python Launcher (`py`), xác minh bằng `py -0p`; script tạo environment riêng dưới `ai/writing/.venv` |
| Thiếu base model/tokenizer hoặc checkpoint khi inference | Cài dependencies Python, chuẩn bị model base theo revision trong `modeling.py`, rồi chọn run có `run.json` hợp lệ; weights không được clone từ Git |
| Không tìm thấy corpus hoặc schema/cặp file sai | Đặt corpus được cấp phép ngoài repo đúng layout ở mục chuẩn bị dữ liệu; xem `data.py --help`; không dùng test split để huấn luyện |
| CUDA không khả dụng hoặc wheel không khớp | Chạy `check_environment.py`, xác minh driver tương thích với wheel cu126; CPU-only dùng `Install-Training.ps1 -CpuOnly` và gọi `train.py --cpu` trực tiếp |
| CUDA out of memory | Dừng run, kiểm tra batch/free VRAM; lần chạy mới có thể dùng `-BatchSize` nhỏ hơn nhưng là cấu hình khác. Không resume nếu batch/config không khớp |

## Tài liệu trong repository

- [Bàn giao AI Writing](docs/handoff-ai-writing/00_READ_ME_FIRST.md) hướng dẫn dựng môi trường, chẩn đoán GEC và đánh giá độ bám đề.

| Tài liệu/thư mục | Nội dung |
| --- | --- |
| [frontend/README.md](frontend/README.md) | Giao diện, các luồng sử dụng và kiểm thử frontend |
| [backend/README.md](backend/README.md) | API, cấu hình nâng cao, Cloudinary và integration test |
| [backend/database](backend/database) | Các script schema SQL chạy tường minh |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Thiết kế dữ liệu SQL Server |
| [MONGODB_SCHEMA.md](MONGODB_SCHEMA.md) | Collection và validator từ điển |
| [SPEAKING.md](SPEAKING.md) | Dịch vụ chấm Speaking, checkpoint và giới hạn kết quả |
| [ai/writing/requirements.txt](ai/writing/requirements.txt) | Dependencies Python cho huấn luyện |
