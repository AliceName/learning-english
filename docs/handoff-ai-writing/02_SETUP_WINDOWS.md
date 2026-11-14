# Dựng LinguaAI trên Windows

## Điều kiện và phiên bản

Máy bàn giao quan sát được Windows 11 build 26300, Node.js 24.15.0, npm 11.12.1, .NET SDK 9.0.319 với runtime ASP.NET 9.0.21, Python 3.11.9 x64 cho Writing. Next.js 16.4.2 cần Node.js từ 20.9 theo [README dự án](../../README.md). [global.json](../../global.json) yêu cầu SDK 9.0.307 và cho phép bản vá mới hơn cùng nhánh. Chuẩn bị Git, SQL Server, Windows Authentication hoặc thông tin SQL được cấp và `sqlcmd` hoặc SSMS. MongoDB hỗ trợ từ điển, Cloudinary hỗ trợ upload và media. Chúng là cấu hình phụ thuộc của những tính năng đó.

Venv Writing quan sát được PyTorch `2.9.1+cu126`, Transformers `4.57.3`, Tokenizers `0.22.2`, PEFT `0.17.1`, FastAPI `0.148.0`, Uvicorn `0.54.0`. Máy bàn giao có RTX 3050 Ti 4 GiB. GPU NVIDIA và driver phù hợp CUDA 12.6 cần cho wheel GPU. CPU là đường chạy cho smoke inference, với độ trễ cần đo trên máy đích. Dùng Python 3.11 cho Writing kể cả khi các thành phần Python khác dùng phiên bản khác.

## Clone và cài package

Cần quyền đọc remote GitHub. Nếu nhận URL khác từ nhóm, xác minh URL với [bản ghi bàn giao](11_GIT_HANDOFF_AND_RELEASE.md).

```powershell
git clone --branch Viet --single-branch https://github.com/AliceName/learning-english.git
Set-Location learning-english
git branch --show-current
git rev-parse HEAD
dotnet restore EnglishLearningSystem.sln --locked-mode
npm --prefix frontend ci
Copy-Item frontend/.env.example frontend/.env.local
```

Ví dụ copy chỉ dành cho checkout mới chưa có `.env.local`. Template đặt `API_BASE_URL=http://localhost:5000`, đọc phía server Next.js. Khi cần EF CLI, dùng `dotnet tool restore` theo manifest của repo. Database, User Secrets, cache, model weights, corpus và khóa của các nhà cung cấp cần cấp riêng. Cài package có thể cần mạng.

## Cấu hình SQL và đăng nhập

Đối chiếu [quy tắc database](../../DATABASE_RULES.md) và hướng dẫn [backend](../../backend/README.md). Chỉ chuẩn bị schema theo thứ tự `001`, `002`, `003` trên instance phát triển mới đã được nhóm duyệt. Script `001` chứa `USE master`, `CREATE DATABASE` và `USE EnglishLearningDB`. Nếu dùng catalog khác, DBA phải rà dựng schema đúng đích. Catalog ứng dụng đang có baseline riêng, xem [tình trạng SQL](08_DATABASE_AND_PENDING_WORK.md) trước mọi thao tác thay schema.

Trên instance mới đã được phép bootstrap, dùng danh tính triển khai và dừng nếu một lệnh lỗi. Ví dụ dưới đây chỉ áp dụng khi catalog khởi tạo được duyệt có tên `EnglishLearningDB`.

```powershell
$sqlServerInstance = '.\SQLEXPRESS' # Điền instance đã được cấp
sqlcmd -S $sqlServerInstance -d master -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
if ($LASTEXITCODE -ne 0) { throw 'SQL bootstrap 001 failed.' }
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
if ($LASTEXITCODE -ne 0) { throw 'SQL bootstrap 002 failed.' }
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/003_add_grammar_lesson_type.sql
if ($LASTEXITCODE -ne 0) { throw 'SQL bootstrap 003 failed.' }
```

Ví dụ cấu hình trên máy mới, cho tài khoản Windows đã có quyền tới catalog của máy đó.

```powershell
$sqlServerInstance = '.\SQLEXPRESS' # Điền instance đã được cấp
dotnet user-secrets set 'ConnectionStrings:DefaultConnection' "Server=$sqlServerInstance;Database=EnglishLearningDB;Trusted_Connection=True;TrustServerCertificate=True" --project backend/EnglishLearning.Api
.\backend\scripts\Initialize-JwtSecret.ps1
```

Trường hợp dùng SQL Authentication, nhập qua giao diện quản lý User Secrets hoặc kho secrets của môi trường. `TrustServerCertificate=True` trong ví dụ chỉ cho local. Giữ JWT và kết nối SQL ngoài Git và ngoài frontend. Backend Development có thể tự tạo signing key còn thiếu. Sau khi có DB phát triển được phép ghi, dùng `/register`, `/login` và `/account` qua cùng hostname. BFF giữ phiên bằng cookie và chuyển Bearer xuống ASP.NET. CORS Development và cấu hình frontend dành cho các hostname local. Khi đổi frontend origin, đối chiếu `Cors:AllowedOrigins` và [next.config.ts](../../frontend/next.config.ts) rồi khởi động lại đúng dịch vụ.

## Cài Python và nhận artifact

Từ repository root, dành môi trường riêng cho Writing. Script tạo `ai/writing/.venv` bằng `py -3.11 -m venv` nếu thiếu và cài torch cùng requirements đã pin. Chọn cài CPU cho máy mới muốn smoke trước. Bỏ `-CpuOnly` khi chuẩn bị venv mới để chạy GPU CUDA 12.6. Hai chế độ cài chỉnh torch wheel trong venv Writing, nên kiểm venv trước nếu đó là môi trường đang dùng.

```powershell
py -3.11 --version
.\ai\writing\Install-Training.ps1 -CpuOnly
$writingPython = '.\ai\writing\.venv\Scripts\python.exe'
& $writingPython -m pip install -r .\ai\writing\requirements-service.txt -r .\ai\writing\requirements-evaluation.txt
& $writingPython .\ai\writing\check_environment.py
```

Cần hai run `cefr-my-first-run` và `gec-viet-full-18ep-bs2-ga8-20261111` với manifest và adapter phù hợp cùng cache của base revisions đúng. [Danh mục artifact và checksum](09_ENV_MODELS_AND_ARTIFACTS.md) là bước bắt buộc trước khi nạp model. Nếu chưa có nơi chuyển giao artifact được nhóm duyệt, đánh dấu **BLOCKED** cho inference trên máy mới và chạy phần mềm/test không cần weights. Trình chạy đọc mặc định GEC từ [model-defaults.json](../../ai/writing/model-defaults.json). `WRITING_CEFR_RUN`, `WRITING_GEC_RUN` dùng khi cấu hình override theo cách khởi động, script trực tiếp nhận `-CefrRun`, `-GecRun`. Dùng đường dẫn tuyệt đối nếu nằm ngoài checkout. `HF_HOME` chỉ định cache ngoài nếu cần.

Thư viện đề tuỳ thuộc file `ai/writing/data/prompt-catalogue.v1.json` hoặc `WritingTasks__CataloguePath` trên Development. File có trên máy bàn giao và nằm ngoài Git. Metadata quan sát được là 50 mục với `reviewStatus=automated-reviewed-not-expert`. Contract yêu cầu version hash và unique ID. Khi nhóm chưa có snapshot hợp lệ được phép chuyển giao, dùng đề tự viết trong Writing.

## Khởi động ba dịch vụ

Dùng các terminal riêng ở repository root. Kiểm tra cổng 8000, 5000, 3000 trước. Nếu có dịch vụ đúng đang chạy, giữ và xác minh health, đừng khởi động instance trùng. Chọn một trong hai cách khởi động AI, tự chạy dưới đây hoặc để backend Development quản lý khi cổng 8000 trống.

```powershell
# Terminal AI. Chỉ chạy sau khi có artifact và cache.
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
.\ai\writing\Start-Writing.ps1 -Device cpu
```

Thay `cpu` bằng `auto` hoặc `cuda` khi đã kiểm CUDA và tài nguyên. Feedback Qwen mặc định tắt. Bật feedback cần artifact riêng và benchmark được duyệt theo quy trình của launcher.

```powershell
# Terminal backend, khi đã chạy AI riêng
$env:WritingAi__AutoStart = 'false'
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

```powershell
# Terminal frontend, chỉ cần Writing
$env:SPEAKING_AUTO_START = '0'
npm --prefix frontend run dev
```

Có thể dùng [Start-Dev.cmd](../../Start-Dev.cmd) nếu đã cấu hình tương ứng và các cổng đều trống. Mở `http://localhost:3000/writing` và `http://localhost:5000/swagger` trong Development. Check chỉ đọc:

```powershell
Invoke-RestMethod http://localhost:5000/api/v1/health
Invoke-RestMethod http://localhost:5000/api/v1/health/database
Invoke-RestMethod http://127.0.0.1:8000/health
```

Xác minh `cefrRun`, `gecRun`, `correctionsEnabled` và `feedbackStatus`. Có thể kiểm contract trực tiếp bằng một câu synthetic, không ghi SQL.

```powershell
$sample = @{ text = 'Yesterday I go to the library.'; corrections = $true } | ConvertTo-Json -Compress
Invoke-RestMethod http://127.0.0.1:8000/internal/writing/analyze -Method Post -ContentType 'application/json' -Body $sample
```

Chỉ coi đây là kiểm tra đường chạy và provenance, xem [protocol đánh giá](06_AI_EVALUATION_PROTOCOL.md) cho quality gate.

## Kiểm thử và xử lý lỗi

```powershell
Push-Location frontend
npm run lint
npm run test:writing
npm run test:speaking
npm run build
npx tsc --noEmit
Pop-Location

# Dùng process riêng chưa cấu hình hai biến SQL test.
dotnet build EnglishLearningSystem.sln -c Release
dotnet test backend/EnglishLearning.Api.Tests/EnglishLearning.Api.Tests.csproj -c Release --filter 'FullyQualifiedName~Writing|FullyQualifiedName~Flashcard'

.\ai\writing\.venv\Scripts\python.exe -B -m unittest discover -s .\ai\writing\tests -v
git diff --check
```

SQL tests ghi dữ liệu chỉ chạy theo [quy trình catalog riêng](08_DATABASE_AND_PENDING_WORK.md). Playwright hoặc test live đòi fixture và service cụ thể, lưu bằng chứng không chứa dữ liệu cá nhân.

- `dotnet` báo SDK không tương thích. Cài SDK đúng feature band của `global.json`; xem `dotnet --list-sdks`.
- Build backend báo apphost đang bị khóa. Dùng `dotnet test --artifacts-path <thư-mục-build-riêng>` khi cần chạy test bên cạnh service.
- Cổng bị chiếm hoặc health trả sai model. Kiểm tra tiến trình sở hữu cổng và biến override. Không đổi ngầm checkpoint để vượt kiểm tra.
- Artifact/cache thiếu hoặc không đúng revision. So với danh mục và nguồn đã được cấp, giữ offline khi xác minh và báo chính xác dependency thiếu.
- CUDA lỗi. Kiểm `nvidia-smi`, `torch.cuda.is_available()` và wheel. CPU cho smoke phù hợp, không dùng kết quả độ trễ CPU thay cho GPU.
- Health DB lỗi. Kiểm tra instance/catalog, quyền Windows và cấu hình User Secrets. Đừng chạy update hoặc seed tự động.
- API Running nhưng Writing báo AI unavailable. Kiểm health 8000, log API và URL cấu hình `WritingAi:BaseUrl`. Với lỗi thư viện đề 503, kiểm Development và file catalogue; đề riêng là luồng độc lập.
