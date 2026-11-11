

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
git switch --track origin/Viet

dotnet restore EnglishLearningSystem.sln --locked-mode
dotnet tool restore
npm --prefix frontend ci
```

`npm ci` sử dụng `frontend/package-lock.json`; không cần cài từng package thủ công. `dotnet tool restore` cài các công cụ trong `.config/dotnet-tools.json`, không tự tạo database.

Lệnh `git switch --track origin/Viet` dùng sau khi nhánh `Viet` đã được chủ repo publish; hiện nhánh này chưa được push. Nếu bạn clone sau khi nhánh đã có trên GitHub, lệnh trên checkout nhánh nhóm thay vì `main`.

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
npm --prefix frontend run test:writing
npm run test:dev
```

Dừng `npm run dev` bằng `Ctrl+C` trước khi build frontend, rồi chạy lại dev nếu tiếp tục phát triển. Sau khi đổi `.env.local` hoặc cấu hình Next.js, khởi động lại frontend và tải lại trang.

Các integration test SQL/MongoDB cần cấu hình kiểm thử riêng; nhiều test sẽ được bỏ qua khi chưa đặt biến môi trường tương ứng. Xem [backend/README.md](backend/README.md) cho `ENGLISHLEARNING_TEST_CONNECTION_STRING`, `ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING` và các smoke test. Dùng database kiểm thử riêng.

Kiểm thử trình duyệt và yêu cầu Playwright được mô tả trong [frontend/README.md](frontend/README.md).

### Kết quả kiểm chứng của bản bàn giao 2026-11-11

| Lệnh/phạm vi | Kết quả trên worktree `Viet` | Giới hạn |
| --- | --- | --- |
| `npm --prefix frontend run test:writing` | 61 passed | Mock/local tests, không gọi backend thật |
| `npm run test:dev` | 6 passed | Dùng tiến trình giả lập cho launcher |
| `npm --prefix frontend run lint` và `npm --prefix frontend run build` | Cả hai passed; `/writing` có trong build | Build không khởi chạy ứng dụng |
| `dotnet test EnglishLearningSystem.sln --configuration Release --no-restore` | 354 passed, 78 skipped, 0 failed | Skips gồm SQL/MongoDB/live-model prerequisites; chưa xác minh integration trên máy thành viên |
| Python unit tests cho bộ file dự kiến commit | 181 passed, 2 skipped, 0 failed | Python 3.11.9; dùng service dependencies ở overlay tạm; hai skip cần ERRANT và model spaCy evaluator |
| `pip check`, Python AST, `train.py/data.py/predict.py/evaluate_gec.py --help` | Passed | Chỉ kiểm dependency, syntax và CLI parsing |
| `npm ci` | Cài thành công; npm báo 7 moderate vulnerabilities | Chưa chạy `npm audit fix`; không tự nâng cấp dependency |

Trong lần kiểm chứng này chưa chạy database/app services, corpus preparation trên dữ liệu thật, model load/inference, đánh giá corpus, hay full training. Các lệnh CLI `--help` đã chạy; lệnh huấn luyện/đánh giá trong các mục dưới đây chỉ là hướng dẫn, chưa được thực thi ở lần bàn giao này.

## 12. AI Writing (GEC/CEFR) — nghiên cứu tùy chọn

Tính năng Writing chạy qua ba thành phần local: trang Next.js `/writing`, API .NET và dịch vụ Python FastAPI tại `127.0.0.1:8000`. Dịch vụ Python dùng checkpoint đã huấn luyện; cài package không tự cung cấp checkpoint. Trang Writing là công cụ gợi ý sửa và phản hồi theo khả năng được bật, không phải chứng nhận CEFR/IELTS/TOEFL. Kết quả phụ thuộc dữ liệu, checkpoint và cấu hình local; cần tự xem xét trước khi áp dụng.

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

Cài dependency phục vụ riêng nếu cần bằng Python trong đúng environment: `ai/writing/.venv/Scripts/python.exe -m pip install -r ai/writing/requirements-service.txt`. Khởi chạy AI service bằng `ai/writing/Start-Writing.ps1`; mặc định feedback model tắt và GEC run không đặt. Cấu hình CEFR/GEC bằng tên thư mục run đã có trong `ai/writing/artifacts/`. Có thể chạy ba dịch vụ cùng lúc bằng `Start-Dev.cmd`, nhưng script cần checkpoint CEFR `cefr-my-first-run`, GEC `gec-expanded-v1`, Python environment và dependencies của backend/frontend. Nếu chưa có các run đó, dùng các lệnh khởi chạy riêng và chọn model có sẵn.

Để cài dependency evaluator, chạy `ai/writing/.venv/Scripts/python.exe -m pip install -r ai/writing/requirements-evaluation.txt`. Đánh giá GEC offline:

```powershell
.\ai\writing\.venv\Scripts\python.exe .\ai\writing\evaluate_gec.py --run .\ai\writing\artifacts\gec-team-local-01 --output .\ai\writing\.cache\eval-gec-team-local-01 --device cuda
```

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
| `sqlcmd` không được nhận diện | Cài công cụ vào `PATH`, hoặc chạy 3 script SQL bằng SSMS |
| SQL health trả `503`, đăng ký/đăng nhập lỗi | Kiểm tra instance SQL đang chạy, connection string trên máy mới và quyền của tài khoản kết nối |
| Lỗi cột `Role` hoặc không lưu được Grammar | Kiểm tra đã chạy script 002 và 003 trên đúng database |
| Lỗi `JwtOptions.SigningKey` | Chạy `Initialize-JwtSecret.ps1`; nếu đã có khóa sai/quá ngắn, sửa cấu hình trong User Secrets. Chạy backend bằng môi trường Development |
| Từ điển không lưu được dữ liệu | Kiểm tra MongoDB, URI/quyền truy cập và chạy `--initialize-vocabulary=true` trên đúng database |
| Upload/audio báo chưa cấu hình storage | Chạy `Set-CloudinarySecrets.ps1`, kiểm tra Cloudinary rồi khởi động lại API |
| Frontend báo không kết nối được API | Kiểm tra backend đang chạy và `API_BASE_URL`; sửa `.env.local` rồi khởi động lại Next.js |
| Next.js chặn dev resource khi dùng địa chỉ khác | Dùng `localhost:3000` hoặc `127.0.0.1:3000` đã được cấu hình; hostname khác cần khai báo cụ thể trong `allowedDevOrigins` rồi khởi động lại dev server |
| Danh sách khóa học trống | Database mới không tự có khóa học; đăng nhập admin, tạo nội dung hợp lệ và xuất bản |
| `Install-Training.ps1` không tìm thấy Python | Cài Python 3.11 x64 và Python Launcher (`py`), xác minh bằng `py -0p`; script tạo environment riêng dưới `ai/writing/.venv` |
| Thiếu base model/tokenizer hoặc checkpoint khi inference | Cài dependencies Python, chuẩn bị model base theo revision trong `modeling.py`, rồi chọn run có `run.json` hợp lệ; weights không được clone từ Git |
| Không tìm thấy corpus hoặc schema/cặp file sai | Đặt corpus được cấp phép ngoài repo đúng layout ở mục chuẩn bị dữ liệu; xem `data.py --help`; không dùng test split để huấn luyện |
| CUDA không khả dụng hoặc wheel không khớp | Chạy `check_environment.py`, xác minh driver tương thích với wheel cu126; CPU-only dùng `Install-Training.ps1 -CpuOnly` và gọi `train.py --cpu` trực tiếp |
| CUDA out of memory | Dừng run, kiểm tra batch/free VRAM; lần chạy mới có thể dùng `-BatchSize` nhỏ hơn nhưng là cấu hình khác. Không resume nếu batch/config không khớp |

## Tài liệu trong repository

| Tài liệu/thư mục | Nội dung |
| --- | --- |
| [frontend/README.md](frontend/README.md) | Giao diện, các luồng sử dụng và kiểm thử frontend |
| [backend/README.md](backend/README.md) | API, cấu hình nâng cao, Cloudinary và integration test |
| [backend/database](backend/database) | Các script schema SQL chạy tường minh |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Thiết kế dữ liệu SQL Server |
| [MONGODB_SCHEMA.md](MONGODB_SCHEMA.md) | Collection và validator từ điển |
| [ai/writing/requirements.txt](ai/writing/requirements.txt) | Dependencies Python cho huấn luyện |
