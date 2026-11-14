# SQL Server và việc còn chờ nghiệm thu

## Bằng chứng đọc trực tiếp

Trong lần kiểm đầu khi backend đang nghe cổng 5000, `/api/v1/health/database` trả `healthy`. Truy vấn `SERVERPROPERTY('ProductVersion')` trả `16.0.1000.6`, catalog `EnglishLearningDB`, tức SQL Server 2022 Developer theo audit. `dbo.__EFMigrationsHistory` ghi `20261021085236_InitialCreate` với EF `9.0.21`. [Baseline trong repo](../../backend/EnglishLearning.Api/Migrations/20261021084912_InitialCreate.cs) dùng `20261021084912_InitialCreate`.

Audit trước bàn giao đã đối chiếu baseline và thấy 13 bảng nghiệp vụ, 122 cột, 33 default, 13 PK, 4 UNIQUE, 20 FK, 15 CHECK khớp trong phạm vi so. Khác ID migration có thể làm script EF thực thi nhánh tạo lại bảng đã có. Đây là rủi ro triển khai. Đợt bàn giao không chạy schema update hay kiểm toàn vẹn vật lý.

`sys.check_constraints` xác nhận `CK_Lessons_SkillType` còn bốn loại `reading`, `listening`, `writing`, `speaking`. [Script 003](../../backend/database/003_add_grammar_lesson_type.sql) mở thêm `grammar` theo model hiện hành. Cần duyệt riêng Grammar trước khi thay đổi catalog đang dùng. [DATABASE_SCHEMA.md](../../DATABASE_SCHEMA.md) mô tả schema và [DATABASE_RULES.md](../../DATABASE_RULES.md) quy định thẩm quyền thay đổi.

## Writing và Flashcards

- Phiên bản Writing dùng `WritingSubmissions.ErrorsJson` kiểu `nvarchar(max)`, thuộc tính `practice` chứa root/parent, version, request key/hash và CEFR mục tiêu. CEFR dự đoán lưu ở `CefrLevel`. Hai request cạnh tranh dựa vào application lock trong transaction. SQL chưa có constraint riêng cho khóa trong JSON. Thước đo đúng là kiểm số hàng và version sau commit bằng các connection riêng.
- Xác minh metadata `sys.tables` chưa có `FlashcardWritingSources`. Luồng nhập lưu được thẻ vào bảng chung, còn nguồn chỉ được kiểm ở thời điểm nhập. Đọc [đề xuất liên kết](../../WRITING_FLASHCARDS_SOURCE_PROPOSAL.vi.md) cho khóa ghép, FK, owner, retry và chính sách xóa. Chỉ triển khai migration sau khi duyệt schema và thử trên catalog riêng.
- Chưa phát hiện catalog online có tên chứa `Test` hoặc `Scratch`. Hai biến `ENGLISHLEARNING_TEST_CONNECTION_STRING` và `ENGLISHLEARNING_TEST_DATABASE` đều vắng trong process bàn giao. Kết quả này không loại trừ catalog tên khác, nhưng chưa có catalog được xác nhận cho phép ghi.

## Thứ tự phê duyệt và nghiệm thu

1. Giữ schema ứng dụng. Nhóm quyết định phương thức quản lý baseline trước khi đụng lịch sử EF. Nếu chọn EF, tái lập trên bản sao được duyệt, xác minh metadata so với repo và kế hoạch rollback trước khi sửa history. Có thể nghiệm thu Writing trên catalog mới mà chưa cần thay history của catalog ứng dụng.
2. DBA phê duyệt instance, catalog riêng, cách dựng schema và tài khoản test giới hạn quyền tới đúng catalog. Tách danh tính DDL khỏi danh tính test DML. Xác minh server/catalog thật sau khi đăng nhập. Script `001` chứa đích hard-code, nên chỉ dùng phiên bản được review cho đúng bootstrap catalog. Cấp quyền chạy khóa ứng dụng tương ứng.
3. Giữ guard [SqlServerTestTarget](../../backend/EnglishLearning.Api.Tests/SqlServerTestTarget.cs) chặn catalog ứng dụng, database hệ thống, tên không trùng và `AttachDbFilename`. Guard kiểm tên đã khai báo, cần xác minh đích ngoài guard. Test metadata ở [RegistrationTests.cs](../../backend/EnglishLearning.Api.Tests/RegistrationTests.cs) kỳ vọng schema nghiệp vụ đúng số cột và có thể coi `__EFMigrationsHistory` là bảng ngoài danh mục. Đối chiếu riêng nếu catalog test dựng bằng EF.
4. Chạy [WritingStudioSqlTests](../../backend/EnglishLearning.Api.Tests/WritingStudioSqlTests.cs) với dữ liệu synthetic theo [backend/README.md](../../backend/README.md#kiểm-thử). Test dùng nhiều connection và dữ liệu commit thật vào DB test rồi cleanup. Kiểm version, đủ row, target snapshot khi hồ sơ đổi/null, retry và conflict, quyền truy cập chéo tài khoản, dedupe thẻ. Báo ca timeout/deadlock, atomicity, retry và không truy cập dữ liệu thật. Nếu dừng bất thường, DBA xác minh fixture trước cleanup.
5. Triển khai kiểm thử nguồn lâu dài chỉ khi duyệt schema riêng. Xác minh card–submission nhiều liên kết, retry, xóa, quyền sở hữu và rollback. Chạy browser → Next → .NET → SQL test → AI local trước nghiệm thu toàn stack.

**BLOCKED** cho ghi SQL tích hợp và concurrency. EF InMemory và metadata không thay được bằng chứng transaction SQL thật. Không tự chạy migration, sửa ID baseline, ghi fixture vào `EnglishLearningDB` hoặc cấp quyền DDL cho test phổ thông.
