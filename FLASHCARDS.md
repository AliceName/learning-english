# Flashcards

## Bộ thẻ admin và bộ thẻ riêng

Mọi bộ có chủ sở hữu là tài khoản admin đang hoạt động được chia sẻ để người dùng đăng nhập xem; không có bước xuất bản riêng vì schema hiện tại không có cột xuất bản bộ thẻ. Admin tạo/sửa/xóa bộ của mình tại `/flashcards` như thông thường, giao diện thông báo rõ bộ admin sẽ được chia sẻ. Người dùng khác (kể cả admin khác) chỉ đọc bản gốc; không được thêm/sửa/xóa thẻ hoặc ghi đánh giá vào đó. Bộ do tài khoản user tạo chỉ chủ sở hữu đọc và chỉnh sửa.

DTO bổ sung `canEdit` và `isAdminDeck`, tính từ UserId và vai trò trong bảng Users; không thêm cột. UI hiển thị ADMIN/CHỈ ĐỌC hoặc CỦA BẠN, ẩn form/nút sửa khi không sở hữu. Backend vẫn kiểm tra quyền trên từng thao tác, không tin cờ gửi từ trình duyệt.

Lịch ghi nhớ đang nằm trên Flashcards, không phải bảng tiến độ từng người, nên người đọc chọn **Tạo bản sao để ôn**: POST `/api/v1/flashcards/decks/{id}/copy`. Tạo bộ và các thẻ mới thuộc người bấm, đặt lại toàn bộ lịch ôn. Bản sao riêng có thể chỉnh sửa, không làm thay đổi bản gốc và không tự đồng bộ sau này. Đây là snapshot được ghi trong transaction SQL, không bổ sung schema hay dùng chung lịch giữa nhiều tài khoản. Lịch ôn của admin không hiển thị cho người đọc bản chia sẻ. Không tự tạo bản sao khi chỉ mở trang.

Bộ admin ngừng chia sẻ khi tài khoản chủ sở hữu bị vô hiệu hóa hoặc không còn vai trò admin. Bản sao đã tạo vẫn là dữ liệu riêng của người học. Mô tả dưới đây về chỉ đọc bộ riêng là phạm vi phiên bản ban đầu; quyền xem bộ admin được mở rộng như phần này.

Mở `/flashcards` từ menu **Flashcards**. Người dùng tạo bộ thẻ riêng, đổi tên/mô tả, thêm từ (mặt trước), nghĩa (mặt sau), câu ví dụ tùy chọn, sửa hoặc xóa thẻ. Xóa bộ có xác nhận và xóa các thẻ thuộc bộ đó. Không tạo dữ liệu mẫu tự động. Mỗi tài khoản tối đa 100 bộ; mỗi bộ tối đa 500 thẻ (giới hạn kiểm tra ở ứng dụng).

Chọn **Ôn thẻ đến lịch**, tự nhớ nghĩa rồi bấm thẻ hoặc Enter để lật. Sau khi lật, chọn Quên/Khó/Nhớ/Dễ. Chỉ chuyển thẻ sau khi server lưu thành công. Lỗi kết nối giữ thẻ hiện tại để có thể kiểm tra và thử lại. Phiên ôn hiện số thẻ đã đánh giá; có nút kiểm tra lịch mới khi hoàn thành. Nội dung từ/định nghĩa là văn bản thuần, không thực thi HTML.

## Phạm vi database

Nguồn: `DATABASE_SCHEMA.md` mục 2.9–2.10 và `EnglishLearningModel.cs`. Không thay đổi schema, entity, mapping, FK, index hoặc migration.

| Bảng | Cột được sử dụng | Thay đổi schema |
|---|---|---|
| FlashcardDecks | DeckId, UserId, Title NVARCHAR(255), Description NVARCHAR(500) NULL, CreatedAt, UpdatedAt | Không |
| Flashcards | CardId, DeckId, FrontText NVARCHAR(500), BackText NVARCHAR(1000), ExampleSentence NVARCHAR(1000) NULL, EaseFactor DECIMAL(4,2), IntervalDays, Repetition, NextReviewAt NULL, CreatedAt, UpdatedAt | Không |

AudioUrl/ImageUrl hiện có không được bổ sung vào giao diện trong phạm vi này. Chỉ tài khoản sở hữu được đọc/sửa/xóa bộ và thẻ; không có quyền admin xem bộ riêng của người khác. Tài khoản vô hiệu hóa bị từ chối. Email, hồ sơ và dữ liệu Speaking không bị tác động.

## Lịch ghi nhớ

Quy tắc ứng dụng dạng SM-2 đơn giản, dùng tự đánh giá chứ không phải AI. Thẻ mới đến lịch ngay. Quên đặt Repetition=0, IntervalDays=0, lịch tiếp theo sau 5 phút. Khó/Nhớ/Dễ lần đầu đặt 1 ngày, lần nhớ thứ hai 6 ngày; các lần tiếp theo nhân khoảng cách trước với EaseFactor, tối đa 3650 ngày. Mức chọn điều chỉnh EaseFactor trong khoảng 1,30–9,99 cho các lần sau. Thẻ sửa nội dung trở về thẻ mới; ghi rõ trên form trước khi lưu. Ngày giờ lưu UTC và hiển thị theo Asia/Bangkok.

Đánh giá gửi kèm UpdatedAt của phiên bản thẻ đang xem; server từ chối bản cũ và thẻ chưa đến hạn (409). SQL Server dùng transaction Serializable khi ghi đánh giá để tránh hai request cùng tăng lịch. Lỗi giao dịch được trả về để tải lại và kiểm tra, không giả lưu thành công.

## API

- GET/POST `/api/v1/flashcards/decks`
- GET/PUT/DELETE `/api/v1/flashcards/decks/{id}`
- POST `/api/v1/flashcards/decks/{id}/cards`
- PUT/DELETE `/api/v1/flashcards/cards/{id}`
- POST `/api/v1/flashcards/cards/{id}/review`: rating 0–3 và expectedUpdatedAt.

Frontend proxy `/api/flashcards/...` kiểm tra route/method, Origin cho thao tác ghi, giới hạn JSON thực 16 KB và giữ JWT trong cookie HttpOnly ở server. Tất cả phản hồi riêng không cache.

## Kiểm tra và chạy

Sau khi cập nhật, dừng phiên debug cũ rồi F5 chạy API .NET lại để nạp controller mới. Frontend chạy bằng `npm run dev` như trước. Không cần chạy migration.

`FlashcardTests` dùng database InMemory riêng: xác thực, phân quyền hai tài khoản, từ chối overposting UserId/lịch ôn, tạo/đọc/sửa/xóa bộ và thẻ, validate nội dung, lưu lịch ôn, lịch đến hạn theo đồng hồ giả, chống gửi đánh giá lặp/cũ, reset khi sửa và tài khoản vô hiệu hóa. Kiểm tra thuật toán riêng xác nhận khoảng cách 1/6/15 ngày, lịch Quên 5 phút và giới hạn hệ số. Kiểm thử không sửa database tài khoản thật; transaction SQL cần kiểm thử SQL bổ sung trước triển khai production.
