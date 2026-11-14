# Liên kết thẻ từ vựng với phiên bản Writing

**CHỜ PHÊ DUYỆT — KHÔNG TRIỂN KHAI SCHEMA.** `DATABASE_SCHEMA.md` mục 2.6, 2.9, 2.10 xác định khóa hiện có. `Bookmarks` chỉ tham chiếu một đối tượng. `WritingSubmissions.ErrorsJson` đang chứa dữ liệu phân tích/lịch sử, thiếu FK tới thẻ và sẽ đòi hỏi sửa các bài cũ khi xóa thẻ nếu dùng làm bảng liên kết.

API nhập thẻ trả `validatedSource` gồm `submissionId`, `versionNumber` nếu đã ghi, `term` và `context` do server đọc từ ứng viên. Cả tạo mới và trả thẻ trùng đều xác thực bài nguồn và bộ thẻ. Phản hồi này xác nhận nguồn của yêu cầu nhập. API chi tiết bộ thẻ hiện chưa đọc được lịch sử nguồn. Mặt ví dụ của thẻ là nội dung do người học xác nhận và có thể chỉnh sửa.

## Thay đổi đề xuất

Đề xuất bảng `dbo.FlashcardWritingSources` có `CardId INT NOT NULL` và `SubmissionId INT NOT NULL` làm PK ghép. Hai FK trỏ lần lượt tới `dbo.Flashcards(CardId)` và `dbo.WritingSubmissions(SubmissionId)`. Thêm `SourceTerm NVARCHAR(100) NOT NULL`, `SourceContext NVARCHAR(1000) NOT NULL` và `LinkedAt DATETIME2 NOT NULL` do server ghi UTC. Index `(SubmissionId, CardId)` hỗ trợ truy vấn ngược và dọn theo Writing. Đọc số phiên bản và lượt viết qua ID với quy tắc của Writing hiện tại để hỗ trợ cả bản cũ. Một cặp thẻ và bài nộp giữ ngữ cảnh được xác nhận đầu tiên. Mỗi bài hoặc phiên bản khác có thể có liên kết riêng, và thẻ khác nghĩa hoặc câu ví dụ có thể có liên kết riêng tới cùng bài.

Quyền sở hữu suy ra từ deck và submission. Kiểm tra cả hai trong transaction lưu và khi lấy nguồn. `GET /api/v1/flashcards/cards/{id}/writing-sources` được đề xuất làm endpoint riêng cho chủ thẻ, sắp xếp `LinkedAt DESC, SubmissionId DESC`, trả danh sách rỗng cho thẻ legacy và 404 cho thẻ người khác. UI mở `/writing?submissionId=<id>` qua quyền Writing hiện có. Nếu Writing bị hạn chế về sau, bộ lọc đọc nguồn phải áp dụng quyền đó trước khi trả câu gốc. Bộ admin chia sẻ và bản sao bỏ qua nguồn Writing.

Đề xuất `ON DELETE CASCADE` từ Card sang liên kết để dọn cả khi xóa bộ thẻ. Dùng `NO ACTION` từ Writing để quy trình xóa Writing dọn liên kết và submission trong cùng transaction, giữ thẻ. Writing hiện chưa có endpoint xóa. Khi thêm quy trình xóa sau này cần giữ thứ tự khóa ổn định với import và kiểm tra hai nhánh FK trên SQL Server.

## Chuyển đổi và rollback

- Tạo bảng trống trong migration đã được duyệt. Các thẻ cũ tiếp tục hoạt động. Câu ví dụ và từ giống nhau không phải căn cứ để gán bài nguồn cho dữ liệu cũ.
- Sau khi áp dụng schema ở DB kiểm thử riêng, lưu thẻ và liên kết trong cùng transaction và khóa nhập theo owner. Với thẻ trùng hoàn toàn, thêm liên kết tới phiên bản được chọn nếu cặp còn thiếu. Retry trả cặp đã có và giữ nguyên `LinkedAt`. Bổ sung test đọc từ Flashcards, nhiều bài cùng thẻ, thẻ legacy, truy cập chéo tài khoản, rollback khi lưu liên kết lỗi, xóa thẻ/bộ, xóa hoặc hạn chế Writing và retry trên nhiều connection.
- Rollback ứng dụng về luồng Flashcards hiện tại và giữ bảng liên kết để bảo toàn dữ liệu đã ghi. Chỉ tháo bảng trong một đợt thay đổi riêng sau khi thỏa thuận xuất dữ liệu và kiểm tra phụ thuộc.
