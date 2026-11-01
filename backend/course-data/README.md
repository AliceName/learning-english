# Dữ liệu khóa học TKKH

`tkkh.json` chứa nội dung đã chuẩn hóa từ thư mục TKKH do người dùng cung cấp, theo các DTO quản trị hiện có. Import tạo **4 khóa nháp**, không xuất bản, không thay đổi schema và không cập nhật các khóa đã có ngoài lượt import này.

| Khóa | Trình độ | Số bài | Câu hỏi có đáp án |
| --- | --- | ---: | ---: |
| Around You | A1 | 10 | 33 |
| English Foundation | A2 | 9 | 31 |
| Advice for Exams | B1 | 1 | 10 |
| Jobs and Dreams | C1 | 9 | 55 |
| Tổng | | 29 | 129 |

Vocabulary được lưu trong `reading.vocabulary`: 10 mục A1, 15 mục A2 và 29 mục C1. Các câu mẫu Speaking dùng bộ chuyển IPA sẵn có của API. Tài liệu B1 Grammar trống nên không tạo bài rỗng. Hai ảnh bài đọc A1 đã được chuyển thành văn bản để sử dụng với định dạng Reading hiện tại.

## Nhập dữ liệu

Cần Python 3.9 trở lên, API local đang chạy, database hiện có và tài khoản admin đã được cấu hình bằng `Initialize-Admin.ps1`. Script dùng thư viện chuẩn Python; không cần cài thêm package. Đăng nhập bằng thông tin admin đã lưu trong .NET User Secrets, không ghi mật khẩu/token vào file kết quả.

Từ thư mục gốc repository, kiểm tra gói dữ liệu và SHA-256 của 6 file MP3 trước:

```powershell
python -X utf8 backend/scripts/import_course_data.py --source-root 'C:\Users\NGA\OneDrive\Máy tính\DACN\TKKH'
```

Khi Cloudinary đã cấu hình, thêm `--apply` để upload audio và nhập dữ liệu:

```powershell
python -X utf8 backend/scripts/import_course_data.py --source-root 'C:\Users\NGA\OneDrive\Máy tính\DACN\TKKH' --apply
```

Nếu chưa có Cloudinary, dùng `--apply --defer-audio`: nội dung vẫn được nhập nhưng các bài nghe chưa có audio đều tắt kích hoạt. Sau khi chạy `backend/scripts/Set-CloudinarySecrets.ps1` và khởi động lại API, chạy lại lệnh với `--apply` và **bỏ `--defer-audio`** để gắn audio vào đúng các bài đã tạo. Hai bài C1 vẫn tắt vì còn thiếu transcript.

Checkpoint nằm trong `reports/course-import/`, gắn với package và địa chỉ API. Giữ file này để tiếp tục lượt nhập mà không tạo trùng. Không chỉnh manifest giữa một lượt nhập. Nếu khóa hoặc bài đã được chỉnh sửa/xuất bản sau khi nhập, script dừng để tránh ghi đè. Các thao tác API lưu theo từng bước; nếu có lỗi, chạy lại cùng lệnh để tiếp tục từ checkpoint. Không chạy nhiều lượt import đồng thời. Import không nằm trong một transaction chung cho cả 4 khóa.

## Nội dung cần rà soát

- Chưa có ảnh bìa trong nguồn; tất cả các khóa được giữ nháp.
- C1 Listening thiếu transcript ở cả hai bài. Bài Campus Safety chỉ nhập 4 câu có đáp án rõ; 6 câu số 11, 12, 15, 17, 19, 20 nằm trong `pendingQuestions` của manifest vì nguồn chỉ ghi “Correct”. Không suy đoán đáp án cho các câu này.
- Registration Form có trường “Material of stolen purse” nhưng đáp án nguồn là “Silver-Colored”; cần rà soát nội dung gốc. Ba câu có đáp án số/chữ tương đương được đổi sang trắc nghiệm do bộ chấm Listening hiện chỉ nhận một đáp án điền từ chính xác.
- A1 Jobs at University of Hoburn: đề tuyển huấn luyện viên bóng đá nhưng bài mẫu hỏi việc ở sports café; bài này tắt kích hoạt để chỉnh lại. Bài mẫu email pen pal dài hơn yêu cầu 50–70 từ; giữ giới hạn theo đề, giữ bài mẫu gốc.
- C1 Reading chưa có bảng đáp án. Đáp án trong gói được biên soạn từ đoạn đọc và cần giáo viên kiểm tra, nhất là câu về thí nghiệm chuột trong Memory and Age. A1 Grammar và các câu True/False/Reading chưa có bảng đáp án riêng cũng được đối chiếu từ lý thuyết, transcript hoặc ảnh vé tàu.
- Rubric Writing được bổ sung 4 tiêu chí với trọng số bằng nhau. Khi nguồn không quy định số từ, dùng 30–120 từ cho A1/A2 và 250–500 từ cho C1; cần kiểm tra trước khi xuất bản.
- Chỉnh các lỗi định dạng nhỏ: thêm ô trống bị thiếu trong câu “ambulance driver”, diễn đạt a/an theo âm đầu, đổi “In the beach” thành “On the beach”, bỏ dấu `-` biểu thị zero article trong câu mẫu A2. Không thêm kỹ năng mới hoặc bảng/cột database.

Chi tiết nguồn và các ghi chú nằm trong `sourceFiles`, `reviewNotes`, `skippedSources`, `notes` và `pendingQuestions` của manifest. Các trường này chỉ phục vụ quá trình nhập/rà soát, không được gửi vào request tạo bài học.
