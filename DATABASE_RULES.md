# DATABASE RULES — ENGLISH LEARNING SYSTEM

> **BẮT BUỘC ĐỌC TRƯỚC KHI SINH HOẶC SỬA DATABASE.**
>
> Phạm vi: FastAPI + SQLAlchemy 2.x + Alembic + Microsoft SQL Server (Code First).
>
> **Nguồn sự thật (source of truth):** ERD, data dictionary và danh sách bảng/cột/quan hệ **đã được nhóm phê duyệt**. Tài liệu này chỉ đặt ra quy tắc kiểm soát thay đổi, **không phải bản thiết kế schema**.

## 1. Quy tắc tuyệt đối

1. **Không tự tạo** bảng, cột, khóa ngoại, bảng trung gian, index, unique constraint, check constraint, enum, trigger, view hoặc dữ liệu seed khi chưa có trong thiết kế được duyệt hoặc chưa được người dùng cho phép rõ ràng.
2. **Không tự thêm** các trường thường gặp như `CreatedAt`, `UpdatedAt`, `DeletedAt`, `IsActive`, `Status`, `Description`, `Slug`, `AvatarUrl`, `RoleId`, `CreatedBy`, `UpdatedBy` chỉ vì chúng có vẻ hữu ích. Chỉ thêm khi tài liệu schema quy định.
3. **Không tự thay đổi** tên, kiểu dữ liệu, độ dài, nullable, default, precision/scale, khóa chính, khóa ngoại, cardinality, cascade rule hoặc tên bảng/cột đã được duyệt.
4. **Không suy diễn** cấu trúc database từ giao diện, API, user story hoặc tên tính năng. Một màn hình có thể sử dụng dữ liệu tính toán, DTO, truy vấn hoặc mock data mà không cần thêm cột.
5. **Không tự tách/gộp bảng**, chuẩn hóa/phi chuẩn hóa, hoặc chuyển quan hệ 1–N thành N–N. Nếu thiết kế thiếu hoặc mâu thuẫn, phải hỏi trước.
6. **Không tự chạy migration** hoặc thao tác làm thay đổi schema/dữ liệu khi chưa có yêu cầu rõ ràng. Không dùng `drop_all()`, `create_all()` khi dự án đã quản lý schema bằng Alembic.
7. **Không tự sửa migration đã được áp dụng/chia sẻ**. Tạo migration mới sau khi được phê duyệt.
8. **Không tự tạo bảng/cột phục vụ AI** (điểm phát âm, CEFR, feedback, file OCR, lịch sử chấm điểm...) khi chưa có thiết kế tương ứng. Có thể định nghĩa response schema hoặc mock object mà không thay đổi database.
9. **Không được lấy ví dụ minh họa trong câu trả lời AI làm schema chính thức**. Chỉ tài liệu schema được phê duyệt mới có hiệu lực.
10. Nếu chưa được cung cấp ERD/data dictionary, **không được tự xây dựng schema hoàn chỉnh**. Chỉ được đề xuất bản nháp riêng, ghi rõ `PROPOSAL — NOT APPROVED`, và chờ xác nhận.

## 2. Thứ tự ưu tiên khi có mâu thuẫn

1. Yêu cầu thay đổi schema được người dùng phê duyệt rõ ràng gần nhất.
2. Data dictionary / schema specification chính thức của dự án.
3. ERD đã phê duyệt.
4. SQLAlchemy Models và Alembic Migrations hiện có (để kiểm tra trạng thái triển khai; không mặc nhiên coi chúng đúng nếu mâu thuẫn tài liệu chính thức).
5. Tài liệu chức năng, API contract, mock data, thiết kế UI — **chỉ để tham khảo, không tự cấp quyền thêm cột**.

Nếu hai nguồn chính thức mâu thuẫn, dừng thay đổi liên quan và nêu rõ điểm mâu thuẫn để người dùng quyết định.

## 3. Quy ước đặt tên — chỉ áp dụng khi không trái schema được duyệt

| Thành phần | Quy ước | Ví dụ |
|---|---|---|
| Tên bảng | Danh từ số ít, PascalCase | `User`, `Course`, `Lesson` |
| Khóa chính | `Id` | `Course.Id` |
| Khóa ngoại | `<Tên bảng được tham chiếu>Id` | `CourseId`, `UserId` |
| Thời gian | `CreatedAt`, `UpdatedAt`, `DeletedAt` **nếu được duyệt** | `CreatedAt` |
| Boolean | Tiền tố `Is`, `Has`, `Can` **nếu được duyệt** | `IsPublished` |
| Model ORM | Tương ứng tên bảng | `Course` |

**Lưu ý:** Quy ước tên **không phải yêu cầu phải tạo thêm trường**. Không tự đổi tên bảng/cột đang tồn tại chỉ để đồng nhất quy ước; đề xuất thay đổi và chờ duyệt.

## 4. Phân biệt các lớp dữ liệu

- **SQLAlchemy Model:** Ánh xạ **chính xác** các bảng/cột/quan hệ đã được duyệt trong SQL Server.
- **Pydantic Schema (Request/Response):** Có thể có trường tổng hợp, trường hiển thị, giá trị tính toán hoặc dữ liệu từ nhiều bảng. **Không được mặc định tạo cột tương ứng**.
- **Frontend TypeScript type / Mock data:** Phục vụ giao diện và demo. **Không được xem là lệnh thay đổi database**.
- **Service / Repository:** Thực hiện truy vấn và nghiệp vụ dựa trên schema hiện có. Nếu cần dữ liệu chưa có, phải nêu yêu cầu thay đổi trước.
- **Alembic Migration:** Chỉ phản ánh thay đổi schema **đã được phê duyệt**.

Ví dụ: API trả về `completionPercentage` không đồng nghĩa phải thêm cột `CompletionPercentage` vào database; giá trị có thể được tính từ dữ liệu hiện có, tùy thiết kế được duyệt.

## 5. Quy trình bắt buộc trước khi viết Code First

### Bước A — Đối chiếu thiết kế

Trước khi tạo/sửa model, AI phải liệt kê:

- Bảng cần thao tác và nguồn tài liệu xác nhận bảng đó.
- Các cột **đúng theo tài liệu**: tên, SQL type, độ dài, nullable, default, PK/FK.
- Quan hệ và constraint **đúng theo tài liệu**.
- Điểm chưa rõ hoặc chưa được quy định.

**Nếu thiếu thông tin quyết định cấu trúc bảng, hỏi người dùng; không tự điền mặc định.**

### Bước B — Báo cáo phạm vi thay đổi

Trước khi thực hiện, xuất bảng:

| Đối tượng | Hiện trạng | Thay đổi dự kiến | Nguồn phê duyệt |
|---|---|---|---|
| Tên bảng/cột/constraint | Giá trị hiện tại hoặc chưa có | Thêm / sửa / xóa / không đổi | Tên tài liệu, mục, hoặc yêu cầu được duyệt |

Không có nguồn phê duyệt thì **không triển khai thay đổi schema**.

### Bước C — Triển khai tối thiểu

- Chỉ sửa các model và migration trong phạm vi đã duyệt.
- Không thêm trường “cho tương lai”, “để dễ mở rộng” hoặc “best practice”.
- Không tạo migration có thay đổi ngoài phạm vi.
- Không tự chạy `alembic upgrade head` nếu người dùng chỉ yêu cầu viết code.

### Bước D — Kiểm tra migration

1. Chạy `alembic revision --autogenerate` **chỉ khi được yêu cầu tạo migration**.
2. **Đọc và rà soát file migration** trước khi áp dụng: autogenerate có thể tạo khác biệt ngoài ý muốn, không phải kết quả luôn chính xác.
3. Đối chiếu từng `op.create_table`, `op.add_column`, `op.drop_column`, `op.alter_column`, `op.create_foreign_key`, `op.create_index`... với thay đổi được duyệt.
4. Nếu migration chứa thao tác lạ, **dừng lại, không chạy upgrade**.
5. Không tự sửa dữ liệu hiện hữu hoặc thực hiện migration phá hủy dữ liệu.

## 6. Quy tắc xử lý yêu cầu chức năng mới

Khi người dùng yêu cầu tính năng mới (ví dụ: bookmark, streak, lịch sử luyện nói, AI feedback):

1. Kiểm tra schema được duyệt có hỗ trợ hay không.
2. Nếu hỗ trợ, dùng bảng/cột hiện có.
3. Nếu không hỗ trợ, mô tả **đề xuất thay đổi schema riêng**, gồm: lý do, bảng/cột đề xuất, kiểu dữ liệu, quan hệ, ảnh hưởng đến migration và API.
4. Đánh dấu rõ `CHỜ PHÊ DUYỆT — KHÔNG TRIỂN KHAI`.
5. Chỉ triển khai sau khi người dùng đồng ý cụ thể.

**Không biến đề xuất thành code hoặc migration một cách tự động.**

## 7. Những hành động bị cấm khi chưa được cho phép

- Tự thêm các trường audit hoặc soft delete.
- Tự tạo bảng `Role`, `Permission`, `UserRole`, `RefreshToken`, `Notification`, `ActivityLog`, `File`, `AIResult` hoặc bảng khác chỉ dựa trên suy đoán.
- Tự thêm index, unique constraint, default hoặc cascade delete.
- Tự đổi kiểu `NVARCHAR` thành `VARCHAR`, thay `DECIMAL` bằng `FLOAT`, thay đổi timezone hoặc precision.
- Tự dùng `Base.metadata.create_all()` để đồng bộ schema khi đã áp dụng Alembic.
- Tự xóa và tạo lại database để sửa lỗi migration.
- Tự chỉnh trực tiếp SQL Server ngoài quy trình migration đã thống nhất.

Danh sách trên là ví dụ về **hành động không được tự ý thực hiện**, không phải danh sách các bảng/cột đang có trong hệ thống.

## 8. Mẫu phản hồi bắt buộc của AI khi thiếu schema

> Tôi chưa có đủ schema được phê duyệt để xác định chính xác bảng/cột/quan hệ. Tôi sẽ không tự tạo thêm trường hoặc migration.
>
> **Thông tin cần xác nhận:** [liệt kê ngắn gọn].
>
> **Đề xuất (chưa triển khai):** [nếu người dùng yêu cầu đề xuất].
>
> Vui lòng cung cấp ERD/data dictionary hoặc xác nhận thay đổi trước khi tôi viết SQLAlchemy Model và Alembic Migration.

## 9. Checklist trước khi bàn giao

- [ ] Mọi bảng được tạo/sửa đều có căn cứ trong schema đã duyệt.
- [ ] Không có cột dư thừa do AI tự suy diễn.
- [ ] Tên, kiểu, độ dài, nullable, default, PK/FK và quan hệ khớp thiết kế.
- [ ] Không tự thêm audit fields, status fields hoặc soft delete.
- [ ] Không lấy Pydantic Schema / UI Mock làm nguồn sinh database.
- [ ] Migration chỉ chứa thay đổi được duyệt và đã được rà soát.
- [ ] Không có thao tác phá hủy dữ liệu ngoài phạm vi.
- [ ] Các điểm chưa rõ đã được hỏi, không tự quyết định.

## 10. Cách áp dụng với AI coding agent

Trước mỗi tác vụ liên quan database, yêu cầu AI:

> Đọc `DATABASE_RULES.md` và schema/ERD đã được phê duyệt trước khi sửa bất kỳ SQLAlchemy Model hoặc Alembic Migration nào. Không tự thêm bảng, cột, khóa ngoại hay constraint. Nếu tài liệu chưa quy định, hãy hỏi tôi trước. Báo cáo diff schema dự kiến và nguồn phê duyệt trước khi triển khai.

**Tài liệu schema chính thức cần được nhóm cung cấp và duy trì riêng. Không được suy diễn rằng file quy tắc này đã mô tả đầy đủ cấu trúc database.**
