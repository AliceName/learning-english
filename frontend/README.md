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

Thông tin phiên `PublicUser` có `role: "admin" | "user"` từ backend. Không lấy role từ dữ liệu form hoặc localStorage; phân quyền phải thực hiện ở API bằng JWT. Admin mặc định được khởi tạo bằng `backend/scripts/Initialize-Admin.ps1`; xem hướng dẫn lấy mật khẩu trong `backend/README.md`. Chưa có giao diện quản trị riêng.

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

## Kiểm tra

### Prerender, font và lỗi từ tiện ích trình duyệt

Project bật `cacheComponents` và `partialPrefetching`. `getCurrentUser()` đọc cookie rồi gọi `await connection()` trước khi tạo timeout và fetch tài khoản: phần này chỉ chạy khi có request thực, trong Suspense của navbar/trang tài khoản. Điều này tránh để các lời gọi đồng hồ bên trong HTTP client hoặc timeout chạy trong giai đoạn prerender/prefetch. Không đưa dữ liệu phiên đăng nhập vào cache dùng chung để xử lý lỗi `Date.now()`.

Các font ở root layout dùng CSS variable và `preload: false`, vì mỗi trang dùng các bộ font khác nhau. Trình duyệt vẫn tải font được CSS sử dụng, thay vì preload cả Geist, Geist Mono và Plus Jakarta Sans cho mọi route. Sau khi đổi cấu hình font, tải lại cứng trang để bỏ các preload của bản cũ.

Nếu Console dẫn tới `chrome-extension://.../onboarding.js` hoặc `content-script.js`, đó là script của tiện ích trình duyệt. Cập nhật tiện ích hoặc kiểm tra trong cửa sổ không bật tiện ích đó; không che lỗi bằng cách ghi đè `console.error` trong website.

```powershell
npm run lint
npm run build
```

Sau khi build, có thể chạy bản production bằng `npm run start`.
