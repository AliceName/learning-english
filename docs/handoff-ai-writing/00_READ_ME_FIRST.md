# Bàn giao LinguaAI / LEWA — AI Writing

Dự án gồm Next.js, ASP.NET Core, SQL Server và dịch vụ Python cục bộ. Công việc đầu tiên của người tiếp nhận là **tái lập và chẩn đoán ByT5 GEC**. Công việc song song là **xây chuẩn đánh giá độ bám đề**. Giao diện và phần lưu lịch sử đã có mã và kiểm thử hồi quy. Độ tin cậy của AI, ghi đồng thời trên SQL và liên kết nguồn Flashcards vẫn có tiêu chí nghiệm thu riêng.

Runtime local ngày 14/11/2026 trả `cefr-my-first-run` và `gec-viet-full-18ep-bs2-ga8-20261111`, bật sửa lỗi và tắt feedback sinh. Smoke synthetic tái hiện lỗi bỏ sót hòa hợp động từ trong câu đã được sửa một phần. Hiện chưa có thành phần chuyên đo độ bám đề. DeBERTa dự đoán CEFR từ bài viết. Mục tiêu CEFR là giá trị người học quản lý trong Hồ sơ cá nhân.

## Thứ tự đọc

1. [01 · Trạng thái dự án](01_PROJECT_STATUS.md) và [02 · Dựng môi trường Windows](02_SETUP_WINDOWS.md).
2. [09 · Checkpoint, dữ liệu và artifacts](09_ENV_MODELS_AND_ARTIFACTS.md). Cần có quyền truy cập nội bộ hợp lệ vào run và base model trước khi xác nhận máy mới chạy AI.
3. [03 · Kiến trúc và luồng dữ liệu](03_ARCHITECTURE_AND_DATA_FLOW.md).
4. [04 · ByT5 GEC và lỗi](04_GEC_MODEL_AND_FAILURES.md), [05 · CEFR và độ bám đề](05_CEFR_AND_TOPIC_ADHERENCE.md), [06 · Giao thức đánh giá](06_AI_EVALUATION_PROTOCOL.md).
5. [07 · Backlog có tiêu chí nghiệm thu](07_AI_IMPROVEMENT_BACKLOG.md) và [08 · SQL và công việc còn chờ](08_DATABASE_AND_PENDING_WORK.md).
6. [10 · Hướng dẫn Agent](10_AGENT_ONBOARDING.md), [11 · Git và bản bàn giao](11_GIT_HANDOFF_AND_RELEASE.md), [12 · Prompt khởi động Agent](12_NEXT_AGENT_TASK.md).

## Phạm vi vận hành

Đầu tiên xác minh health, provenance adapter và ca synthetic ở tài liệu 04. Lưu lại môi trường, run ID, hashes, điều kiện và kết quả của lần chạy. Dùng bộ development để điều tra. Chỉ dùng tập độc lập đã khóa để ra quyết định chất lượng.

Cần phê duyệt riêng trước khi ghi hoặc đổi schema SQL, chạy thử nghiệm training, promote checkpoint, chuyển model/dữ liệu, bật provider ngoài hoặc gửi bài người dùng. Kho Git chỉ chuyển mã nguồn, cấu hình mẫu và tài liệu được phép. Quyền truy cập repo không thay thế quyền dùng hoặc phân phối corpus và adapter. Xem [quy tắc database](../../DATABASE_RULES.md) và [hướng dẫn nguồn W&I](https://researchdatasets.cambridge.org/datasets/write-and-improve-corpus-2024).
