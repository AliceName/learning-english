# LinguaAI frontend

Next.js 16 và React 19. Trang đăng ký tại `/register` được nối với backend ASP.NET Core 9.

## Bong bóng tra từ điển

Kế hoạch chuyển audio và ảnh khóa học sang Cloudinary: `../reports/Ke_hoach_Cloudinary_media_2026-10-27.md`. Bước 3–4 đã nối backend audio từ điển và media khóa học vào Cloudinary, giữ đường đọc cache cũ. Proxy/URL cùng origin và hợp đồng prepare/file giữ nguyên.

Widget dùng chung tại root layout, xuất hiện trên trang chủ, login/register, khóa học và quản trị; ẩn tại `/account`, `/settings`, `/profile`, `/admin/settings`, `/admin/profile` và các route con. Route cài đặt/hồ sơ mới cần được cập nhật trong `src/lib/dictionary-visibility.ts`. Không có trang `/vocabulary` riêng.

Khách mở widget nhận lời mời đăng nhập; chỉ user/admin có tài khoản đang hoạt động mới được tra. Panel được tải khi mở lần đầu, kiểm tra phiên qua `/api/auth/me`, tra qua `GET /api/vocabulary?word=...`; JWT chỉ được đọc/chuyển tiếp ở server Next.js. Widget không tự tra khi mount/đổi trang.

Desktop dùng native dialog không modal, mobile dùng modal bottom sheet. Enter để tra, Escape/nút đóng để thu gọn; audio không tự phát và dừng khi đóng/đổi trang. Đổi route giữ kết quả trong bộ nhớ nhưng thu gọn panel; login/logout gửi sự kiện trong tab và BroadcastChannel để dọn dữ liệu phiên cũ. Không lưu lịch sử cá nhân vào browser hoặc DB.

Mascot dùng sprite 3×3 trong `public/mascots`, mapping tại `src/lib/mascot-sprites.ts`, giữ ảnh nguồn nguyên trạng; thiếu ảnh sẽ dùng nút Aa dự phòng. Liên kết nguồn chỉ cho HTTPS, văn bản được render bằng React. Chuyển động tôn trọng reduced-motion; có thể điều chỉnh khoảng cách với thanh dưới bằng CSS variable `--dictionary-bottom-offset`.

Audio tự chuẩn bị ngay khi có kết quả tra: loại trùng theo nguồn, gọi `/api/vocabulary/audio/prepare` rồi tải **đủ file** qua `/api/vocabulary/audio`. Proxy cùng origin giữ JWT HttpOnly ở server, chuyển tiếp Range/header và no-store; POST kiểm tra origin. Backend ưu tiên cache và bản thu Wikimedia gốc. Nghĩa hiển thị trong lúc chuẩn bị; mỗi giọng có trạng thái/nút Thử lại riêng, nút nghe chỉ bật khi Blob đã tải và player báo `canplay`. Không gọi mạng khi người dùng bấm nghe sau khi ready, không autoplay.

Mỗi kết quả chuẩn bị tối đa 16 bản thu khác nhau, 2 luồng đồng thời, 5 MiB/file và 24 MiB Blob giữ trong bộ nhớ. Đóng panel/đổi từ/route/logout hủy chờ, dừng phát và giải phóng Object URL. Mở lại tự tải từ cache backend. Metadata nguồn/tác giả/giấy phép được giữ; nhãn Anh/Mỹ chỉ hiện khi xác định được từ nguồn. OGG/MP3/WAV dùng khả năng giải mã của trình duyệt; chưa tích hợp chuyển mã hoặc giọng tổng hợp dự phòng.

Deadline chuẩn bị audio: backend mặc định 90 giây gồm cloud lookup/tải/upload/verify, proxy prepare 120 giây, proxy file 30 giây; browser tổng cộng 165 giây cho prepare và tải đủ Blob. Nghĩa hiển thị trong thời gian chờ và mỗi giọng có thể thử lại riêng; đóng/đổi từ/logout vẫn hủy chờ ngay.

Kiểm tra thông thường: `npm run lint`, `npm run build`. Kiểm thử trình duyệt nằm ở `tests/vocabulary-widget.mjs` và `tests/dictionary-audio.mjs`; cần frontend đang chạy và Playwright có Chrome. Đặt `VOCABULARY_TEST_BASE_URL=http://localhost:3000` và, nếu cần, `PLAYWRIGHT_MODULE_PATH` trỏ tuyệt đối tới `playwright/index.mjs` của runtime, rồi chạy `node tests/vocabulary-widget.mjs` và `node tests/dictionary-audio.mjs`. Script dùng dữ liệu giả tại browser cho auth/lookup/prepare/file, kiểm tra widget/route/mobile/race/logout và audio tự tải/dedup/offline/cleanup/retry; tạo ảnh và báo cáo trong `../reports`. Backend, SQL, MongoDB và nguồn Wikimedia thật được kiểm chứng riêng bằng test .NET.

Đặt thêm `ENGLISHLEARNING_RUN_LIVE_AUDIO_TEST=1` khi chạy script audio để dùng byte OGG match-US thật tải từ Wikimedia thay cho fixture WAV. Các endpoint vẫn được giả lập để kiểm thử UI độc lập; không dùng cookie/tài khoản thật và không ghi dữ liệu production. Kết quả ngày 27/10/2026 ở `../reports/Bao_cao_cache_audio_Wikimedia_2026-10-27.md`.

## Chạy ứng dụng

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

Speaking có mục tiêu, thêm/xóa câu, IPA và xem trước. Trình soạn không còn tải tệp hoặc nhập URL audio cho từng câu; câu mới có thể nghe đọc mẫu bằng giọng của trình duyệt trong bản xem trước. IPA Mỹ tự tạo khi rời ô câu tiếng Anh, có nút Tạo/Tạo lại IPA và vẫn sửa tay được. Đổi câu sẽ xóa IPA cũ; request bị hủy khi sửa/xóa câu hoặc chuyển bài, kết quả cũ không ghi đè bản sửa mới. Backend cũng tự điền IPA còn trống khi lưu. Từ điển offline không cần API key; từ chưa biết/số được thông báo, các cách đọc khác có thể mở ra xem. Phiên âm theo từ chưa suy luận ngữ cảnh/nối âm; không coi là bản IPA được AI kiểm định.

Listening có upload/player audio, transcript/chèn timestamp, ẩn transcript lần nghe đầu, trắc nghiệm/điền từ/nối ý và xem trước tương tác. Giọng đọc mẫu không có audio dùng speechSynthesis của trình duyệt; không gọi hoặc giả lập điểm AI. Context ở layout khóa học giữ phần đang soạn khi đổi tab/bước; tải lại/rời luồng có thể mất thay đổi chưa lưu, có cảnh báo trước khi unload. Nội dung xem trước toàn khóa dùng bản đã lưu. Xuất bản bị chặn khi còn thay đổi chưa lưu và được backend xác thực lại.

`/api/admin/[...path]` là proxy có danh sách route/method cho phép, kiểm tra same-origin cho request ghi, dùng JWT HttpOnly ở server. `/api/media/[fileName]` truyền Range và xác thực khi đọc ảnh/audio; token không xuất hiện trong URL. Không có token trong localStorage. `server-admin.ts` dùng no-store/connection() để tương thích Cache Components. Layout và các page Admin đặt `instant=false` theo hướng dẫn authentication-with-cache-components của Next.js 16.4: phải chờ xác thực mới nhất và có thể redirect, không cam kết điều hướng tức thì. Phạm vi này không tắt Cache Components hoặc Partial Prefetching của toàn ứng dụng. Giao diện Admin có kiểm tra role; API backend là nơi quyết định quyền cho mọi thao tác.

Thông tin phiên `PublicUser` có `role: "admin" | "user"` từ backend. Không lấy role từ dữ liệu form hoặc localStorage; phân quyền phải thực hiện ở API bằng JWT. Admin mặc định được khởi tạo bằng `backend/scripts/Initialize-Admin.ps1`; xem hướng dẫn lấy mật khẩu trong `backend/README.md`. Giao diện quản trị tại `/admin/courses`.

- `MemberNavbar` có sidebar và thanh thông tin theo `frontend_demo/KhoaHocDanhSach.html`, dùng chung qua `MemberShell` ở `/account`, `/courses`, `/courses/[courseId]`. Bản compact trên trang chủ tiếp tục dùng NavbarShell. Menu di động dùng dialog có quản lý focus và phím Escape; hiển thị tên/email, mục tiêu CEFR và streak thực từ `/auth/me`. Các mục ngoài phạm vi hiện ghi “Sắp có”.
- `/courses` yêu cầu đăng nhập, hỗ trợ tìm theo tên/mô tả, lọc CEFR/kỹ năng/trạng thái/nguồn, sắp xếp và phân trang. Bộ lọc lưu trong URL, hỗ trợ reload, Back/Forward và chia sẻ liên kết. Chọn CEFR/kỹ năng áp dụng ngay; tìm kiếm và các select áp dụng khi bấm Tìm kiếm/Áp dụng.
- `/courses/[courseId]` hiển thị mô tả và danh sách bài học thật; khóa học không được phép xem trả trang không tìm thấy. Có trạng thái tải, lỗi kết nối và danh sách trống, cùng ảnh bìa dự phòng khi thiếu hoặc lỗi ảnh.
- Server Components gọi `/api/v1/courses` và `/api/v1/courses/{id}` bằng JWT trong cookie HttpOnly, `cache: no-store`. `server-courses.ts` gọi `connection()` trước fetch/timeout để tương thích Cache Components; không truyền JWT cho client và không cache chung tiến độ cá nhân.
- Nội dung trang khóa học lấy từ database, không dùng danh sách minh họa của landing page. Khi database chưa có Courses, giao diện hiển thị trạng thái chưa có khóa học. Bài Listening đã có luồng vào học, làm bài và xem kết quả như phần dưới; các kỹ năng khác và AI/bookmark được phát triển riêng.

## Học viên làm bài Listening

Từ `/courses/[courseId]`, chọn **Làm bài nghe / Làm lại** để mở `/courses/[courseId]/lessons/[lessonId]/listening`. Giao diện dựa trên `frontend_demo/UserListening.html`, dùng navbar thành viên chung, nội dung bài đã xuất bản và audio thật. Bấm **Bắt đầu** mới ghi nhận vào học; GET trang không tạo đăng ký hoặc kết quả.

Player hỗ trợ phát/dừng, tua 5 giây/thanh thời gian, âm lượng và tốc độ 0.75–1.5x. Mỗi câu có mốc hợp lệ được nghe lại trực tiếp. Player dừng khi rời trang/đổi phiên và tránh phát chồng audio từ điển. Transcript ẩn theo thiết lập admin cho đến sự kiện nghe hết lần đầu hoặc khi đã nộp; chỉ tải khi bấm xem. Đây là hỗ trợ luyện tập, không phải chế độ thi chống gian lận.

Hỗ trợ trắc nghiệm, điền từ và nối ý. Backend chấm toàn bài trên thang 100, mỗi câu trọng số bằng nhau, nối ý đúng khi đúng đủ cặp. Câu bỏ trống tính sai và có xác nhận khi nộp thiếu. Lỗi mạng giữ câu trả lời trong phiên, nút nộp khóa khi đang gửi; không tự retry POST. Có cảnh báo khi reload/đóng tab và khi chọn liên kết rời bài đang làm.

Sau nộp có điểm, đáp án, giải thích và nghe lại đoạn liên quan. Có thể luyện lại và xem lịch sử phân trang. Lịch sử sau reload lưu điểm tổng và chi tiết câu sai; không khôi phục mọi lựa chọn của câu đúng. Vị trí nghe gần nhất của mỗi khóa lưu vào `LearningProgress`; câu trả lời chưa nộp chỉ giữ trong bộ nhớ, không tự lưu bài nháp qua reload hoặc đổi thiết bị.

Tiến độ **luyện nghe** tính trên số bài Listening đã nộp, làm lại không tăng số bài hoàn thành. Hiển thị riêng trên trang bài nghe và chi tiết khóa học; không ghi đè tiến độ toàn khóa bằng tỷ lệ riêng Listening. Backend dùng schema SQL hiện có, không cần migration.

`/api/learning/[...path]` chỉ cho phép các route/method Listening cụ thể, giữ JWT HttpOnly ở server, kiểm tra same-origin và giới hạn body 128 KiB ngay khi đọc stream. Dữ liệu cá nhân dùng private/no-store. API làm bài loại đáp án và giải thích trước nộp; mã lựa chọn nối ý được backend bảo vệ và xáo thứ tự.

Kiểm tra: `npm run lint`, `npm run build`, `node tests/listening-proxy.mjs`. Kiểm thử trình duyệt chạy `node tests/listening-practice.mjs`; đặt `PLAYWRIGHT_MODULE_PATH` trỏ tới `playwright/index.mjs` nếu dùng runtime có sẵn. Script bundle **các React component thật** trong browser harness riêng, thay Next navigation và dùng HTTP/audio/tài khoản giả qua Playwright; không cần bật server, không thay đổi ứng dụng đang chạy hoặc database. Next page/route được kiểm tra build, proxy được thực thi riêng bằng script, lưu kết quả SQL được kiểm tra bằng test .NET. Ảnh desktop/mobile và JSON kết quả nằm ở `../reports/listening-*` và `../reports/Listening_browser_checks_2026-10-28.json`.

## Cấu hình API

Route `/api/auth/register` trên Next.js chuyển yêu cầu đến `/api/v1/auth/register` trên backend. Mặc định backend ở `http://localhost:5000`. Nếu đổi địa chỉ, tạo `.env.local` dựa trên `.env.example` và đặt `API_BASE_URL`, sau đó khởi động lại Next.js. Biến này chỉ dùng ở server, không có tiền tố `NEXT_PUBLIC_`.

Form hỗ trợ kiểm tra dữ liệu, xác nhận và hiện/ẩn mật khẩu, mục tiêu CEFR không bắt buộc, thông báo email trùng và trạng thái đăng ký thành công. Mật khẩu không được ghi vào localStorage hoặc sessionStorage.

Các route `/api/auth/login`, `/api/auth/me` và `/api/auth/logout` quản lý phiên ở server Next.js. JWT chỉ nằm trong cookie HttpOnly, SameSite=Lax, không có trong response JSON gửi cho JavaScript. Cookie có thời hạn 30 phút mặc định và dùng Secure khi chạy production; triển khai production qua HTTPS. Dùng `npm run dev` khi phát triển trên HTTP local. Khóa ký JWT được cấu hình riêng trong backend theo `../backend/README.md`.

Media khóa học dùng URL `/api/media/<guid>.<ext>` sau upload Cloudinary từ backend. Component ảnh/audio preview, draft và catalog/detail giữ cùng hợp đồng URL. Proxy admin upload/publish chờ tối đa 120 giây và giữ Retry-After; multipart được kiểm tra tổng kích thước thực. Proxy media giữ Range 206/416/byte/header và private/no-store/nosniff, JWT chỉ đi tới backend. Quyền đọc draft/lesson/private-course được kiểm tra ở backend trước storage. Chạy `node tests/cloudinary-media-proxy.mjs` để kiểm tra 8 tình huống với route exports thật, cookies/backend giả lập; không dùng tài khoản thật.

Thời gian chờ backend được dùng chung trong `src/lib/backend-request.ts`: 120 giây khi chạy Development để hỗ trợ debug F5, 30 giây trong production. Proxy đăng nhập/đăng ký trả `504` với thông báo hết thời gian chờ, `503` khi dịch vụ không sẵn sàng; nếu trình duyệt hủy request thì tín hiệu hủy được truyền tới backend. Backend xử lý request bị hủy riêng, không đổi lỗi hủy thành thông báo sai mật khẩu.

Grammar được chọn ở phần thông tin khóa học hoặc thêm qua **Xây dựng bài học → Thêm Grammar**. Editor có chủ điểm, quy tắc/công thức, lỗi thường gặp, tag và giải thích cho từng câu; thêm/xóa/đổi thứ tự và đổi dạng câu hỏi. Hỗ trợ trắc nghiệm, điền từ (đáp án thay thế/phân biệt hoa thường), tìm và sửa lỗi. Xem trước dùng đáp án đã biên soạn để kiểm tra tương tác; không gọi AI và không ghi điểm học viên. Ghi chú giữ xuống dòng và hỗ trợ công thức trong dấu backtick, không render HTML tùy ý. Backend cần script `003_add_grammar_lesson_type.sql` để chấp nhận loại bài này.

Đã mở đủ 5 tab biên soạn. Writing và Reading được cập nhật theo `frontend_demo/taoWritting.html` và `frontend_demo/taoReading.html`.

**Writing** tại `/admin/courses/[id]/lessons/writing`: chủ đề riêng, dạng essay/email/paragraph/report/proposal, đề bài Markdown, Guiding Tips, giới hạn từ, rubric tối đa 8 tiêu chí tổng 100% (thẻ tóm tắt ở sidebar, nút mở chỉnh trọng số), bài mẫu tùy chọn. Mô phỏng toàn chiều rộng có trình soạn định dạng và bộ đếm từ, kiểm tra thiếu/vượt giới hạn; không lưu bài thử thành bài nộp.

**Reading** tại `/admin/courses/[id]/lessons/reading`: tiêu đề/thể loại, thanh định dạng văn bản, đếm từ/đoạn, tô sáng, chú giải từ được chọn, bản dịch tham khảo admin nhập tùy chọn. Câu hỏi có kỹ năng Skimming/Scanning/Inference/Vocabulary và điểm 0.1–10; hỗ trợ trắc nghiệm, điền từ, trả lời ngắn, True/False/Not Given, nối ý/tiêu đề, đáp án thay thế, phân biệt hoa/thường, giải thích/dẫn chứng và đổi thứ tự. Mô phỏng chia đôi màn hình, hai vùng cuộn độc lập, chỉnh cỡ chữ, bật song ngữ, tra từ tại chỗ, kiểm tra từng câu và Review tiến độ. [blank] hiển thị thành dấu chấm trong mô phỏng.

Reading có một ảnh minh họa tùy chọn: tải/kéo thả JPG, PNG, WebP tối đa 5 MB hoặc nhập URL, thay/gỡ ảnh, nhập mô tả cho trình đọc màn hình và chú thích dưới ảnh. Ảnh hiển thị đầy đủ trong phần mô phỏng, không cắt nội dung biểu đồ; nút lưu chờ upload hoàn tất. Dữ liệu ảnh đi cùng JSON nội dung bài qua API bài học hiện có.

Trình soạn hỗ trợ Markdown giới hạn: H2/H3, đậm/nghiêng/gạch chân (++), highlight (==), danh sách, trích dẫn và inline code. Chế độ Soạn thảo/Xem định dạng giữ nguyên nội dung nguồn. HTML, links và embeds không được chạy. Dữ liệu lưu qua API quản trị hiện có trong Lessons.Content version 1, tương thích bài cũ; không đổi schema SQL. Hai loại vẫn dùng chung navbar, bước tạo khóa học, lưu nháp và xuất bản. Trạng thái lưu phản ánh thao tác lưu thực tế, không hiển thị giờ tự lưu giả của demo.

Các nút AI của mẫu hiển thị chưa tích hợp và bị vô hiệu hóa: chưa chấm Writing/kiểm tra ngữ pháp AI, chưa dịch/sinh câu hỏi/trích xuất từ vựng tự động. Bộ đếm và Review chỉ phản ánh thao tác trong mô phỏng, không giả điểm IELTS.

Trắc nghiệm Reading/Listening/Grammar khởi tạo với 2 lựa chọn. Component dùng chung cho phép thêm/xóa trong khoảng 2–4; khi xóa lựa chọn phía trước đáp án đúng thì tự cập nhật chỉ số, khi xóa chính đáp án đúng thì yêu cầu chọn lại. Grammar chọn phần sai cũng dùng cùng cơ chế. Các câu cũ có 4 lựa chọn được giữ nguyên.

## Các thư viện đã sử dụng
## Mastcot:
    npm i page-mascot

## Quản lý khóa học đã xuất bản

Danh sách `/admin/courses` có Chỉnh sửa và Ẩn khóa học/Hiện khóa học cho từng dòng. Cả thông tin chung và năm loại bài được biên soạn dù khóa đã xuất bản. Bước 4 **Hiển thị** có nút ẩn/hiện, xem trước và quay lại chỉnh sửa. Nút bật hiển thị bị khóa khi còn thay đổi chưa lưu hoặc checklist chưa đủ; máy chủ kiểm tra media/nội dung đầy đủ. Khóa hiển thị cập nhật cho học viên ngay khi lưu; muốn soạn dở, ẩn trước. Trạng thái false hiển thị “Đang ẩn / Bản nháp”.

Ẩn/hiện dùng BFF POST `courses/{id}/hide` và `courses/{id}/publish`, giữ cookie HttpOnly, kiểm tra cùng nguồn và cache no-store. Các thao tác lưu có thể kiểm tra media nên proxy chờ tối đa 120 giây. Ẩn khóa không xóa bài học, bài nộp hoặc tiến độ.

## Luyện Speaking với mô hình đã train

`npm run dev` và `npm start` tự chạy `scripts/ensure-speaking.mjs` qua predev/prestart. Script kiểm tra health ở 127.0.0.1:8001, dùng lại dịch vụ sẵn có hoặc khởi động Python nền (ẩn cửa sổ trên Windows), rồi đợi ready tối đa 180 giây. Không khởi động API .NET; vẫn chạy API bằng Visual Studio như trước. Mô hình có thể mất một lúc để nạp trước khi frontend bắt đầu.

Python lấy từ biến `SPEAKING_TRAINING_ROOT` hoặc thư mục train bên cạnh repository theo bố cục máy hiện tại. Log ở `backend/EnglishLearning.Api/App_Data/speaking-service/service.log`. Dịch vụ Python tiếp tục chạy khi dừng frontend, lần chạy frontend sau sẽ dùng lại. Nếu không cần Speaking khi phát triển, đặt `$env:SPEAKING_AUTO_START='0'` trước khi chạy npm để bỏ qua bước này. Chạy trực tiếp `next dev` không đi qua bước khởi động tự động.

Nếu thiếu Python ở đường dẫn này, frontend vẫn khởi động và in cảnh báo. Gửi bản ghi để chấm cần dịch vụ Speaking đang chạy.

Bài Speaking trong khóa học đã xuất bản có nút **Luyện nói** dẫn tới `/courses/[courseId]/speaking/[lessonId]`. Giao diện ghi âm PCM16 16 kHz, nghe lại, gửi chấm, xem điểm âm/từ, coverage và 20 lần luyện gần nhất. Có thể chọn WAV thay microphone. Proxy `/api/speaking` giữ JWT ở server; audio đã lưu chỉ chủ sở hữu đọc được.

Xem `../SPEAKING.md` để khởi động dịch vụ mô hình Python, API .NET và frontend. Kết quả là điểm thử nghiệm trên các âm được hỗ trợ; chưa chấm trọng âm/độ trôi chảy hoặc xác định âm thay thế.
