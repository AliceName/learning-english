# DATABASE_SCHEMA.md — English Learning System

> **Nguồn cho Code First:** `ThietKeHeThong(2).doc`, mục **THIẾT KẾ CƠ SỞ DỮ LIỆU**, trang 14–27, cùng các thay đổi được người dùng phê duyệt ghi trong file này.
>
> **BẮT BUỘC:** Đọc cùng `DATABASE_RULES.md`. Không tự thêm/xóa/đổi tên bảng hoặc cột. Khi tài liệu không nói rõ, báo `CHƯA XÁC ĐỊNH` và hỏi người dùng trước khi quyết định.

## 1. Danh sách bảng được phép (13 bảng)

`Users`, `Courses`, `UserCourses`, `Lessons`, `SpeakingAttempts`, `WritingSubmissions`, `ExerciseResults`, `ErrorLogs`, `FlashcardDecks`, `Flashcards`, `Bookmarks`, `LearningProgress`, `UploadedDocuments`.

**Cấm tự tạo thêm bảng**, kể cả `Roles`, `Permissions`, `Questions`, `Answers`, `Notifications`, `RefreshTokens`, `AuditLogs`, `Categories` hoặc bảng AI phụ trợ, nếu chưa được duyệt. Không suy luận từ chức năng, giao diện hay API rằng phải có bảng mới.

## 2. Từ điển dữ liệu chính thức

Ký hiệu: `PK` khóa chính; `FK` khóa ngoại; `NN` NOT NULL; `NULL` cho phép NULL; `UQ` UNIQUE. Các trường `INT IDENTITY(1,1)` là khóa chính tự tăng. `DATETIME2` dùng mặc định `SYSDATETIME()` **chỉ khi ghi rõ**. Dùng `NVARCHAR` để hỗ trợ Unicode SQL Server.

### 2.1. Users (trang 15–16)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| UserId | INT | PK, IDENTITY(1,1), NN |
| Email | NVARCHAR(255) | NN, UQ |
| PasswordHash | NVARCHAR(255) | NN |
| FullName | NVARCHAR(150) | NN |
| Role | NVARCHAR(20) | NN, DEFAULT 'user', CHECK admin/user (phân biệt hoa thường) |
| AvatarUrl | NVARCHAR(500) | NULL |
| TargetLevel | NVARCHAR(10) | NULL, CHECK A1/A2/B1/B2/C1/C2 |
| CurrentStreak | INT | NN, DEFAULT 0 |
| LongestStreak | INT | NN, DEFAULT 0 |
| LastStudyDate | DATE | NULL |
| IsActive | BIT | NN, DEFAULT 1 |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

**Thay đổi được duyệt ngày 2026-10-21:** người dùng yêu cầu thêm role `admin`/`user` và tạo một admin mặc định. Migration `002_add_user_role.sql` thêm `Users.Role`, default `user` cho tài khoản hiện có và tài khoản mới; CHECK chỉ chấp nhận hai role chữ thường. PK/FK/UQ và các cột khác giữ nguyên. Admin được tạo bằng lệnh bootstrap riêng, mật khẩu băm PBKDF2; không lưu mật khẩu trong SQL hoặc repository.

### 2.2. Courses (trang 16)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| CourseId | INT | PK, IDENTITY(1,1), NN |
| Title | NVARCHAR(255) | NN |
| Description | NVARCHAR(MAX) | NULL |
| SourceType | NVARCHAR(20) | NN, DEFAULT 'system', CHECK system/user_upload |
| CoverImageUrl | NVARCHAR(500) | NULL |
| CreatedBy | INT | NULL, FK → Users.UserId |
| IsPublished | BIT | NN, DEFAULT 1 |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.3. UserCourses (trang 17)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| UserCourseId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| CourseId | INT | NN, FK → Courses.CourseId |
| EnrolledAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| Status | NVARCHAR(20) | NN, DEFAULT 'in_progress', CHECK in_progress/completed/abandoned |
| ProgressPercent | DECIMAL(5,2) | NN, DEFAULT 0, CHECK 0–100 |

**UQ(UserId, CourseId).**

### 2.4. Lessons (trang 17–18)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| LessonId | INT | PK, IDENTITY(1,1), NN |
| CourseId | INT | NN, FK → Courses.CourseId, ON DELETE CASCADE |
| Title | NVARCHAR(255) | NN |
| SkillType | NVARCHAR(20) | NN, CHECK speaking/writing/listening/reading/grammar |
| Content | NVARCHAR(MAX) | NULL |
| AudioUrl | NVARCHAR(500) | NULL |
| OrderIndex | INT | NN, DEFAULT 0 |
| DifficultyLevel | NVARCHAR(10) | NULL, CHECK A1/A2/B1/B2/C1/C2 |
| EstimatedMinutes | INT | NULL |
| IsActive | BIT | NN, DEFAULT 1 |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

**Thay đổi theo yêu cầu ngày 2026-10-22:** bổ sung loại bài học `grammar`. Script `003_add_grammar_lesson_type.sql` mở rộng riêng `CK_Lessons_SkillType`; giữ nguyên cột, kiểu dữ liệu, PK/FK, default và dữ liệu hiện có. Nội dung Grammar lưu JSON trong `Lessons.Content`. Không mở rộng `ErrorLogs.SkillType` trong phạm vi biên soạn bài học này. Script được áp dụng riêng, không chạy khi API khởi động.

### 2.5. SpeakingAttempts (trang 19)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| AttemptId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| LessonId | INT | NN, FK → Lessons.LessonId |
| AudioUrl | NVARCHAR(500) | NN |
| OverallScore | DECIMAL(5,2) | NULL, CHECK 0–100 |
| PhonemeScores | NVARCHAR(MAX) | NULL; lưu chuỗi JSON |
| Feedback | NVARCHAR(MAX) | NULL |
| DurationSeconds | INT | NULL |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.6. WritingSubmissions (trang 20)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| SubmissionId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| LessonId | INT | NULL, FK → Lessons.LessonId |
| Topic | NVARCHAR(500) | NULL |
| OriginalText | NVARCHAR(MAX) | NN |
| CorrectedText | NVARCHAR(MAX) | NULL |
| CefrLevel | NVARCHAR(10) | NULL, CHECK A1/A2/B1/B2/C1/C2 |
| ErrorsJson | NVARCHAR(MAX) | NULL; lưu chuỗi JSON |
| Feedback | NVARCHAR(MAX) | NULL |
| Score | DECIMAL(5,2) | NULL; tài liệu không quy định CHECK |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.7. ExerciseResults (trang 21)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| ResultId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| LessonId | INT | NN, FK → Lessons.LessonId |
| Score | DECIMAL(5,2) | NN, CHECK 0–100 |
| TotalQuestions | INT | NN |
| CorrectAnswers | INT | NN |
| WrongAnswersJson | NVARCHAR(MAX) | NULL; lưu chuỗi JSON |
| TimeSpentSeconds | INT | NULL |
| SubmittedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.8. ErrorLogs (trang 21–22)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| ErrorLogId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| SkillType | NVARCHAR(20) | NN, CHECK speaking/writing/listening/reading |
| LessonId | INT | NULL, FK → Lessons.LessonId |
| QuestionRef | NVARCHAR(255) | NULL |
| UserAnswer | NVARCHAR(MAX) | NULL |
| CorrectAnswer | NVARCHAR(MAX) | NULL |
| Explanation | NVARCHAR(MAX) | NULL |
| Status | NVARCHAR(20) | NN, DEFAULT 'unresolved', CHECK unresolved/resolved |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| ResolvedAt | DATETIME2 | NULL |

### 2.9. FlashcardDecks (trang 22–23)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| DeckId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| Title | NVARCHAR(255) | NN |
| Description | NVARCHAR(500) | NULL |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.10. Flashcards (trang 23–24)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| CardId | INT | PK, IDENTITY(1,1), NN |
| DeckId | INT | NN, FK → FlashcardDecks.DeckId, ON DELETE CASCADE |
| FrontText | NVARCHAR(500) | NN |
| BackText | NVARCHAR(1000) | NN |
| ExampleSentence | NVARCHAR(1000) | NULL |
| AudioUrl | NVARCHAR(500) | NULL |
| ImageUrl | NVARCHAR(500) | NULL |
| EaseFactor | DECIMAL(4,2) | NN, DEFAULT 2.50 |
| IntervalDays | INT | NN, DEFAULT 0 |
| Repetition | INT | NN, DEFAULT 0 |
| NextReviewAt | DATETIME2 | NULL |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

### 2.11. Bookmarks (trang 24–25)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| BookmarkId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| TargetType | NVARCHAR(30) | NN, CHECK lesson/writing/flashcard/course/vocabulary |
| TargetId | INT | NN; **không có FK cố định** do polymorphic |
| Note | NVARCHAR(500) | NULL |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

**UQ(UserId, TargetType, TargetId).** Không tự tạo các bảng riêng cho từng loại bookmark.

### 2.12. LearningProgress (trang 25–26)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| ProgressId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| CourseId | INT | NN, FK → Courses.CourseId |
| LastLessonId | INT | NULL, FK → Lessons.LessonId |
| LastPosition | NVARCHAR(100) | NULL |
| UpdatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |

**UQ(UserId, CourseId).**

### 2.13. UploadedDocuments (trang 26–27)

| Cột | SQL Server type | Ràng buộc |
|---|---|---|
| DocumentId | INT | PK, IDENTITY(1,1), NN |
| UserId | INT | NN, FK → Users.UserId |
| OriginalFileName | NVARCHAR(255) | NN |
| FileUrl | NVARCHAR(500) | NN |
| FileType | NVARCHAR(20) | NN, CHECK pdf/png/jpg/jpeg/docx |
| ExtractedText | NVARCHAR(MAX) | NULL |
| Summary | NVARCHAR(MAX) | NULL |
| GeneratedCourseId | INT | NULL, FK → Courses.CourseId |
| Status | NVARCHAR(20) | NN, DEFAULT 'processing', CHECK processing/completed/failed |
| CreatedAt | DATETIME2 | NN, DEFAULT SYSDATETIME() |
| ProcessedAt | DATETIME2 | NULL |

## 3. Các ràng buộc Code First không được vi phạm

1. **Giữ nguyên tên bảng số nhiều và tên PK theo tài liệu**, ví dụ `Users.UserId`, `Courses.CourseId`. Không tự đổi thành `User.Id` hoặc `Course.Id` theo quy ước chung.
2. Dùng Entity Framework Core 9 cho SQL Server theo lựa chọn backend ASP.NET Core của dự án; `NVARCHAR(MAX)` và `DATETIME2` giữ nguyên kiểu dữ liệu theo tài liệu. Baseline CSDL được lưu trong `backend/database/001_initial_schema.sql`.
3. Chỉ tạo `CHECK`, `UNIQUE`, `DEFAULT`, `FOREIGN KEY`, `CASCADE` đã được tài liệu xác định. Không tự thêm `ON DELETE CASCADE` cho FK khác.
4. `CreatedAt` và `UpdatedAt` chỉ có ở những bảng đã liệt kê. Không tự thêm `DeletedAt`, `RowVersion`, `Level`, `Slug`, `TotalLessons`, `IsDeleted` hay trường nào khác. `Users.Role` là ngoại lệ đã được duyệt tại mục 2.1.
5. Không tự thêm `Questions`, `Options`, `AnswerKeys` để hỗ trợ bài nghe/đọc. Nếu cần cấu trúc câu hỏi chưa được tài liệu mô tả, **dừng và xin duyệt**.
6. Chỉ dùng `Users.Role` với hai giá trị `admin`/`user` đã được duyệt. Không tự thêm bảng Roles/Permissions hoặc quan hệ phân quyền khác.
7. Không tạo FK từ `Bookmarks.TargetId` đến một bảng cố định; quan hệ polymorphic cần kiểm tra trong logic ứng dụng.
8. Không biến các trường JSON text (`PhonemeScores`, `ErrorsJson`, `WrongAnswersJson`) thành bảng riêng hoặc cột bổ sung khi chưa duyệt.
9. Mọi migration hoặc script SQL sinh từ model phải được kiểm tra bằng tay trước khi áp dụng. Không tự chạy migration thay đổi DB nếu người dùng chưa yêu cầu.

## 4. Điểm tài liệu chưa xác định hoặc cần xác nhận

- **Phân quyền Admin:** đã được người dùng duyệt ngày 2026-10-21 bằng cột `Users.Role` (mục 2.1); không cần bảng Roles.
- **Nội dung câu hỏi Listening/Reading:** tài liệu có `Lessons.Content` và `ExerciseResults`, nhưng không định nghĩa cấu trúc câu hỏi/đáp án dưới dạng bảng riêng. **Không tự tạo bảng.**
- **Bookmark `TargetType=vocabulary`:** không có bảng `Vocabulary` trong 13 bảng. Cần xác nhận cách tham chiếu trước khi triển khai chức năng đó.
- **`UpdatedAt`:** tài liệu nêu default khi tạo bản ghi, không quy định trigger hoặc tự cập nhật mỗi lần sửa. **Không tự thêm trigger hoặc `onupdate` nếu chưa được duyệt.**
- **Tên cụ thể của các constraint và index không được tài liệu nêu:** không tự đặt thêm index ngoài PK, FK và UNIQUE đã mô tả; tên constraint do framework/SQL Server tạo có thể khác nhưng nội dung phải đúng.

## 5. Quy trình bắt buộc cho AI coding agent

Trước khi viết model hoặc migration:

1. Đọc `DATABASE_RULES.md` và `DATABASE_SCHEMA.md`.
2. Trích đúng các cột từ mục 2, đối chiếu với tài liệu gốc trang 14–27.
3. Liệt kê mọi thay đổi schema dự kiến; nếu xuất hiện cột/bảng không có trong file này, **dừng và hỏi người dùng**.
4. Chỉ triển khai phần được yêu cầu; không chủ động thêm tính năng hoặc thay đổi database để phục vụ UI/API.
5. Sau khi tạo code, báo cáo danh sách bảng/cột/constraint đã tạo và đối chiếu với file này.

**Quy tắc cuối:** Không có trong schema đã duyệt = **không được tự tạo**.
