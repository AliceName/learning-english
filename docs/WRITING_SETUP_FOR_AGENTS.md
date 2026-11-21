# LEWA Writing — hướng dẫn cài đặt và chạy cho agent

Tài liệu này dành cho agent (Claude Code, Codex, …) hoặc người mới lấy code nhánh `Viet` về và cần **chạy được tính năng Writing** trên máy Windows của họ. Làm đúng thứ tự từ trên xuống. Mỗi bước có lệnh kiểm tra; chỉ sang bước tiếp theo khi bước trước đạt.

> Nguyên tắc bắt buộc cho agent: đọc mục [Quy tắc không được vi phạm](#9-quy-tắc-không-được-vi-phạm) trước khi chạy bất kỳ lệnh nào có ghi dữ liệu, tải file hoặc commit.

## 1. Tính năng Writing gồm những gì

Trang `/writing` là một vòng luyện viết theo kiểu Cambridge Write & Improve:

| Tính năng | Người học thấy gì | Thành phần |
|---|---|---|
| Thư viện 50 đề | Lọc theo trình độ, dạng bài, chủ đề; đề hiển thị thành danh sách ý; khung "Trước khi nộp, tự hỏi" | `build_prompt_catalogue.py` dựng `ai/writing/data/prompt-catalogue.v1.json` (không có trong Git) |
| Ước lượng CEFR | Mức A1–C2 của bài viết | Adapter DeBERTa `cefr-my-first-run` |
| Gợi ý sửa lỗi (bật mặc định) | Câu tô **vàng**, từ gạch chân, mỗi lượt chỉ hiện 3 (Beginner) hoặc 5 gợi ý | Adapter ByT5 `gec-viet-full-18ep-bs2-ga8-20261111` + lớp an toàn gec-safety-v4 |
| Giải thích "vì sao" | Nút **?** ở mỗi câu tô màu; loại lỗi bằng tiếng Việt, không lộ đáp án; gợi ý ngữ pháp và chính tả/dấu câu ẩn đáp án để người học tự sửa trước | `writing_explanations.py` (luật v1 + ERRANT v2, cần `errant` và `en_core_web_sm`) |
| Trạng thái câu | Vàng = cần xem · gạch chéo xanh = đã sửa, chờ nộp lại · viền chấm = bỏ qua · **xanh lá = đã cải thiện** sau khi nộp lại | Frontend `writing-practice.ts` |
| Điểm bám đề 0–5 | Thang 0–5, cảnh báo khi lạc đề, ✓/? cho từng ý của đề kèm câu bằng chứng | `relevance.py` + MiniLM + ngưỡng `ai/writing/config/relevance-minilm-v1.json` (tự tạo, không có trong Git) |
| Tiến bộ | Thẻ "So với phiên bản trước", biểu đồ CEFR theo các lần nộp | Frontend |
| Streak | Lịch học và số ngày liên tiếp | Bảng `UserLearningDays` (script SQL 006) |

Kiến trúc: trình duyệt → Next.js `frontend` (cổng 3000) → API .NET `backend` (cổng 5000) → dịch vụ AI Python FastAPI `ai/writing/serve.py` (cổng 8000, chỉ nghe `127.0.0.1`). Mọi model chạy trên máy; không có bài viết nào bị gửi ra ngoài.

## 2. Yêu cầu máy

| Thành phần | Phiên bản đã kiểm tra | Kiểm tra |
|---|---|---|
| Windows 10/11, PowerShell | — | — |
| Python | **3.11** (3.11.9) | `py -3.11 --version` |
| .NET SDK | 9.0 (9.0.319) | `dotnet --version` |
| Node.js + npm | ≥ 20.9 (đã chạy với 24.15) | `node --version` |
| SQL Server (local hoặc Express) | bất kỳ bản hỗ trợ `sqlcmd` | `sqlcmd -?` |
| GPU NVIDIA | không bắt buộc; CPU chạy được (chậm hơn) | `nvidia-smi` |
| Ổ đĩa trống | khoảng 8 GB (venv + model gốc + node_modules) | — |

## 3. Lấy code

```powershell
git clone <url-repo> learning-english
cd learning-english
git checkout Viet
```

Từ đây mọi lệnh đều chạy từ **thư mục gốc repo**, trừ khi ghi khác.

## 4. Dịch vụ AI (Python)

### 4.1 Tạo môi trường và cài thư viện

```powershell
py -3.11 -m venv .\ai\writing\.venv
.\ai\writing\Install-Training.ps1            # cài torch 2.9.1 (CUDA 12.6) + requirements.txt
# Máy không có GPU NVIDIA: dùng bản CPU thay cho lệnh trên
# .\ai\writing\Install-Training.ps1 -CpuOnly
.\ai\writing\.venv\Scripts\python.exe -m pip install -r .\ai\writing\requirements-service.txt
```

`requirements-service.txt` đã gồm `errant==3.0.2` và model spaCy `en_core_web_sm` (tải từ GitHub của spaCy). Thiếu hai thứ này thì service vẫn chạy, nhưng giải thích lỗi lùi về v1 và đa số gợi ý mất phần "vì sao"; `/health` khi đó báo `"explanations": "v1-only …"`.

### 4.2 Tải model gốc công khai (đã ghim revision)

```powershell
cd .\ai\writing
.\.venv\Scripts\python.exe download_base_models.py
cd ..\..
```

Tải vào `ai/writing/.cache/huggingface` (không có trong Git):

| Model | Vai trò | Giấy phép | Dung lượng |
|---|---|---|---|
| `microsoft/deberta-v3-base` @ `8ccc9b6f` | gốc của CEFR | MIT | ~0,7 GB |
| `google/byt5-small` @ `68377bdc` | gốc của GEC | Apache-2.0 | ~1,2 GB |
| `sentence-transformers/all-MiniLM-L6-v2` @ `1110a243` | điểm bám đề | Apache-2.0 | ~92 MB |

### 4.3 Adapter đã huấn luyện (lấy từ người giữ, không có trên Git)

Hai adapter được train trên dữ liệu Cambridge W&I nên **không được đưa lên Git hay dịch vụ công khai**. Xin chủ repo (custodian) gói `lewa-writing-adapters.zip` qua kênh có kiểm soát quyền truy cập.

- Chủ repo tạo gói: `cd ai\writing; .\.venv\Scripts\python.exe package_adapters.py pack --output ..\..\lewa-writing-adapters.zip`
- Người nhận giải nén (script kiểm SHA từng file, không ghi đè file khác nội dung):

```powershell
cd .\ai\writing
.\.venv\Scripts\python.exe package_adapters.py unpack --input C:\duong-dan\lewa-writing-adapters.zip
cd ..\..
```

Kết quả: `ai/writing/artifacts/cefr-my-first-run/` và `ai/writing/artifacts/gec-viet-full-18ep-bs2-ga8-20261111/`, mỗi thư mục có `run.json` và `best/`. **Không sửa `ai/writing/model-defaults.json`.**

### 4.4 Thư viện đề và ngưỡng bám đề (cần W&I corpus của chính bạn)

Cả hai được dựng từ **Cambridge Write & Improve Corpus 2024 v2**. Mỗi người phải tự đăng ký, chấp thuận giấy phép phi thương mại và tải từ [Cambridge](https://researchdatasets.cambridge.org/datasets/write-and-improve-corpus-2024). Không chép corpus của người khác, không đưa corpus hay file dựng ra lên Git.

Giả sử corpus được giải nén vào `C:\data\write-and-improve-corpus-2024-v2`:

```powershell
cd .\ai\writing
# Thư viện 50 đề -> ai/writing/data/prompt-catalogue.v1.json
.\.venv\Scripts\python.exe build_prompt_catalogue.py --source C:\data\write-and-improve-corpus-2024-v2\whole-corpus\en-writeandimprove2024-prompts-info.tsv
# Ngưỡng bám đề -> ai/writing/config/relevance-minilm-v1.json  (CPU: vài phút; có GPU thì --device cuda)
.\.venv\Scripts\python.exe calibrate_relevance.py --corpus C:\data\write-and-improve-corpus-2024-v2\whole-corpus --output .\artifacts\relevance-minilm-v1 --device cpu
cd ..\..
```

- `build_prompt_catalogue.py` in `"expectedSource": true` và `catalogueSha256` = `d2a57c6f…` nếu bản corpus giống bản LEWA dùng. Khi đó ID và phiên bản đề trùng với mọi máy khác.
- `calibrate_relevance.py` in các tỉ lệ trên split test/dev. Kết quả tham chiếu trên máy chủ repo: bài đúng đề bị báo lạc đề 1,6% (test), bài lạc đề rõ ràng được phát hiện 90,3%. Nếu thư mục `--output` đã tồn tại thì đổi tên thư mục khác.
- Không có corpus thì Writing vẫn chạy với **đề tự đặt**, nhưng không có thư viện đề và **không có điểm bám đề**.

### 4.5 Kiểm tra toàn bộ phần AI

```powershell
cd .\ai\writing
.\.venv\Scripts\python.exe check_writing_setup.py
cd ..\..
```

Kết quả mong đợi: `21/21 checks passed.`, exit code 0. Mục nào `MISSING` đều có dòng `fix:` kèm lệnh sửa. `OPTIONAL` nghĩa là chạy được nhưng thiếu một phần tính năng.

## 5. Database và backend (.NET)

### 5.1 Chuỗi kết nối (không sửa file trong Git)

`backend/EnglishLearning.Api/appsettings.Development.json` đang trỏ tới SQL Server của một máy cụ thể. Đặt chuỗi kết nối của bạn bằng User Secrets, áp dụng riêng cho máy bạn:

```powershell
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=.\SQLEXPRESS;Database=EnglishLearningDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True" --project backend/EnglishLearning.Api
```

Khóa JWT cho môi trường Development được tự sinh và lưu trong User Secrets ở lần chạy đầu; không cần cấu hình.

### 5.2 Tạo database (chỉ trên database của bạn)

Chạy **đủ 6 script theo thứ tự**, script sau chỉ chạy khi script trước thành công (xem thêm README gốc):

```powershell
$sqlServerInstance = '.\SQLEXPRESS'
sqlcmd -S $sqlServerInstance -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/003_add_grammar_lesson_type.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/004_add_translation_practice.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/005_link_flashcard_decks_to_courses.sql
sqlcmd -S $sqlServerInstance -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/006_add_learning_activity.sql
```

Script 006 tạo bảng `UserLearningDays` cho streak. Script chỉ thêm bảng nếu chưa có và chạy lại an toàn. Thiếu bảng này thì ghi nhận hoạt động học sẽ lỗi. Agent **chỉ chạy các script này khi người dùng đồng ý** và trên database của chính họ; không xóa hoặc reset database có sẵn, không sửa `__EFMigrationsHistory`.

Tính năng bám đề **không đổi schema**: kết quả nằm trong JSON phân tích (`WritingSubmissions.ErrorsJson.relevance`).

## 6. Frontend

```powershell
npm --prefix frontend install
```

## 7. Chạy cả hệ thống

Mở 3 terminal ở thư mục gốc repo.

```powershell
# Terminal 1 — AI (CPU; có GPU thì -Device cuda)
$env:HF_HUB_OFFLINE = '1'; $env:TRANSFORMERS_OFFLINE = '1'
.\ai\writing\Start-Writing.ps1 -Device cpu
```

```powershell
# Terminal 2 — backend
$env:WritingAi__AutoStart = 'false'
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

```powershell
# Terminal 3 — frontend
$env:SPEAKING_AUTO_START = '0'
npm --prefix frontend run dev
```

Agent dùng Claude Code desktop có thể dùng `.claude/launch.json` (ba cấu hình `writing-ai-cpu`, `backend`, `frontend`).

### Kiểm tra nhanh

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Mong đợi: `status=ready`, `correctionsEnabled=True`, `explanations=v2-errant`, `relevanceEnabled=True`, `cefrRun=cefr-my-first-run`, `gecRun=gec-viet-full-18ep-bs2-ga8-20261111`.

Mở `http://localhost:3000`, tạo tài khoản rồi đăng nhập, vào `/writing`.

### Kịch bản nghiệm thu (5 phút)

1. Chọn một đề **Beginner**, ví dụ "Chuyến đi cùng lớp". Đề hiện thành danh sách ý; cột phải có khung "Trước khi nộp, tự hỏi"; ô "Gợi ý sửa lỗi ngữ pháp" đã được tích sẵn.
2. Viết khoảng 80 từ có lỗi cố ý (*I go… we was… She live…*), rồi bấm **Nộp để nhận phản hồi**. Trên CPU mất khoảng 7–10 giây.
3. Kiểm tra kết quả:
   - khối đầu trang hiện CEFR, số câu có gợi ý và thẻ **Bám đề x/5**;
   - câu có lỗi được tô vàng; mỗi lượt chỉ hiện 3 gợi ý;
   - bấm **?** ở một câu sẽ ra loại lỗi bằng tiếng Việt, không lộ đáp án;
   - với gợi ý ngữ pháp, đáp án bị ẩn cho đến khi bấm "Xem đáp án".
4. Bấm "Đã tự sửa" ở một gợi ý: câu đó chuyển sang gạch chéo xanh. Bấm "Bỏ qua" ở gợi ý khác: câu có viền chấm.
5. Bấm **Sửa bài này**, sửa vài câu, rồi bấm **Nộp lại bài viết**. Câu đã sửa và không còn gợi ý chuyển xanh lá; thẻ "So với phiên bản 1" xuất hiện.
6. Nộp một bài lạc đề hoàn toàn (ví dụ về tái chế rác) cho cùng đề: kết quả **0/5** kèm cảnh báo đỏ.

## 8. Kiểm thử

```powershell
.\ai\writing\.venv\Scripts\python.exe -B -m unittest discover -s .\ai\writing\tests        # ~309 test, OK
dotnet test backend/EnglishLearning.Api.Tests --filter "FullyQualifiedName~Writing|FullyQualifiedName~LearningActivity|FullyQualifiedName~SchemaModel"
npm --prefix frontend run test:writing                                                       # 90 test
Push-Location frontend; npx tsc --noEmit -p .; npx eslint src/app/writing src/lib; Pop-Location
```

Các test tích hợp SQL Server (`SqlServerFact`) mặc định bị **skip**. Muốn chạy thì phải có một database **dùng xong bỏ, đã được người dùng cho phép**, rồi đặt `ENGLISHLEARNING_TEST_CONNECTION_STRING` và `ENGLISHLEARNING_TEST_DATABASE`. Không trỏ các biến này tới database thật.

## 9. Quy tắc không được vi phạm

- **Không commit hoặc chia sẻ:**
  - W&I corpus và mọi file dựng từ nó: `ai/writing/data/`, `ai/writing/config/relevance-*.json`, `ai/writing/artifacts/`;
  - cache model, adapter;
  - bài viết của người học.

  Cambridge yêu cầu xin phép trước khi công bố mô hình hoặc thống kê dẫn xuất.
- Không gửi bài viết tới AI bên ngoài (Gemini, OpenAI, …). Mọi chấm điểm đều chạy trên máy.
- Không sửa `ai/writing/model-defaults.json`, không thay adapter đang phục vụ, không train lại khi chưa được duyệt.
- Không đổi schema hoặc tự chạy SQL ngoài các script 001–006 khi chưa được người dùng cho phép.
- Mỗi lần tải file đều phải nêu rõ tên file, nguồn và dung lượng, và chờ người dùng đồng ý.
- Không thêm dòng ghi tác giả AI (Co-authored-by, "Generated with …") vào commit hay README của dự án này.

## 10. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `/health` báo `explanations: v1-only` | thiếu `errant` hoặc `en_core_web_sm` | cài lại `requirements-service.txt` (mục 4.1) |
| `relevanceEnabled: false`, kết quả ghi "Chưa chấm được độ bám đề" | thiếu `ai/writing/config/relevance-minilm-v1.json` hoặc MiniLM | mục 4.2 và 4.4 |
| `/writing` không có đề nào, chỉ có "đề riêng" | chưa dựng catalogue, hoặc backend không chạy ở Development | mục 4.4; chạy với `--launch-profile http` |
| Đăng nhập lại sau mỗi lần khởi động lại backend | phiên làm mới (refresh session) chỉ lưu trong bộ nhớ backend (`RefreshSessions`); đây là thiết kế có chủ đích | đăng nhập lại; muốn giữ phiên phải lưu phiên vào database (đổi schema, cần duyệt) |
| Nộp bài chờ lâu hoặc hết giờ | GEC trên CPU khoảng 7–8 giây cho 8 câu; lần đầu chậm hơn vì nạp ERRANT và MiniLM | dùng `-Device cuda`, hoặc chờ lần đầu |
| `check_writing_setup.py` báo adapter "SHA differs" | gói adapter sai hoặc bị hỏng | xin lại gói; không tự sửa file |
| Port 8000/5000/3000 đã bị dùng | tiến trình cũ còn chạy | dừng tiến trình đó (`Get-NetTCPConnection -LocalPort 8000`) |

## 11. Giới hạn đã biết (cần ghi khi báo cáo, không phải lỗi cài đặt)

- **GEC sửa thừa:** ví dụ *thank → Thank*, *funny → fun*. Trên toàn bộ dev, tỉ lệ sửa thừa ở câu đúng là 18,6%. Chưa có tín hiệu độ chắc chắn để lọc.
- **Kiểm "đủ ý" trong điểm bám đề còn nhiễu:** ý chung chung như "say what you did" có thể không được nhận ra, nên giao diện dùng "?" thay vì ✗. Khoảng 10% bài đúng đề được 1 điểm. Phần này chưa có nhãn của giáo viên để đối chiếu.
- **Giải thích v2 có thể mô tả một đề xuất sai:** khi model sửa thừa, lời giải thích vẫn "hợp lý". Các mẫu tiếng Việt chưa có người duyệt chuyên môn.
- **Điểm bám đề chỉ có cho 50 đề thư viện** (ngưỡng hiệu chỉnh trên đúng các đề này); đề tự đặt hiện "Chưa đánh giá".
- **Catalogue chỉ mở ở môi trường Development** (`WritingTaskCatalogue`), vì nội dung đề thuộc giấy phép W&I phi thương mại. Muốn chạy ngoài Development phải tự soạn bộ đề mới.

## 12. Bản đồ file của tính năng

| Lớp | File |
|---|---|
| AI service | `ai/writing/serve.py` (`/internal/writing/analyze`, `/relevance`, `/health`), `inference.py`, `writing_explanations.py`, `relevance.py` |
| Công cụ cài đặt | `ai/writing/check_writing_setup.py`, `download_base_models.py`, `package_adapters.py`, `build_prompt_catalogue.py`, `calibrate_relevance.py` |
| Backend | `Controllers/WritingController.cs`, `Services/WritingAiClient.cs` (`RelevanceAsync`), `Contracts/WritingContracts.cs` (`WritingRelevance`), `Services/WritingTaskCatalogue.cs`, `Services/LearningActivityService.cs` |
| Frontend | `src/app/writing/writing-form.tsx`, `writing-comparison.tsx` (tô màu câu, tổng kết, bám đề), `writing-practice-panels.tsx`, `writing-history.tsx`; `src/lib/writing-practice.ts` (chính sách phản hồi), `writing-review.ts`, `writing-draft.ts`, `writing.ts` |
| Test | `ai/writing/tests/test_relevance.py`, `test_writing_explanations.py`, `test_service.py`; `backend/EnglishLearning.Api.Tests/WritingRelevanceTests.cs`; `frontend/tests/writing-*.test.cjs` |
| Tài liệu liên quan | `docs/handoff-ai-writing/` (lịch sử AI Writing), `README.md` |
