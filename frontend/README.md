# LinguaAI frontend

Next.js 16 và React 19. Trang đăng ký tại `/register` được nối với backend ASP.NET Core 9.

## Chạy local

Khởi tạo CSDL và chạy backend theo `../backend/README.md`, sau đó chạy từ thư mục `frontend`:

```powershell
npm ci
npm run dev
```

Mở http://localhost:3000 để xem trang chủ theo mẫu `frontend_demo/TrangChu.html`; trang đăng ký ở `/register`.

Trang đăng nhập: http://localhost:3000/login. Sau khi đăng nhập thành công, trình duyệt chuyển đến `/account`, tải thông tin tài khoản qua API được bảo vệ và có nút đăng xuất. Tạo tài khoản trên trang đăng ký trước nếu chưa có tài khoản.

## Trang chủ và navbar

- `src/app/page.tsx` dựng nội dung trang chủ; các phần tương tác và CSS nằm trong `src/components/home/`. Ảnh khóa học từ bản mẫu được lưu tại `public/images/courses/`.
- `PublicNavbar` dành cho khách, có nút đăng nhập và đăng ký. `MemberNavbar` dành cho người có phiên đăng nhập, hiển thị tên, liên kết tài khoản và đăng xuất; component này được dùng cả ở trang chủ và `/account`.
- Navbar khách và bản compact của navbar thành viên dùng chung `NavbarShell` và `Brand` trong `src/components/navigation/`. Không gắn navbar vào root layout vì các trang đăng nhập/đăng ký dùng bố cục riêng.
- `HomeNavbar` xác minh phiên bằng `getCurrentUser()` ở server trong Suspense. Nếu API tạm thời không phản hồi, vẫn giữ liên kết tài khoản và thao tác đăng xuất. Token không được truyền xuống client component.
- Form email cuối trang chuyển sang `/register?email=...` và điền sẵn email. Các thẻ khóa học có hộp xem chi tiết; câu mẫu có thể nghe bằng giọng đọc của trình duyệt khi được hỗ trợ.

Phần AI, khóa học, số liệu và đánh giá trên trang chủ hiện là nội dung minh họa. Chọn/kéo thả tài liệu chỉ xem trước tên và dung lượng, kiểm tra định dạng và giới hạn 50 MB; tệp chưa được tải lên, chưa có xử lý AI. Trang chủ vẫn hiển thị cho khách khi backend chưa chạy.

## Không gian sau đăng nhập và khóa học

### Studio Admin

Đăng nhập role admin chuyển đến `/admin/courses`. Navbar Admin và `CourseSteps` dùng chung giữa các màn hình, dựa trên `frontend_demo/taoKhoaHocThongTinChung.html`. Các chức năng quản lý người dùng/AI chưa triển khai được ghi “Sắp có”.

Luồng tạo: `/admin/courses/new` → `/admin/courses/{id}/general` → `/admin/courses/{id}/lessons/speaking` hoặc `listening` → `/preview` → `/publish`. Bước thông tin chung có tên, mô tả, ảnh bìa (tải tệp hoặc URL), CEFR/thời lượng/kỹ năng khởi tạo bài học. Sau khi tạo, CEFR/thời lượng chỉnh theo từng Lesson để khớp schema hiện có. Nút Lưu nháp/Lưu bài học lưu thật qua API; giao diện không báo tự lưu khi chưa có request thành công.

Speaking có mục tiêu, thêm/xóa câu, IPA, audio từng câu và xem trước. IPA Mỹ tự tạo khi rời ô câu tiếng Anh, có nút Tạo/Tạo lại IPA và vẫn sửa tay được. Đổi câu sẽ xóa IPA cũ; request bị hủy khi sửa/xóa câu hoặc chuyển bài, kết quả cũ không ghi đè bản sửa mới. Backend cũng tự điền IPA còn trống khi lưu. Từ điển offline không cần API key; từ chưa biết/số được thông báo, các cách đọc khác có thể mở ra xem. Phiên âm theo từ chưa suy luận ngữ cảnh/nối âm; không coi là bản IPA được AI kiểm định.

Listening có upload/player audio, transcript/chèn timestamp, ẩn transcript lần nghe đầu, trắc nghiệm/điền từ/nối ý và xem trước tương tác. Giọng đọc mẫu không có audio dùng speechSynthesis của trình duyệt; không gọi hoặc giả lập điểm AI. Context ở layout khóa học giữ phần đang soạn khi đổi tab/bước; tải lại/rời luồng có thể mất thay đổi chưa lưu, có cảnh báo trước khi unload. Nội dung xem trước toàn khóa dùng bản đã lưu. Xuất bản bị chặn khi còn thay đổi chưa lưu và được backend xác thực lại.

`/api/admin/[...path]` là proxy có danh sách route/method cho phép, kiểm tra same-origin cho request ghi, dùng JWT HttpOnly ở server. `/api/media/[fileName]` truyền Range và xác thực khi đọc ảnh/audio; token không xuất hiện trong URL. Không có token trong localStorage. `server-admin.ts` dùng no-store/connection() để tương thích Cache Components. Layout và các page Admin đặt `instant=false` theo hướng dẫn authentication-with-cache-components của Next.js 16.4: phải chờ xác thực mới nhất và có thể redirect, không cam kết điều hướng tức thì. Phạm vi này không tắt Cache Components hoặc Partial Prefetching của toàn ứng dụng. Giao diện Admin có kiểm tra role; API backend là nơi quyết định quyền cho mọi thao tác.

Thông tin phiên `PublicUser` có `role: "admin" | "user"` từ backend. Không lấy role từ dữ liệu form hoặc localStorage; phân quyền phải thực hiện ở API bằng JWT. Admin mặc định được khởi tạo bằng `backend/scripts/Initialize-Admin.ps1`; xem hướng dẫn lấy mật khẩu trong `backend/README.md`. Giao diện quản trị tại `/admin/courses`.

- `MemberNavbar` có sidebar và thanh thông tin theo `frontend_demo/KhoaHocDanhSach.html`, dùng chung qua `MemberShell` ở `/account`, `/courses`, `/courses/[courseId]`. Bản compact trên trang chủ tiếp tục dùng NavbarShell. Menu di động dùng dialog có quản lý focus và phím Escape; hiển thị tên/email, mục tiêu CEFR và streak thực từ `/auth/me`. Các mục ngoài phạm vi hiện ghi “Sắp có”.
- `/courses` yêu cầu đăng nhập, hỗ trợ tìm theo tên/mô tả, lọc CEFR/kỹ năng/trạng thái/nguồn, sắp xếp và phân trang. Bộ lọc lưu trong URL, hỗ trợ reload, Back/Forward và chia sẻ liên kết. Chọn CEFR/kỹ năng áp dụng ngay; tìm kiếm và các select áp dụng khi bấm Tìm kiếm/Áp dụng.
- `/courses/[courseId]` hiển thị mô tả và danh sách bài học thật; khóa học không được phép xem trả trang không tìm thấy. Có trạng thái tải, lỗi kết nối và danh sách trống, cùng ảnh bìa dự phòng khi thiếu hoặc lỗi ảnh.
- Server Components gọi `/api/v1/courses` và `/api/v1/courses/{id}` bằng JWT trong cookie HttpOnly, `cache: no-store`. `server-courses.ts` gọi `connection()` trước fetch/timeout để tương thích Cache Components; không truyền JWT cho client và không cache chung tiến độ cá nhân.
- Nội dung trang khóa học lấy từ database, không dùng danh sách minh họa của landing page. Khi database chưa có Courses, giao diện hiển thị trạng thái chưa có khóa học. Không tự seed dữ liệu, không hiển thị rating/gia sư AI giả; chức năng đăng ký/vào học/AI/bookmark sẽ được xây dựng riêng.

## Cấu hình API

Route `/api/auth/register` trên Next.js chuyển yêu cầu đến `/api/v1/auth/register` trên backend. Mặc định backend ở `http://localhost:5000`. Nếu đổi địa chỉ, tạo `.env.local` dựa trên `.env.example` và đặt `API_BASE_URL`, sau đó khởi động lại Next.js. Biến này chỉ dùng ở server, không có tiền tố `NEXT_PUBLIC_`.

Form hỗ trợ kiểm tra dữ liệu, xác nhận và hiện/ẩn mật khẩu, mục tiêu CEFR không bắt buộc, thông báo email trùng và trạng thái đăng ký thành công. Mật khẩu không được ghi vào localStorage hoặc sessionStorage.

Các route `/api/auth/login`, `/api/auth/me` và `/api/auth/logout` quản lý phiên ở server Next.js. JWT chỉ nằm trong cookie HttpOnly, SameSite=Lax, không có trong response JSON gửi cho JavaScript. Cookie có thời hạn 30 phút mặc định và dùng Secure khi chạy production; triển khai production qua HTTPS. Dùng `npm run dev` khi phát triển trên HTTP local. Khóa ký JWT được cấu hình riêng trong backend theo `../backend/README.md`.

Thời gian chờ backend được dùng chung trong `src/lib/backend-request.ts`: 120 giây khi chạy Development để hỗ trợ debug F5, 30 giây trong production. Proxy đăng nhập/đăng ký trả `504` với thông báo hết thời gian chờ, `503` khi dịch vụ không sẵn sàng; nếu trình duyệt hủy request thì tín hiệu hủy được truyền tới backend. Backend xử lý request bị hủy riêng, không đổi lỗi hủy thành thông báo sai mật khẩu.

Grammar được chọn ở phần thông tin khóa học hoặc thêm qua **Xây dựng bài học → Thêm Grammar**. Editor có chủ điểm, quy tắc/công thức, lỗi thường gặp, tag và giải thích cho từng câu; thêm/xóa/đổi thứ tự và đổi dạng câu hỏi. Hỗ trợ trắc nghiệm, điền từ (đáp án thay thế/phân biệt hoa thường), tìm và sửa lỗi. Xem trước dùng đáp án đã biên soạn để kiểm tra tương tác; không gọi AI và không ghi điểm học viên. Ghi chú giữ xuống dòng và hỗ trợ công thức trong dấu backtick, không render HTML tùy ý. Backend cần script `003_add_grammar_lesson_type.sql` để chấp nhận loại bài này.

Đã mở đủ 5 tab biên soạn. Writing và Reading được cập nhật theo `frontend_demo/taoWritting.html` và `frontend_demo/taoReading.html`.

**Writing** tại `/admin/courses/[id]/lessons/writing`: chủ đề riêng, dạng essay/email/paragraph/report/proposal, đề bài Markdown, Guiding Tips, giới hạn từ, rubric tối đa 8 tiêu chí tổng 100% (thẻ tóm tắt ở sidebar, nút mở chỉnh trọng số), bài mẫu tùy chọn. Mô phỏng toàn chiều rộng có trình soạn định dạng và bộ đếm từ, kiểm tra thiếu/vượt giới hạn; không lưu bài thử thành bài nộp.

**Reading** tại `/admin/courses/[id]/lessons/reading`: tiêu đề/thể loại, thanh định dạng văn bản, đếm từ/đoạn, tô sáng, chú giải từ được chọn, bản dịch tham khảo admin nhập tùy chọn. Câu hỏi có kỹ năng Skimming/Scanning/Inference/Vocabulary và điểm 0.1–10; hỗ trợ trắc nghiệm, điền từ, trả lời ngắn, True/False/Not Given, nối ý/tiêu đề, đáp án thay thế, phân biệt hoa/thường, giải thích/dẫn chứng và đổi thứ tự. Mô phỏng chia đôi màn hình, hai vùng cuộn độc lập, chỉnh cỡ chữ, bật song ngữ, tra từ tại chỗ, kiểm tra từng câu và Review tiến độ. [blank] hiển thị thành dấu chấm trong mô phỏng.

Trình soạn hỗ trợ Markdown giới hạn: H2/H3, đậm/nghiêng/gạch chân (++), highlight (==), danh sách, trích dẫn và inline code. Chế độ Soạn thảo/Xem định dạng giữ nguyên nội dung nguồn. HTML, links và embeds không được chạy. Dữ liệu lưu qua API quản trị hiện có trong Lessons.Content version 1, tương thích bài cũ; không đổi schema SQL. Hai loại vẫn dùng chung navbar, bước tạo khóa học, lưu nháp và xuất bản. Trạng thái lưu phản ánh thao tác lưu thực tế, không hiển thị giờ tự lưu giả của demo.

Các nút AI của mẫu hiển thị chưa tích hợp và bị vô hiệu hóa: chưa chấm Writing/kiểm tra ngữ pháp AI, chưa dịch/sinh câu hỏi/trích xuất từ vựng tự động. Bộ đếm và Review chỉ phản ánh thao tác trong mô phỏng, không giả điểm IELTS.

Trắc nghiệm Reading/Listening/Grammar khởi tạo với 2 lựa chọn. Component dùng chung cho phép thêm/xóa trong khoảng 2–4; khi xóa lựa chọn phía trước đáp án đúng thì tự cập nhật chỉ số, khi xóa chính đáp án đúng thì yêu cầu chọn lại. Grammar chọn phần sai cũng dùng cùng cơ chế. Các câu cũ có 4 lựa chọn được giữ nguyên.
