# Git và bản bàn giao

- Nhánh `Viet`, upstream `origin/Viet`, remote `https://github.com/AliceName/learning-english.git`.
- Trước bàn giao, HEAD local là `ac4cd717e50f746a693bebca1d9fca2a568e7fe1`, tip remote đã kiểm tra là `313572c21b1f6057b8f8abd5aff4bd8ba22e693a`. Năm commit đã có local gồm phần runtime GEC và phần Speaking đã hợp nhất.
- Mã nguồn và tài liệu bàn giao đã push tại commit ở mục Biên nhận. Commit ghi biên nhận tiếp theo chỉ cập nhật tài liệu này.

## Clone và đối chiếu

```powershell
git clone --branch Viet --single-branch https://github.com/AliceName/learning-english.git
Set-Location learning-english
git branch --show-current
git log -4 --oneline
git ls-remote origin refs/heads/Viet
Test-Path docs/handoff-ai-writing/00_READ_ME_FIRST.md
```

## Phạm vi bản bàn giao

- Writing Phase 1–3 gồm giao diện, review, bản nháp, phiên bản và snapshot mục tiêu CEFR từ hồ sơ.
- Writing Phase 4 gồm gợi ý thẻ, nhập Flashcards và chống trùng. Kèm test, SQL test harness và đề xuất schema nguồn. Dữ liệu nguồn dài hạn vẫn chờ duyệt.
- Tool đánh giá replay, fixture được tạo trong test, protocol GEC–Gemini, yêu cầu phê duyệt benchmark và đề xuất mở rộng từ vựng.
- 13 tài liệu trong thư mục này và liên kết tra cứu từ README. Lấy danh sách đường dẫn chính xác bằng `git diff --name-status ac4cd71...HEAD`.

## Phần nằm ngoài Git

- Working-tree `backend/EnglishLearning.Api/appsettings.Development.json` chứa cấu hình đặc thù máy. Clone nhận bản đã track từ trước. Cấu hình kết nối của máy người nhận phải dùng User Secrets hoặc biến môi trường.
- `ai/writing/artifacts/`, `.cache/`, `data/` và môi trường Python nằm ngoài Git. Không có endpoint phát hành adapter hoặc corpus được duyệt.
- `data/` ở root chứa state local. `output/` chứa ảnh/chẩn đoán trình duyệt. Chúng được giữ trên máy bàn giao.
- Ghi chú lịch sử `AI_WRITING_AGENT_HANDOFF.vi.md`, `RUN_LOCAL.vi.md` và tài liệu AI local cũ chứa nhận định theo thời điểm và đường dẫn riêng. Cụm công cụ CEFR pilot, fixture cũ, báo cáo, code phụ thuộc helper đã ignore được giữ cho nghiên cứu cục bộ. Xem [09](09_ENV_MODELS_AND_ARTIFACTS.md) để biết phụ thuộc cần xin quyền.

## Kiểm tra và hạn chế

- Health local xác nhận đúng hai checkpoint. Smoke synthetic kiểm phản hồi và tái hiện lỗi ở [04](04_GEC_MODEL_AND_FAILURES.md).
- Frontend TypeScript, ESLint và production build đều PASS. Writing 66 PASS. Speaking 43 PASS và 1 skip WAV live.
- Backend build riêng PASS. Nhóm Writing, Flashcards, guard và model có 75 PASS, 14 skip (13 SQL, 1 Mongo), 0 fail. Speaking backend 23 PASS, 6 skip.
- Kiểm tra lại backend từ bản export của Git index có 98 PASS, 20 skip, 0 fail. Build báo 0 warning và 0 error. Override Development cục bộ không nằm trong bản export.
- Python offline từ bản export của Git index có 201 PASS. Working tree cục bộ có 269 PASS gồm thêm các bài nghiên cứu không phát hành. Replay synthetic xuất M2 hai lần trùng từng byte, chấm được cả ba nhánh bằng ERRANT và giữ ca timeout.
- Không ghi database ứng dụng, chạy migration, huấn luyện, đổi checkpoint hoặc gọi Gemini. InMemory không xác minh khóa SQL. Xem [08](08_DATABASE_AND_PENDING_WORK.md).
- Chất lượng GEC và năng lực bám đề còn cần đánh giá riêng. Xem [06](06_AI_EVALUATION_PROTOCOL.md) và [07](07_AI_IMPROVEMENT_BACKLOG.md).

## Biên nhận

Đã push fast-forward `313572c21b1f6057b8f8abd5aff4bd8ba22e693a` → `09d1d49161e572022a5c4a1614ea8977fff524fe` trên `origin/Viet`. `git ls-remote` đã trả đúng SHA của commit nội dung ngay sau push. Commit nội dung gồm 50 file, xem `git show --stat 09d1d49`.
