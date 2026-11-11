# English Learning API

Backend ASP.NET Core Web API dùng .NET 9, Controllers và Entity Framework Core cho SQL Server.

## Chạy ứng dụng

Cài .NET SDK 9.0.307 hoặc bản vá mới hơn trong nhánh 9.0.3xx. Từ thư mục gốc repository:

```powershell
dotnet restore EnglishLearningSystem.sln
dotnet tool restore
./backend/scripts/Start-Development.ps1
```

`Start-Development.ps1` kiểm tra/tạo khóa JWT trong User Secrets, đặt môi trường Development rồi chạy API với profile `http`. Dùng `./backend/scripts/Start-Development.ps1 -LaunchProfile https` để chạy profile HTTPS.

Nếu dùng Visual Studio, mở `EnglishLearningSystem.sln`, chọn project khởi động `EnglishLearning.Api` và profile `http` hoặc `https`, rồi bấm F5. Cả hai profile đặt rõ môi trường Development. API tự đọc khóa JWT đã lưu trong User Secrets; nếu chưa có khóa thì tạo một khóa ngẫu nhiên 64 byte và lưu lại cho những lần chạy sau. Không cần chạy script trước khi bấm F5.

### Lỗi thiếu khóa JWT khi khởi động

`OptionsValidationException` với `JwtOptions.SigningKey` là lỗi cấu hình lúc khởi động; build có thể vẫn thành công. API cần khóa ký JWT ít nhất 32 byte UTF-8. Từ thư mục gốc repository, chạy:

```powershell
./backend/scripts/Initialize-JwtSecret.ps1
dotnet run --project backend/EnglishLearning.Api --launch-profile http
```

Khóa được lưu ngoài repository tại `%APPDATA%\Microsoft\UserSecrets\464087af-810d-4b10-95fc-37a9adaa019d\secrets.json`, mục `Jwt:SigningKey`. Trong Development, API tự khởi tạo khóa còn thiếu tại đây khi chạy trực tiếp bằng Visual Studio hoặc `dotnet run`. Khóa có sẵn được giữ nguyên; khóa cấu hình qua biến môi trường hoặc tham số dòng lệnh vẫn được ưu tiên. Nếu khóa đã cấu hình nhưng quá ngắn, API vẫn báo lỗi để yêu cầu sửa cấu hình. Khi triển khai, API không tự tạo khóa: cung cấp khóa qua `Jwt__SigningKey` hoặc nơi lưu secrets của môi trường triển khai.

- Swagger UI: http://localhost:5000/swagger
- OpenAPI JSON: http://localhost:5000/openapi/v1.json
- Kiểm tra ứng dụng: `GET http://localhost:5000/api/v1/health`
- Kiểm tra SQL Server: `GET http://localhost:5000/api/v1/health/database`

API kiểm tra SQL Server trả `200` khi kết nối thành công và `503` khi thất bại. API ứng dụng không truy vấn CSDL.

## Cấu hình CSDL

`EnglishLearning.Api/appsettings.Development.json` dùng cấu hình local đã kiểm tra:

- Vị trí: `backend/EnglishLearning.Api/appsettings.Development.json`, mục `ConnectionStrings:DefaultConnection`.
- Server: `MSI\MSSQLSERVER01`.
- Database: `EnglishLearningDB`
- Xác thực Windows: tài khoản chạy ứng dụng phải có quyền truy cập database.

Trong `appsettings.json`, `ConnectionStrings:DefaultConnection` để trống; file `appsettings.Development.json` cung cấp giá trị khi chạy Development. User Secrets (`ConnectionStrings:DefaultConnection`), biến môi trường `ConnectionStrings__DefaultConnection` và tham số dòng lệnh có thể ghi đè giá trị trong file theo thứ tự ưu tiên tăng dần.

Khi chạy ngoài môi trường Development, cung cấp `ConnectionStrings__DefaultConnection` qua biến môi trường hoặc nơi lưu secrets. Không ghi mật khẩu SQL Server vào source code. `TrustServerCertificate=True` trong cấu hình Development phục vụ SQL Server local; môi trường triển khai cần cấu hình chứng chỉ phù hợp.

CORS cho phép frontend tại `http://localhost:3000`; thay đổi danh sách `Cors:AllowedOrigins` nếu frontend chạy ở địa chỉ khác. Swagger chỉ được bật trong Development.

## Cấu hình CSDL cho MongoDB

`MongoDB.Driver` 3.13.0 đã có trong project. Từ điển dùng `MongoDbSettings:ConnectionString`, `DatabaseName`, `VocabularyCollectionName` (mặc định `VocabularyEntries`) và `OperationTimeoutMs` (mặc định 1000 ms). Giữ nguyên `CoursesCollectionName` đã cấu hình; collection đó không được dùng cho từ điển. URI có tài khoản/mật khẩu cần được cung cấp qua User Secrets hoặc `MongoDbSettings__ConnectionString`, không đưa credentials vào repository/log.

Thiết kế chính thức nằm ở `../MONGODB_SCHEMA.md`. Sau khi cấu hình đúng môi trường, chạy tường minh từ repository root:

```powershell
dotnet run --project backend/EnglishLearning.Api -- --initialize-vocabulary=true
```

Lệnh tạo collection/validator nếu thiếu; khi collection đã có dữ liệu, kiểm tra dữ liệu cũ trước khi cập nhật validator và dừng nếu có bản ghi vi phạm. Khởi động API bình thường không sửa schema MongoDB/SQL Server. MongoDB tạm mất kết nối không ngăn API khởi động; lỗi cấu hình thiếu/sai vẫn cần sửa. Health riêng: `GET /api/v1/health/mongodb` chỉ ping, không chứng minh quyền ghi collection.

### API tra từ vựng

- `GET /api/v1/vocabulary?word=hello`, yêu cầu JWT và tài khoản còn hoạt động, dùng được cho user/admin. Khách nhận 401.
- Chuẩn hóa từ một lần, đọc equality theo unique `_id` `en:hello`. Cache hit chỉ có một lượt đọc MongoDB; không ghi hoặc gọi nguồn. Từ chưa có gọi Dictionary API, giữ đủ entries/metadata dạng BSON và upsert bằng `$setOnInsert`; chèn thành công đã xác nhận thì không đọc lại.
- Response gồm `word`, `language`, `entries`, `fetchedAtUtc`, `source` (`mongodb`/`dictionaryApi`) và `isPersisted`. MongoDB ghi lỗi nhưng nguồn thành công vẫn trả 200 với `isPersisted=false`; không có hàng đợi lưu bù.
- Nguồn xác nhận không có từ trả 404. HTML/JSON hỏng/nguồn 5xx trả 502; nguồn không kết nối hoặc rate limit trả 503; timeout trả 504. Giới hạn lượt của hệ thống trả 429 và Retry-After. Response lỗi dùng ProblemDetails, không lộ URI hoặc stack trace.
- `DictionaryApiSettings` điều khiển timeout nguồn (5s), giới hạn body (1 MiB), số tra mới đồng thời (32), lượt/tài khoản/phút (30). Mỗi thao tác MongoDB mặc định 1s; tác vụ dùng chung tối đa 8s, deadline người gọi 10s sau xác thực. Proxy frontend có timeout 30s, bao gồm xác thực SQL.
- Gộp các request cùng từ trong một instance. Người hủy chỉ ngừng chờ của mình; DB ngăn document trùng giữa nhiều instance. Không TTL, không tự tạo flashcard/bookmark/lịch sử người dùng.
- Log Debug có thời gian cache hit/miss, nguồn và lưu; Warning có mã lỗi nhưng không ghi payload hoặc URI kết nối.

### Audio từ điển: Wikimedia và cache file

Audio từ điển đã tích hợp Cloudinary qua `IDictionaryAudioStorage`/`CloudinaryDictionaryAudioStorage`. Runtime mặc định chỉ đọc Cloudinary; cache local cũ chỉ được đọc khi chủ động bật `Cloudinary:AllowLegacyReads=true` để rollback. Media khóa học cũng dùng chính sách này qua `IMediaStorage`. Kế hoạch: `../reports/Ke_hoach_Cloudinary_media_2026-10-27.md`.

Sau khi hiển thị nghĩa, frontend tự gọi `POST /api/v1/vocabulary/audio/prepare` với `{ "word": "match", "entry": 0, "phonetic": 1 }`. Backend đọc nguồn từ mục từ đã lưu, ưu tiên **cache → file gốc Wikimedia qua imageinfo → URL audio nguồn trong allowlist**. Request chỉ nhận từ/chỉ số, không nhận URL tùy ý. Các từ cũ trong MongoDB cũng dùng luồng này, không cần tải lại nghĩa hoặc sửa schema.

Prepare trả `status=ready`, `playbackUrl` cùng origin Next.js, MIME, dung lượng và attribution sau khi lưu file thành công. Trình duyệt còn phải tải đủ file và chờ player sẵn sàng trước khi bật nút nghe. `GET /api/v1/vocabulary/audio?word=match&entry=0&phonetic=1` chỉ đọc file đã chuẩn bị; hỗ trợ Range 206/416, không khởi động tải nguồn. Cả hai endpoint yêu cầu JWT và tài khoản SQL còn hoạt động; trả private/no-store. Cache không được phục vụ trực tiếp từ public.

Audio mới chỉ ghi lên Cloudinary `video/authenticated`; manifest `raw/authenticated` giữ hash/MIME/size/attribution theo hợp đồng adapter bước 2. GET stream qua backend sau xác thực, không đưa signed URL cho browser. Chỉ khi bật `AllowLegacyReads=true`, `App_Data/dictionary-audio` và sidecar cũ mới được đọc khi cloud xác nhận miss hoặc Cloudinary đang tắt; không tự upload/migrate/xóa file cũ trong request. Cloud lỗi được trả thành ProblemDetails, không chuyển sang ghi disk. Khi chưa bật Cloudinary, prepare bản thu mới trả `audio_storage_not_configured` trước khi tải nguồn; đọc audio cũ cũng cần bật rollback. MongoDB giữ nguyên 5 field root, không lưu file/base64/đường dẫn hoặc metadata Cloudinary.

`DictionaryAudioSettings` trong appsettings (có thể ghi đè bằng biến môi trường):

| Cấu hình | Mặc định | Ý nghĩa |
|---|---|---|
| `RootPath` | `App_Data/dictionary-audio` dưới content root | Cache legacy chỉ đọc trong luồng runtime mới |
| `MaxFileBytes` | 5 MiB | Giới hạn từng bản thu |
| `MaxCacheBytes` | 512 MiB | Chỉ còn áp dụng cho legacy writer/test; runtime mới không ghi/dọn disk |
| `MaxConcurrentPreparations` | 4 | Số tác vụ tải đang thực hiện trong một instance |
| `MaxPendingPreparations` | 32 | Tổng tác vụ đang chạy/chờ; vượt giới hạn trả 503 |
| `PreparationTimeoutSeconds` | 90 | Deadline chung gồm chờ slot, cloud lookup, tải nguồn, upload và verify |
| `SourceTimeoutSeconds` | 10 | Mỗi lượt tải; resolve metadata tối đa 5 giây |
| `RequestsPerMinute` | 120 | Tổng prepare/file mỗi tài khoản/phút |
| `UserAgent` | `EnglishLearningSystem/1.0 (...)` | Nhận diện ứng dụng khi gọi Wikimedia; đặt thông tin liên hệ phù hợp khi triển khai |

Gộp cloud lookup/tải/upload của các request cùng bản thu trong một instance. Một người hủy chờ không hủy tác vụ chung; lỗi không được lưu thành cache, nút Thử lại chạy lượt chuẩn bị mới. Host/path tải bị giới hạn và mọi redirect được kiểm tra lại. Không chuyển mã hoặc dùng giọng tổng hợp; trình duyệt không hỗ trợ codec sẽ báo lỗi riêng cho giọng đó. Cloudinary dùng `overwrite=false` và xác minh conflict giữa các instance; tác vụ tải Wikimedia vẫn có thể trùng giữa instance, chưa có distributed lock. Proxy prepare chờ tối đa 120 giây, GET 30 giây; browser chờ prepare + tải file tối đa 165 giây, nghĩa vẫn hiển thị độc lập.

Smoke Wikimedia thật bật bằng `ENGLISHLEARNING_RUN_LIVE_AUDIO_TEST=1`: tải bản thu match-US, kiểm tra OGG/nguồn/giấy phép, lưu vào thư mục tạm riêng rồi tạo lại dịch vụ với mạng bị chặn để xác nhận cache bền qua khởi tạo lại. Các bài fake/storage và integration SQL kiểm tra thêm dedup, lỗi file/redirect/quota, auth và Range. Không ghi cache hoặc dữ liệu kiểm thử vào kho production.

Có thể đặt `ENGLISHLEARNING_AUDIO_SMOKE_REPORT` thành đường dẫn JSON để ghi một mẫu thời gian tải/lưu lần đầu và prepare từ cache sau khi tạo lại dịch vụ. Mẫu dùng repository từ vựng trong bộ nhớ, không bao gồm SQL/MongoDB/proxy/browser và không đại diện p95 hoặc SLA. Báo cáo triển khai: `../reports/Bao_cao_cache_audio_Wikimedia_2026-10-27.md`.

### Kiểm thử MongoDB và benchmark

Test mặc định không cần nguồn Dictionary API công khai. Để chạy integration MongoDB, đặt `ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING`; database test mặc định `EnglishLearningDictionaryTests`, có thể đổi bằng `ENGLISHLEARNING_TEST_MONGODB_DATABASE` nhưng tên phải kết thúc bằng `Tests`. Mỗi test chỉ tạo/xóa collection có prefix `vocabulary_test_` của chính nó. Không dùng URI production.

```powershell
$env:ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING = 'mongodb://localhost:27017'
dotnet test EnglishLearningSystem.sln --filter 'FullyQualifiedName~Vocabulary'
```

Benchmark 10.000/100.000 document chỉ chạy khi thêm `ENGLISHLEARNING_RUN_VOCABULARY_BENCHMARK=1`. Có thể đặt `ENGLISHLEARNING_VOCABULARY_BENCHMARK_REPORT` thành đường dẫn JSON báo cáo. Test lấy 200 mẫu sau warmup, dùng explain xác nhận không COLLSCAN và chỉ xét tối đa một document; số đo DB không đại diện cho độ trễ toàn bộ giao diện.

Smoke test gọi nguồn thật chỉ chạy khi bật `ENGLISHLEARNING_RUN_LIVE_DICTIONARY_TEST=1` cùng cấu hình SQL test. Test tra `hello`, lưu vào collection MongoDB test riêng, tạo lại ứng dụng rồi dùng tài khoản thứ hai để đọc lại trong lúc client nguồn đã bị chặn. Tài khoản SQL được rollback và collection test được dọn. Test mặc định không phụ thuộc tình trạng Dictionary API công khai.

## Cloudinary — bước 1: cấu hình môi trường và smoke test

Đã có SDK `CloudinaryDotNet` **1.29.3**, options/validation và smoke command riêng. `Cloudinary:Enabled=false` mặc định trong cấu hình mẫu; bật bằng User Secrets để cache audio từ điển và upload media khóa học trên Cloudinary. Khi tắt, chỉ đọc file legacy nếu chủ động bật `AllowLegacyReads=true`; không tạo file local mới. Không cần sửa schema SQL/MongoDB hoặc khởi động thêm backend để chạy smoke.

### Tạo tài khoản và lấy credentials

1. Đăng ký tại [Cloudinary](https://cloudinary.com/users/register_free), mở Console và chọn Product Environment của dự án.
2. Vào **Settings → API Keys** để lấy **Cloud Name**, **API Key**, **API Secret**. Tài khoản free có một product environment; dùng prefix để tách dev/test. Không đổi cloud name sau khi đã đưa URL vào sử dụng. [Hướng dẫn chính thức](https://cloudinary.com/documentation/dev_kickstart_acct_setup).
3. Trong Visual Studio, nhấp phải project **EnglishLearning.Api → Manage User Secrets**. Thêm các khóa sau vào JSON hiện có (giữ JWT/SQL/MongoDB và dấu phẩy giữa các mục):

```json
"Cloudinary:Enabled": true,
"Cloudinary:CloudName": "your_cloud_name",
"Cloudinary:ApiKey": "your_api_key",
"Cloudinary:ApiSecret": "your_api_secret",
"Cloudinary:EnvironmentPrefix": "els/dev"
```

File local: `%APPDATA%\Microsoft\UserSecrets\464087af-810d-4b10-95fc-37a9adaa019d\secrets.json`. Các dòng trên là các property để thêm vào object đang có, không thay cả file. Không đặt chúng ở frontend/appsettings. Để nhập bằng script thay vì sửa JSON, chạy từ repository root:

```powershell
.\backend\scripts\Set-CloudinarySecrets.ps1
```

Script hỏi Cloud Name và che API Key/Secret khi nhập, mặc định prefix `els/dev`. Có thể chọn `-EnvironmentPrefix els/test`. Credentials được truyền qua stdin tới `dotnet user-secrets set`, tránh đưa secret vào tham số process/history. Lệnh merge các key `Cloudinary:*`, giữ JWT/SQL/MongoDB đã có; không in giá trị credentials. User Secrets là cấu hình local ngoài repository, không phải kho secret được mã hóa cho production. Không gửi API Secret vào chat.

Production sử dụng secrets của hosting với `Cloudinary__Enabled`, `Cloudinary__CloudName`, `Cloudinary__ApiKey`, `Cloudinary__ApiSecret`, `Cloudinary__EnvironmentPrefix=els/prod`. Không lưu credentials trong appsettings/frontend. Smoke từ chối prefix production kể cả khi credentials hợp lệ.

### Kiểm tra môi trường thật

Sau khi lưu secrets, chạy từ repository root:

```powershell
.\backend\scripts\Test-CloudinaryEnvironment.ps1
```

Script build vào `EnglishLearning.Api/bin/CloudinaryEnvironment` để không đụng DLL backend đang chạy trong Visual Studio. Sau đó chạy CLI `--cloudinary-smoke=true`, không mở cổng 5000, không truy cập SQL/MongoDB hoặc thay kho runtime. Báo cáo: `../reports/Cloudinary_environment_smoke.json`.

Mỗi lần chạy tạo prefix riêng `els/dev/smoke/<guid>` hoặc `els/test/smoke/<guid>`, upload ảnh PNG 1×1, bản thu OGG 14.795 byte và JSON attribution bằng `image`, `video`, `raw`, tất cả `type=authenticated`. Kiểm tra:

- Signed HTTPS stream trả đúng toàn bộ byte của cả ba file.
- URL authenticated không có chữ ký và URL public tương ứng đều bị từ chối (401/403/404); 5xx không được coi là đã bảo vệ thành công.
- Audio Range `bytes=0-31` phải trả 206, đủ 32 byte và Content-Range/Length đúng. Với range vượt cuối file, report ghi nguyên trạng `audioRangeResponses`: CDN có thể trả 416 hoặc bỏ qua Range và trả toàn file 200. Trường hợp 200 chỉ được ghi nhận khi byte và kích thước khớp toàn bộ file gốc, không coi đó là 416. `capabilityNotes` yêu cầu proxy ứng dụng trả 416 + `bytes */<kích thước đã xác minh>` ở bước 2 trước khi gọi upstream. Header 416 có mặt nhưng sai kích thước vẫn làm test thất bại. RFC 9110 cho phép server bỏ qua Range và chỉ khuyến nghị Content-Range ở 416. [RFC 9110 §14.2](https://www.rfc-editor.org/rfc/rfc9110.html#name-range), [§15.5.17](https://www.rfc-editor.org/rfc/rfc9110.html#name-416-range-not-satisfiable).
- Dọn đúng ba public ID do lượt smoke tạo, kể cả khi request upload mất phản hồi. Không List/Search/xóa asset có sẵn. Nếu cleanup lỗi, báo cáo liệt kê ID cần dọn. Script đối soát ID fixture trong các báo cáo `Cloudinary_environment_*failure_*.json` trước khi upload mới; chỉ đúng tên `image`, `audio`, `manifest.json` dưới prefix dev/test/smoke của lượt đó được phép dọn. Kết quả đối soát lưu `_recovery.json`, không chạy lại recovery đã xác nhận thành công.

Exit `0` chỉ khi các kiểm tra và cleanup đều đạt; `2` nghĩa chưa cấu hình hoặc namespace không phù hợp, chưa chạy kiểm tra thật; `1` nghĩa smoke thất bại. Trường `configurationIssues` nêu tên key hoặc namespace cần sửa khi chưa cấu hình hợp lệ. `configurationSources` chỉ ghi loại provider/tên file, không ghi giá trị; mã lỗi HTTP/SDK/network được phân loại an toàn và lỗi cleanup có status riêng. Report không chứa API key/secret, signed URL hoặc response body của SDK. Khi chưa có credentials, **không đánh dấu bước 1 đã nghiệm thu**. Lỗi/tính năng Cloudinary hoặc Range không được hỗ trợ sẽ thể hiện trong report để điều chỉnh trước bước 2; không mở public asset để làm test vượt qua.

Fixture OGG và giấy phép được ghi tại `EnglishLearning.Api/Resources/Cloudinary/README.md`; đây là dữ liệu kiểm thử nhúng, không phải cache media runtime mới.

Kiểm thử giả lập: `dotnet test EnglishLearningSystem.sln --filter FullyQualifiedName~CloudinaryEnvironmentTests`. Test mặc định không gọi Cloudinary. Báo cáo tiến độ bước 1: `../reports/Cloudinary_buoc_1_2026-10-27.md`.

## Cloudinary — bước 2: adapter và manifest

`ICloudMediaStore`/`CloudinaryMediaStore` và `ICloudinaryAssetTransport`/`CloudinaryAssetTransport` đã được đăng ký DI, dùng chung cho audio từ điển và media khóa học. Không có file media/manifest mới được ghi xuống disk bởi adapter và không đổi schema SQL/MongoDB.

- `StoreAsync(kind, reference, bytes, format, attribution, token)`: kiểm tra loại/kích thước/byte header, tạo SHA-256, upload `authenticated` với `overwrite=false`, đọc lại có giới hạn để xác minh hash/MIME/size, rồi mới ghi manifest JSON. Chỉ trả thành công sau khi đọc lại manifest đã commit.
- `FindAsync`: đọc manifest theo ID cụ thể qua signed delivery và kiểm tra file bằng HEAD, cache metadata tối đa 1.000 entry/60 giây. Không cache miss hoặc quyền người dùng. CDN 404 được đối chiếu bằng targeted Admin lookup để tránh nhầm manifest vừa được instance khác tạo; Admin cũng dùng khi response conflict thiếu metadata. Không List/Search toàn kho hoặc gọi Admin trên đường đọc thường đã cache.
- `OpenAsync`: trả stream cùng status/MIME/length/Range, không trả signed URL. Caller sở hữu stream và phải dispose. Out-of-bounds Range trả 416 + Content-Range từ manifest trước khi gọi CDN. Range hợp lệ mà CDN bỏ qua được xử lý bằng tải full trong giới hạn, xác minh SHA-256 rồi trả đúng slice 206. Không bật lại Range processing của MVC trên stream đã cắt sẵn.
- Ảnh tối đa 5 MiB (JPG/PNG/WebP), từ điển 5 MiB (OGG/MP3/WAV), audio khóa học 25 MiB (thêm AAC/M4A). Input/metadata sai loại, JSON không hợp lệ, stream thiếu/quá dung lượng, MIME/hash sai hoặc namespace khác bị từ chối.
- Manifest version 1 chứa kind/reference, asset ID/public ID/version/resource type/delivery type/format, SHA-256/MIME/size/UTC và attribution nguồn. Không chứa signed URL hoặc base64. Root MongoDB và URL ứng dụng hiện tại không thay đổi.
- Đọc manifest không bắt buộc header HTTP `Content-Length`: sau upload vẫn kiểm tra đúng số byte theo receipt và EOF; cold read không có header chỉ đọc tối đa `MaxManifestBytes + 1` byte để phát hiện vượt giới hạn. Header có mặt nhưng sai, file bị cắt hoặc dư byte vẫn bị từ chối. [RFC 9110 §8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6).
- Binary từ điển bất biến theo content hash; nhiều nguồn dùng chung file nhưng có manifest riêng. Cùng reference và nội dung được tái sử dụng; nội dung khác cùng reference trả 409. Manifest đã tồn tại thắng cuộc đua; không ghi đè metadata của writer khác.
- Manifest thiếu trả cache miss; binary có sẵn được dùng lại sau khi xác minh khi Store retry. Manifest sai/corrupt hoặc trỏ asset/version đã khác trả lỗi rõ ràng, không bị ghi đè tự động. Asset mất nhưng manifest cũ còn tồn tại cần đối soát riêng; không tự xóa manifest để sửa.
- Ghi manifest lỗi hoặc mất acknowledgement: trả lỗi cùng `OrphanCandidates`/log ID thuộc namespace. Đây là danh sách cần đối soát, không phải lệnh xóa: binary có thể đã được tham chiếu hoặc manifest đã commit nhưng mất phản hồi. Không có job xóa/collection orphan mới; retry cùng nội dung khôi phục được trường hợp manifest thiếu hoặc đã commit.
- 401/403 credentials/quyền và quota được phân loại thành lỗi cấu hình/storage không retry mù; 420/429 có mã rate-limit/Retry-After đề xuất, network/timeout có thể retry trong deadline của caller. Không đưa error body hoặc signed URL của provider vào exception/log.

`CloudinaryMedia` options: `MaxManifestBytes=32768`, `MaxConcurrentOperations=4`, `OperationTimeoutSeconds=90`, `MetadataCacheSeconds=60`, `MetadataCacheEntries=1000`. Một instance có 64 lock stripe theo reference; phía Cloudinary vẫn dùng `overwrite=false` để tránh ghi đè giữa nhiều instance. TTL không thay thế xác thực SQL tại endpoint. Bước tích hợp phải đặt deadline ngoài bao phủ SQL/Mongo/storage và truyền cancellation; stream có deadline riêng cả sau khi headers đã tới.

Chạy kiểm thử adapter thật từ repository root bằng User Secrets của bạn:

```powershell
.\backend\scripts\Test-CloudinaryAdapter.ps1
```

Lệnh tương đương `Test-CloudinaryEnvironment.ps1 -Adapter`; report riêng `../reports/Cloudinary_adapter_smoke.json`. Test dùng namespace `els/dev/smoke/<guid>` hoặc `els/test/smoke/<guid>`, kiểm tra commit/read lại, recreate service, existing conflict, orphan, ảnh/audio khóa học, 206/416 và snapshot media local không thay đổi; dọn đúng ID fixture của lượt đó. Không chuyển provider runtime, không mở thêm cổng backend hoặc sửa SQL/MongoDB. Nếu cleanup không xác nhận được, report liệt kê ID để xử lý; không xóa cả folder/cloud namespace khác.

Khi smoke adapter thất bại, `adapterFailure` ghi stage, thao tác delivery cuối, resource type/format, status và kích thước receipt/header nếu có. Các trường này không chứa credentials, signed URL hoặc nội dung file. Report trước bản cập nhật 28/10 chưa có chẩn đoán này.

Test mặc định dùng fake transport và HTTP handler, không cần Cloudinary: `dotnet test EnglishLearningSystem.sln --filter 'FullyQualifiedName~CloudinaryMediaStoreTests|FullyQualifiedName~CloudinaryAssetTransportTests'`. Kết quả bước 2: `../reports/Cloudinary_buoc_2_2026-10-27.md`.

## Cloudinary — bước 3: audio từ điển

`CloudinaryDictionaryAudioStorage` mặc định chỉ đọc cloud; nhánh đọc legacy khi miss chỉ bật qua `AllowLegacyReads=true` trong rollback. GET vẫn xác thực JWT/tài khoản SQL trước khi tra storage; cloud stream giữ status/length/Content-Range từ adapter và **không** chạy MVC Range lần nữa. Legacy FileStream dùng MVC Range. Cả hai trả private/no-store và nosniff. Lỗi cloud có code an toàn và Retry-After nếu có; không lộ signed URL/credentials hay tác động payload nghĩa.

Chạy smoke bước 3 trong PowerShell có User Secrets:

```powershell
.\backend\scripts\Test-CloudinaryDictionaryAudio.ps1
```

Report riêng `../reports/Cloudinary_dictionary_audio_smoke.json`; 13 kiểm tra adapter + 9 kiểm tra pipeline prepare/cache/attribution/retry/Range/no-disk. Test dùng Cloudinary thật trong namespace smoke riêng, repository/nguồn audio fixture trong bộ nhớ và dọn asset test; không mở cổng server, không ghi SQL/MongoDB/cache local. Nguồn Wikimedia thật, xác thực HTTP/SQL và UI được kiểm chứng riêng; smoke này không thay thế toàn bộ luồng browser với tài khoản thật. Chi tiết `../reports/Cloudinary_buoc_3_2026-10-28.md`.

Nếu report chỉ lỗi cleanup, chạy `Test-CloudinaryDictionaryAudio.ps1 -CleanupOnly` để đối soát đúng ID/type trong report mà không upload lại. Recovery dùng namespace dev/test smoke UUID, retry lỗi tạm thời tối đa 3 lần trong deadline 90 giây; không retry credentials/quyền. `ok`/`not found` đều hợp lệ. Ghi report `_recovery.json` với `cleanupTargets`, giữ nguyên bằng chứng smoke gốc. Mode thường tự đối soát các report adapter/dictionary còn pending trước khi tạo asset mới. Không xóa cả folder hoặc media runtime.

## Cloudinary — bước 4: media khóa học

`CloudinaryCourseMediaStorage` xử lý upload và read/verify bất đồng bộ. Upload mới ghi Cloudinary, URL ứng dụng vẫn `/api/media/<guid>.<ext>`; local cache cũ chỉ đọc khi cloud miss hoặc đang tắt. Validate MIME/magic và số byte thực tế trong giới hạn cover 5 MiB/audio 25 MiB. Multipart giới hạn 27 MiB, memory threshold 28 MiB để request hợp lệ không dùng temp disk. Upload/publish backend có deadline 90 giây, proxy 120 giây.

Admin được preview media draft. Học viên chỉ đọc file tham chiếu từ khóa học đã publish và nhìn thấy được, lesson active. Speaking kiểm tra đúng `sentences[].audioUrl` sau khi parse schema version 1; URL trong văn bản không cấp quyền. Publish dedup URL/type và HEAD asset ngay cả khi manifest còn trong cache, từ chối thiếu/sai loại và giữ draft khi cloud lỗi. Các URL ngoài HTTP/HTTPS không có user-info giữ theo hợp đồng cũ; server không fetch URL đó. Cloud stream không chạy MVC Range lần nữa; legacy FileStream giữ MVC Range.

Smoke riêng: `.\backend\scripts\Test-CloudinaryCourseMedia.ps1`, report `../reports/Cloudinary_course_media_smoke.json`. 22 kiểm tra adapter/wrapper bằng PNG/WAV fixture trên namespace smoke riêng, không server/SQL/MongoDB hoặc file runtime. Chỉ cleanup lại: thêm `-CleanupOnly`. Test proxy: `node tests/cloudinary-media-proxy.mjs` từ frontend, dùng route exports thật và backend/cookies giả lập. Chi tiết `../reports/Cloudinary_buoc_4_2026-10-28.md`. Chưa migrate hoặc xóa media cũ.

## Cloudinary — bước 5: di chuyển dữ liệu

Công cụ CLI riêng không mở server, seed hoặc sửa DB. `Invoke-CloudinaryMediaMigration.ps1` mặc định DryRun; đọc SQL/MongoDB bằng SELECT/Find, kiểm kê cả file chưa thấy tham chiếu, hash và map key/GUID sang manifest hiện có. Plan bind snapshot nguồn/reference và namespace/account; thay đổi sau dry-run sẽ dừng trước upload.

```powershell
.\backend\scripts\Invoke-CloudinaryMediaMigration.ps1 -Mode DryRun
.\backend\scripts\Invoke-CloudinaryMediaMigration.ps1 -Mode Apply
.\backend\scripts\Invoke-CloudinaryMediaMigration.ps1 -Mode Verify
# Hoặc tuần tự cả ba lượt:
.\backend\scripts\Invoke-CloudinaryMediaMigration.ps1 -Mode All
```

Apply backup tất cả file inventoried vào `backups/media-migration/<planId>/` (Git-ignore), kiểm tra hash trước khi upload từ RAM qua adapter bất biến. URL course giữ nguyên GUID/extension; dictionary giữ source key và attribution. Verify dùng store/cache mới, tải đủ byte và tính SHA-256. Có plan/apply/verify archive trong backup; report canonical tại `../reports/Cloudinary_media_migration_*.json`. Mọi file không chuyển/missing/conflict có trạng thái riêng; re-audit cuối bắt file mới hoặc reference thay đổi. Không tự sửa DB, xóa nguồn hoặc xóa cloud runtime. Chỉ `verified` mới là nghiệm thu; partial/blocked trả exit 1 và giữ dữ liệu để đối soát/rerun.

Hỗ trợ `-PlanPath` và `-BackupRoot`; dùng cùng backup root khi Apply/Verify tách lượt. Không dùng inspection plan chưa bind account để apply. Chi tiết giới hạn, rollback và kết quả ở `../reports/Cloudinary_buoc_5_2026-10-28.md`. Dọn legacy sau verify và thời gian giữ thuộc bước 6.

## Cloudinary — bước 6: cloud-only và retention

Runtime mặc định `Cloudinary:AllowLegacyReads=false`: không resolve legacy reader hoặc đọc local khi cloud miss/lỗi. `Enabled=false` không tự quay về disk. Option legacy chỉ bật có chủ đích cho rollback; new writes vẫn lên cloud hoặc báo unavailable. Không cần tạo `App_Data` cho đường cloud-only.

Khởi động lại backend hiện tại bằng mã mới rồi chạy `.\backend\scripts\Test-CloudinaryCutover.ps1`. GET `/api/v1/health/media` no-store chỉ trả revision/mode/target hash/instance ID/start time, không secret. Tool xác nhận API đã restart sau migration, hai process đọc đồng thời và một process mới sau restart; không listener mới. Chrome kiểm tra decode/Blob/offline bằng backup khớp hash, native workers đọc cloud thật. Report mô tả rõ fixture harness, không giả logged-in end-to-end.

Acceptance seal chốt hạn giữ tối thiểu 7 ngày. `-Mode CleanupDryRun` hoặc `-Mode Cleanup` trước hạn chỉ ghi deferred/0 deleted; không force/bypass ngày. Sau hạn, tool xác minh fresh cloud + hash backup/source, chỉ xóa file allowlist, giữ backup/extra. Adapter/config cần refactor và build/test review sau window, không bị xóa mù bởi CLI. Xem `../reports/Cloudinary_buoc_6_2026-10-28.md`; không coi source cleanup là đã xong trước hạn.

## Dependencies .NET

Dependencies NuGet được quản lý trong `EnglishLearning.Api/EnglishLearning.Api.csproj`:

- `Microsoft.AspNetCore.Authentication.JwtBearer` 9.0.21: xác thực chữ ký, issuer, audience và thời hạn JWT.
- `Microsoft.AspNetCore.OpenApi` 9.0.21 và `Swashbuckle.AspNetCore.SwaggerUI` 9.0.6: tài liệu API và giao diện Swagger.
- `Microsoft.EntityFrameworkCore.SqlServer` 9.0.21: kết nối SQL Server qua EF Core.
- `Microsoft.EntityFrameworkCore.Design` và `Microsoft.EntityFrameworkCore.Tools` 9.0.21: công cụ thiết kế và Package Manager Console trong Visual Studio.

CLI `dotnet-ef` 9.0.21 được khai báo riêng trong `.config/dotnet-tools.json` ở thư mục gốc repository. Cài lại bằng `dotnet tool restore`, kiểm tra bằng `dotnet ef --version`. Việc restore/cài công cụ không chạy migration hoặc thay đổi CSDL.

`EnglishLearning.Api/packages.lock.json` ghi lại phiên bản NuGet đã resolve, gồm cả dependencies gián tiếp. Dùng `dotnet restore EnglishLearningSystem.sln --locked-mode` để kiểm tra việc khôi phục đúng bộ phiên bản này.

## Dependencies Python AI

`requirements.txt` tại thư mục gốc dành cho nền tảng dịch vụ AI Python. Dùng Python 3.13 và môi trường ảo riêng:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip check
```

Danh sách gồm FastAPI, Uvicorn, Pydantic Settings, Python Multipart và HTTPX. Các gói CSDL Python cũ như SQLAlchemy, Alembic và pyodbc đã được bỏ vì backend .NET quản lý SQL Server. PyTorch/CUDA, Transformers, OCR và thư viện đọc tài liệu sẽ được chọn khi triển khai engine tương ứng.

## Phạm vi project hiện tại

- Đã ánh xạ đủ 13 bảng và 122 cột theo `DATABASE_SCHEMA.md`, bao gồm `Users.Role` được duyệt ngày 2026-10-21.
- Có API đăng ký tài khoản, chuẩn hóa email, kiểm tra email trùng và băm mật khẩu bằng `PasswordHasher<User>` (PBKDF2 với salt).
- Có API đăng nhập cấp JWT và API tài khoản cần xác thực; đăng ký trả về thông tin công khai của tài khoản vừa tạo.
- Ứng dụng không tự tạo database, bảng, dữ liệu hoặc chạy migration khi khởi động.
- Trước khi thêm entity hoặc migration, đối chiếu `DATABASE_SCHEMA.md`, `DATABASE_RULES.md` và schema thực tế.
- Dịch vụ Python xử lý AI sẽ được tích hợp qua HTTP ở bước phát triển tiếp theo.

## Tạo CSDL theo tài liệu

Migration SQL đầu tiên là `backend/database/001_initial_schema.sql`, lấy các cột và ràng buộc từ mục 2.1–2.13 của `DATABASE_SCHEMA.md`. Script tạo `EnglishLearningDB` và các bảng còn thiếu, không sửa hoặc xóa bảng/dữ liệu đã tồn tại. Nếu CSDL có cấu trúc khác tài liệu, cần đánh giá một migration riêng; script này không tự đồng bộ các khác biệt đó.

Chạy từ thư mục gốc repository bằng tài khoản Windows có quyền tạo CSDL:

```powershell
sqlcmd -S 'MSI\MSSQLSERVER01' -d master -E -C -b -f 65001 -i backend/database/001_initial_schema.sql
```

Thay server bằng instance SQL Server của bạn. Baseline này có đúng 13 bảng nghiệp vụ, 121 cột, 20 FK, 14 CHECK và 4 UNIQUE; chỉ `Lessons.CourseId` và `Flashcards.DeckId` có xóa cascade. Chưa dùng EF migrations history; không chạy `database update` hoặc `EnsureCreated` để khởi tạo lại CSDL này.

### Role và tài khoản admin mặc định

Người dùng phê duyệt `Users.Role` ngày 2026-10-21: `NVARCHAR(20) NOT NULL DEFAULT 'user'`, CHECK chỉ nhận `admin`/`user` chữ thường. Sau baseline, chạy migration riêng (cũng áp dụng cho database hiện có):

```powershell
sqlcmd -S 'MSI\MSSQLSERVER01' -d EnglishLearningDB -E -C -b -f 65001 -i backend/database/002_add_user_role.sql
./backend/scripts/Initialize-Admin.ps1
```

Migration có transaction, chạy lại được, gán role `user` cho tài khoản cũ; không sửa email, mật khẩu, PK/FK hoặc dữ liệu nghiệp vụ khác. Schema sau migration: 13 bảng, 122 cột, 20 FK, 15 CHECK, 4 UNIQUE. Không sửa baseline `001` đã được dùng trước đó.

Script admin tạo mặc định `admin@linguaai.local` (tên Quản trị viên), sinh mật khẩu ngẫu nhiên 24 byte, lưu các khóa `BootstrapAdmin:Email`, `BootstrapAdmin:FullName`, `BootstrapAdmin:Password` vào User Secrets ngoài repository. Mật khẩu chuyển cho CLI bằng stdin, không nằm trong source, SQL, tham số tiến trình hoặc log. Để xem thông tin đăng nhập đã lưu trên máy của bạn:

```powershell
./backend/scripts/Initialize-Admin.ps1 -ShowCredentials
```

`-ShowCredentials` chỉ đọc thông tin đã lưu, không chạy bootstrap hoặc đổi mật khẩu. User Secrets của project: `%APPDATA%\Microsoft\UserSecrets\464087af-810d-4b10-95fc-37a9adaa019d\secrets.json`. Có thể mở bằng **Manage User Secrets** của project API trong Visual Studio.

Bootstrap dùng `PasswordHasher<User>` như đăng ký thường. Chạy lại không tạo bản sao, không reset mật khẩu/tên/trạng thái; nếu email thuộc user thường hoặc admin bị vô hiệu hóa, lệnh báo lỗi và giữ nguyên tài khoản. Ứng dụng khởi động bình thường/F5 không tự tạo/reset admin. Script là công cụ Development; môi trường khác có thể cấp `BootstrapAdmin__Email`, `BootstrapAdmin__FullName`, `BootstrapAdmin__Password` qua secret store và chạy lệnh provisioning riêng:

```powershell
dotnet run --project backend/EnglishLearning.Api --configuration Release --no-launch-profile -- --bootstrap-admin=true
```

API đăng ký công khai luôn gán `user`, bỏ qua trường role do client tự thêm. Đăng ký, đăng nhập và `/auth/me` trả `role` công khai; JWT có claim `role`, cấu hình `RoleClaimType = "role"`. Các API quản trị khóa học dùng `[Authorize(Roles = UserRoles.Admin)]` và kiểm tra lại Role/IsActive từ database cho mỗi request để chặn tài khoản đã bị hạ quyền. Role trong JWT phản ánh thời điểm đăng nhập; đăng nhập lại để nhận claim mới sau khi đổi role.

## Đăng ký tài khoản

`POST /api/v1/auth/register`, nội dung JSON:

```json
{
  "email": "learner@example.com",
  "fullName": "Người học tiếng Anh",
  "password": "Learning@2026",
  "confirmPassword": "Learning@2026",
  "targetLevel": "B1"
}
```

Email tối đa 255 ký tự, họ tên tối đa 150 ký tự, mật khẩu dài 8–128 ký tự và phải khớp mật khẩu xác nhận. Email được bỏ khoảng trắng đầu/cuối và chuyển thành chữ thường. `targetLevel` không bắt buộc; nếu có phải là A1, A2, B1, B2, C1 hoặc C2.

- `201`: tạo tài khoản, trả `message` và `user` gồm `userId`, `email`, `fullName`, `targetLevel`, `createdAt`, `role` (`user`).
- `400`: dữ liệu không hợp lệ, lỗi từng trường trong `errors`.
- `409`: email đã đăng ký, bao gồm trường hợp hai yêu cầu đồng thời trùng email.
- `503`: CSDL chưa sẵn sàng; phản hồi không chứa chi tiết SQL.

Mật khẩu và hash không được đưa vào response. Các giá trị mặc định và thời điểm tạo tài khoản lấy từ CSDL đúng thiết kế; role đăng ký được cố định là `user`. Không thêm bảng Identity, Roles hoặc cột ngoài schema đã duyệt.

Giao diện Next.js tại `http://localhost:3000/register` gọi API thông qua route proxy `/api/auth/register`; hướng dẫn chạy frontend ở `frontend/README.md`.

## Đăng nhập và phiên làm việc

`POST /api/v1/auth/login` nhận `{ "email": "learner@example.com", "password": "Learning@2026" }`:

- `200`: trả `accessToken`, `tokenType`, `expiresIn`, `expiresAt` và thông tin `user` công khai.
- `400`: email/mật khẩu không hợp lệ.
- `401`: thông báo chung cho email không tồn tại, mật khẩu sai hoặc tài khoản bị vô hiệu hóa.
- `429`: vượt 30 lần thử cho cùng email trong một phút; hạn mức lưu trong bộ nhớ của instance API và không chặn email khác.
- `503`: CSDL chưa sẵn sàng.

`GET /api/v1/auth/me` yêu cầu header `Authorization: Bearer <accessToken>`. API xác thực JWT và kiểm tra tài khoản vẫn tồn tại, còn hoạt động. Swagger có nút **Authorize** để dán access token và thử API này.

JWT dùng HS256, có thời hạn mặc định 30 phút, kiểm tra issuer/audience và chỉ chấp nhận thuật toán đã cấu hình. Khóa ký không nằm trong source code: API tự tạo khóa còn thiếu trong User Secrets khi chạy Development và giữ nguyên khóa đã có. Script `backend/scripts/Initialize-JwtSecret.ps1` cũng có thể khởi tạo khóa trước khi chạy. Khi triển khai, cấu hình `Jwt__SigningKey` bằng một giá trị bí mật đủ mạnh, ít nhất 32 byte; có thể ghi đè `Jwt__Issuer`, `Jwt__Audience`, `Jwt__AccessTokenMinutes` (1–60).

Next.js nhận token ở server rồi lưu vào cookie HttpOnly, SameSite=Lax, thời hạn tương ứng JWT; Secure được bật khi chạy production, cần triển khai qua HTTPS. Token không được trả trong JSON cho trình duyệt hoặc lưu vào localStorage. Trang `/account` xác thực lại qua API `/me`; `/api/auth/logout` xóa cookie và chuyển về `/login`.

Đăng xuất kết thúc phiên tại trình duyệt. JWT đã phát vẫn có thể dùng qua Bearer API đến khi hết hạn; chưa có refresh token hoặc cơ chế thu hồi từng token. Không thêm bảng/cột để quản lý phiên ngoài thiết kế hiện tại. Các giới hạn thử đăng nhập đang áp dụng trong từng instance; khi triển khai nhiều instance cần cấu hình giới hạn dùng chung ở hạ tầng phù hợp.

### Hủy yêu cầu và lỗi kết nối khi debug

Các endpoint đăng ký, đăng nhập và `/me` truyền cancellation token của request xuống EF Core. Khi client đóng kết nối hoặc frontend hết thời gian chờ, truy vấn có thể ném `TaskCanceledException`/`OperationCanceledException`; API xử lý trường hợp request đã bị hủy bằng trạng thái `499`, không coi là sai mật khẩu và không cấp JWT. Nếu thao tác CSDL bị hủy khi request vẫn còn hiệu lực, API trả `503` như các lỗi SQL khác.

Log `Microsoft.EntityFrameworkCore.Database.Connection[20004]` chỉ cho biết thao tác kết nối thất bại; cần đọc exception đi kèm để phân biệt request bị hủy, hết thời gian chờ, lỗi xác thực Windows hoặc server không truy cập được. Không đổi connection string chỉ dựa trên mã log này.

Frontend chờ backend tối đa 120 giây trong Development để có thời gian bước qua breakpoint của Visual Studio; production dùng 30 giây, lớn hơn ngân sách kết nối SQL 5 giây cộng hai lệnh SQL tối đa 10 giây/lệnh. Khi dừng debug quá lâu, request vẫn có thể bị hủy; tiếp tục chạy API rồi gửi lại yêu cầu. Không cần bỏ cancellation token hoặc tắt kiểm tra lỗi SQL.

## Kiểm thử

Kiểm thử unit/model có thể chạy bằng `dotnet test EnglishLearningSystem.sln --configuration Release`. Để chạy thêm kiểm thử API và đối chiếu schema trên SQL Server, tạo CSDL ở trên trước rồi đặt biến môi trường:

```powershell
$env:ENGLISHLEARNING_TEST_CONNECTION_STRING = 'Server=MSI\MSSQLSERVER01;Database=EnglishLearningDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5'
dotnet test EnglishLearningSystem.sln --configuration Release
```

Các kiểm thử tích hợp chạy trong transaction riêng và rollback sau mỗi test. Nếu không đặt biến môi trường, chúng được báo skipped; các kiểm thử còn lại vẫn chạy bình thường.

## Admin tạo và biên soạn khóa học

Các API `/api/v1/admin/*` yêu cầu JWT role `admin` **và** kiểm tra lại Users.Role/IsActive trong database. Tài khoản thường hoặc admin đã bị hạ quyền trả `403`; tài khoản không hoạt động trả `401`. Không thêm bảng/cột hoặc seed dữ liệu. Riêng loại Grammar cần mở rộng ràng buộc bằng script 003 như hướng dẫn bên dưới.

| API | Chức năng |
|---|---|
| `GET /api/v1/admin/courses?search=&page=1&pageSize=12` | Danh sách khóa học hệ thống, gồm bản nháp và đã xuất bản |
| `POST /api/v1/admin/courses` | Tạo nháp với Title, Description, CoverImageUrl, DifficultyLevel, EstimatedMinutes, Skills (`speaking`/`listening`/`reading`/`writing`/`grammar`) |
| `GET /api/v1/admin/courses/{id}` | Nội dung biên soạn, gồm các bài học và JSON đã giải mã |
| `PUT /api/v1/admin/courses/{id}` | Lưu tên, mô tả, ảnh bìa bản nháp |
| `POST /api/v1/admin/courses/{id}/lessons` | Thêm bài Speaking/Listening/Reading/Writing/Grammar |
| `PUT /api/v1/admin/courses/{id}/lessons/{lessonId}` | Lưu bài học thuộc đúng khóa học |
| `POST /api/v1/admin/courses/{id}/publish` | Kiểm tra và bật hiển thị khóa học |
| `POST /api/v1/admin/courses/{id}/hide` | Ẩn khóa học với học viên; giữ nội dung và tiến độ |
| `POST /api/v1/admin/uploads` | Multipart `file` + `kind=cover/audio`; trả URL dùng trong frontend |
| `POST /api/v1/admin/pronunciation/ipa` | Tạo IPA Mỹ từ `{ "text": "câu tiếng Anh" }`, tối đa 1000 ký tự; không lưu dữ liệu |
| `GET /api/v1/media/{fileName}` | Đọc ảnh/audio, hỗ trợ Range/206; cần JWT và quyền đọc nội dung |

Tạo khóa học luôn đặt SourceType=system, CreatedBy từ JWT, IsPublished=false; không lấy các giá trị này từ client. Mỗi kỹ năng được chọn khởi tạo một Lesson trống với cấp độ/thời lượng mặc định, vì schema lưu CEFR, thời lượng và kỹ năng ở Lessons. Tiếp tục chỉnh riêng từng bài ở bước 2. Các request ghi dùng transaction. Admin được sửa cả khóa học đang hiển thị; nội dung ứng viên phải vượt qua cùng kiểm tra xuất bản trước khi lưu. Khóa đang ẩn được lưu nháp chưa hoàn chỉnh. Không chỉnh nội dung user_upload bằng các API quản trị khóa học hệ thống.

`Lessons.Content` lưu JSON version 1 `{ version, speaking, listening, grammar }`. Speaking gồm `goals`, `sentences[{text,ipa,audioUrl}]`. Listening gồm `transcript`, `hideTranscriptFirstListen`, `questions[]` hỗ trợ multiple_choice (options/correctOptionIndex), fill_blank (prompt có [blank]/answer/caseSensitive) và matching (pairs left/right); mỗi câu có explanation/atSeconds tùy chọn. Audio chính lưu ở Lessons.AudioUrl. Bản nháp được phép chưa có câu/audio; xuất bản yêu cầu mô tả, ảnh bìa và ít nhất một bài active hoàn chỉnh. Audio Listening, transcript và câu hỏi phải đủ; Speaking phải có câu luyện nói. Chưa có TTS AI hoặc chấm điểm phát âm. API học viên hiện chỉ trả tóm tắt bài học, không trả JSON đáp án quản trị.

IPA được sinh offline từ 125.927 mục từ Mỹ của ipa-dict/CMUdict, đóng gói trong assembly (không cần Python/API key hoặc kết nối Internet). API trả `ipa`, `accent: en-US`, `unknownWords`, `alternatives`. Mặc định chọn cách đọc đầu tiên; đây là phiên âm theo từ, chưa phân biệt nghĩa/ngữ cảnh hoặc nối âm cả câu. Từ chưa biết, số và ký hiệu không hỗ trợ trả `ipa: null` và danh sách cần kiểm tra, không trả câu phiên âm bị thiếu. Khi lưu Speaking, backend tự điền IPA còn trống nếu tra được toàn bộ câu; giữ nguyên bản sửa thủ công. IPA tối đa 8000 ký tự trong JSON hiện có, không thay đổi schema. Nguồn dữ liệu, checksum và giấy phép ở `EnglishLearning.Api/Resources/Pronunciation/README.md`. Tests bao gồm câu thường, contractions, từ ghép, nhiều cách đọc, input bounds, unknown words, quyền admin bị thu hồi và lưu/tải lại IPA.

Upload ảnh tối đa 5 MB (JPG/PNG/WebP), audio tối đa 25 MB (MP3/WAV/AAC/M4A). Server kiểm tra extension/MIME/magic và số byte thực tế, đổi tên GUID, ghi Cloudinary `authenticated` cùng manifest; không dùng tên tệp client làm đường dẫn. `App_Data/uploads` và `MediaStorage:RootPath` chỉ còn cho đường đọc legacy; giữ dữ liệu cũ tới bước migrate/verify và khoảng rollback. Tệp nháp chỉ admin đọc; học viên chỉ đọc tham chiếu media thực của khóa học đã publish mà họ có quyền xem. Chưa tự xóa asset runtime không còn được dùng; orphan phải đối soát theo kế hoạch.

Kiểm thử `CourseAuthoringTests.cs` bao gồm quyền Admin, role bị thu hồi, nháp → Speaking/Listening → xuất bản, validation, truy cập bài thuộc khóa khác, định dạng upload và HTTP Range. Tất cả dữ liệu SQL dùng transaction rollback; tệp kiểm thử nằm trong thư mục temp riêng và được dọn sau test.

## Danh sách khóa học

- `GET /api/v1/courses`: danh sách có phân trang. Query: `search` (tên/mô tả, tối đa 200 ký tự), `level` (A1–C2), `skill` (speaking/writing/listening/reading/grammar), `source` (system/user_upload), `status` (all/in_progress/completed/not_started), `sort` (updated/newest/popular/title), `page` (1–10000), `pageSize` (1–24, mặc định 6). Query không hợp lệ trả `400`.
- Response có `items`, `totalCount`, `page`, `pageSize`, `totalPages` và `summary` tổng khóa học/đang học/hoàn thành trước khi áp dụng bộ lọc. Trang vượt phạm vi trả danh sách trống. Sort luôn có CourseId để giữ thứ tự ổn định khi các giá trị bằng nhau.
- `GET /api/v1/courses/{courseId}`: thông tin khóa học và danh sách bài học đang hoạt động, sắp theo OrderIndex rồi LessonId. Không trả nội dung bài học hoặc dữ liệu học viên khác.
- Cả hai API yêu cầu JWT của tài khoản còn hoạt động (`401` khi thiếu/hết hạn/vô hiệu hóa), trả `Cache-Control: no-store`. Chỉ trả khóa học đã xuất bản: khóa học hệ thống và khóa học `user_upload` do chính người đăng nhập tạo. Khóa học nháp, khóa học của người khác hoặc ID không tồn tại trả `404` ở endpoint chi tiết. Database lỗi/timed out trả `503`; request bị hủy trả `499`.
- Dùng nguyên schema Courses, Lessons, UserCourses, Users trong `DATABASE_SCHEMA.md`; không thêm cột, migration hay seed. Cấp độ/kỹ năng/số bài/thời lượng tổng hợp từ Lessons.IsActive. Khi lọc đồng thời cấp độ và kỹ năng, phải có một bài học thỏa cả hai. `TimedLessonCount` cho biết số bài đã có thời lượng. `popular` đếm lượt tham gia có Status khác abandoned. ProgressPercent/Status chỉ lấy bản ghi UserCourses của người đăng nhập.
- Database chưa có dữ liệu sẽ trả `200` với items trống. Không tạo số liệu đánh giá sao, giá hoặc gia sư AI từ giao diện mẫu. Chưa triển khai API đăng ký học, học bài, bookmark hoặc tạo khóa học AI trong phạm vi danh sách này.
- Kiểm thử trong `CourseCatalogTests.cs` dùng SQL Server thật trong transaction và rollback khi kết thúc; chạy cùng nhóm `RegistrationSqlServerTests` với biến `ENGLISHLEARNING_TEST_CONNECTION_STRING` như hướng dẫn trên.

## Bài học Grammar

Áp dụng `database/003_add_grammar_lesson_type.sql` sau hai script trước khi triển khai phiên bản hỗ trợ Grammar. Script chỉ mở rộng `CK_Lessons_SkillType` thêm `grammar`, có transaction và kiểm tra định nghĩa trước khi sửa; chạy lại được. Không thêm bảng/cột, không sửa dữ liệu bài học, không tự chạy lúc API khởi động. Database local `EnglishLearningDB` đã được cập nhật ngày 2026-10-22.

## Luyện phiên dịch

Sau khi áp dụng `004_add_translation_practice.sql`, rà soát rồi nhập [bộ 90 câu khởi đầu](course-data/translation-practice-starter.json). Lệnh nhập dùng connection string của môi trường đang chạy. Chạy từ gốc kho mã.

```powershell
$starterPath = (Resolve-Path 'backend/course-data/translation-practice-starter.json').Path
dotnet run --project backend/EnglishLearning.Api -- --translation-command=import "--translation-file=$starterPath"
```

Mở **Luyện phiên dịch** trong menu sau khi đăng nhập. Kho SQL phục vụ đề và xác nhận câu khớp đáp án đã duyệt. Để chấm cách dịch mới hoặc yêu cầu chấm chi tiết trên máy local, chạy lệnh sau từ gốc kho mã.

```powershell
.\backend\scripts\Set-TranslationAiSecrets.ps1
```

Dán key từ Google AI Studio tại lời nhắc ẩn. Script lưu provider `Gemini`, key và model `gemini-3.5-flash-lite` trong User Secrets của backend. Để chọn model khác, truyền `-Model` với ID của model Gemini. Sau đó khởi động lại backend ở chế độ Development. [Tài liệu Gemini](https://ai.google.dev/gemini-api/docs/models?hl=en)

Khi triển khai với Gemini, đặt `TranslationAi__Provider=Gemini` và `TranslationAi__ApiKey` trong môi trường backend. Backend cũng đọc `GEMINI_API_KEY` hoặc `GOOGLE_API_KEY` nếu chưa đặt `TranslationAi__ApiKey`. Có thể ghi đè model bằng `TranslationAi__Model`. Backend gọi Gemini `generateContent` tại Google, không cần đặt endpoint thủ công. [Tài liệu Gemini Generate Content](https://ai.google.dev/gemini-api/docs/generate-content/text-generation?hl=en)

Để dùng nhà cung cấp tương thích Chat Completions, truyền `-Provider ChatCompletions -Model <model-id>` và thêm `-Endpoint <url>` nếu dùng endpoint khác OpenAI. Khi triển khai, đặt `TranslationAi__Provider=ChatCompletions` cùng các thông số tương ứng. Model và endpoint Chat Completions đã lưu trước đây vẫn dùng được nếu chưa chỉ định provider và model không phải Gemini.

`TranslationPractice:CooldownDays` mặc định 7 ngày. `TranslationAi:GradeCallsPerDay` mặc định 300 lượt mỗi ngày UTC cho từng tiến trình API. Mỗi lần gọi lệnh `generate` sinh tối đa 10 đề và dùng một lượt riêng. Có thể đặt `TranslationAi:GenerationApiKey` và `TranslationAi:GenerationModel` cho công việc sinh đề. Với nhiều instance API, cấu hình chung kho khóa ASP.NET Data Protection để các instance đọc được mã lượt. Cache chống gửi trùng hoạt động trong từng tiến trình trong 5 phút.

```powershell
$draftPath = Join-Path (Resolve-Path 'reports').Path 'translation-a2-draft.json'
dotnet run --project backend/EnglishLearning.Api -- --translation-command=generate --translation-level=A2 '--translation-topic=Giao thông' --translation-count=5 "--translation-file=$draftPath"
dotnet run --project backend/EnglishLearning.Api -- --translation-command=import "--translation-file=$draftPath"

dotnet run --project backend/EnglishLearning.Api -- --translation-command=list-pending
dotnet run --project backend/EnglishLearning.Api -- --translation-command=approve --translation-answer-id=123
dotnet run --project backend/EnglishLearning.Api -- --translation-command=reject --translation-answer-id=124
```

Rà soát JSON giữa bước `generate` và `import`. `list-pending` trả tối đa 50 bản dịch chưa duyệt. Truyền `--translation-after` bằng ID cuối của trang trước để đọc tiếp. `replace` dùng file chứa một đề và `--translation-prompt-id` để tạo bản mới giữ nguyên mã chống lặp. `block` dùng `--translation-prompt-id` để dừng phát và chấm một bản đề.

Các API tạo/sửa bài hiện có nhận `skillType: "grammar"` và `grammar: { topic, rules, commonMistakes, questions }`; các nội dung của loại khác và `audioUrl` phải là null. API tạo khóa học nhận Skills gồm Speaking, Listening, Reading, Writing, Grammar (1–5 loại, không trùng). Nội dung Grammar nằm trong Lessons.Content JSON version 1; các bài Speaking/Listening cũ vẫn đọc được.

Grammar có tối đa 30 câu hỏi với `type` là `multiple_choice`, `fill_blank`, `error_correction`. Mỗi câu có prompt, explanation và tag. Trắc nghiệm/sửa lỗi có 2–4 options và correctOptionIndex; sửa lỗi cần correction. Điền từ cần `[blank]`, answer, acceptedAnswers (tối đa 10 đáp án thay thế) và caseSensitive. Backend kiểm tra null, độ dài, số lựa chọn và chỉ số đáp án. Có thể lưu lý thuyết trống khi còn nháp; xuất bản cần topic, rules và ít nhất một câu hỏi hợp lệ. Chỉ Admin còn hoạt động được ghi; bài thuộc khóa đang hiển thị được chỉnh sửa nếu nội dung sau sửa vẫn đáp ứng điều kiện xuất bản.

Danh sách/chi tiết khóa học hiển thị loại Grammar; `GET /api/v1/courses?skill=grammar` lọc khóa học có bài Grammar active. API học viên vẫn chỉ trả tóm tắt bài, không lộ đáp án quản trị. Chưa triển khai lưu điểm/bài nộp Grammar hay ErrorLogs cho học viên. `GrammarAuthoringTests.cs` kiểm tra migration chạy lại trong transaction rollback, khởi tạo/thêm/sửa, validation, xuất bản, lọc khóa học và quyền ghi; không để lại dữ liệu kiểm thử.

## Bài học Writing và Reading

Đã hỗ trợ biên soạn đủ 5 loại Speaking, Listening, Reading, Writing và Grammar. `writing`/`reading` đã nằm trong CHECK Lessons.SkillType; chức năng này chỉ mở rộng DTO và JSON Lessons.Content, không có migration hay thay đổi schema mới. Skills lúc tạo khóa học nhận 1–5 loại không trùng. Các API POST/PUT lessons dùng chung và kiểm tra quyền Admin hiện tại trong database như trước.

Writing: `writing: { taskType, topic, prompt, instructions, minWords, maxWords, sampleAnswer, rubric }`. TaskType nhận essay/email/paragraph/report/proposal. Topic là chủ đề riêng, tối đa 255 ký tự; bài cũ không có topic vẫn đọc được. MinWords/MaxWords từ 1–5000 và min ≤ max. Rubric tối đa 8 tiêu chí `{name,description,weight}`; khi có tiêu chí, tổng weight phải bằng 100. Có thể lưu nháp chưa có đề hoặc rubric; xuất bản cần đề bài và ít nhất một tiêu chí, tổng trọng số 100%. Bài mẫu không bắt buộc. Xem trước nhập bài thử và kiểm tra số từ; chưa có chấm điểm/nhận xét AI hoặc lưu bài nộp học viên.

Reading: `reading: { passageTitle, category, imageUrl, imageAlt, imageCaption, passage, translation, instructions, vocabulary, questions }`. Category tối đa 255 ký tự; passage/translation tối đa 30000 ký tự mỗi trường, translation là bản dịch admin nhập tùy chọn. Vocabulary tối đa 30 mục `{word,meaning,example}`. Questions tối đa 30, hỗ trợ multiple_choice (options/correctOptionIndex), fill_blank (prompt có [blank], answer, acceptedAnswers, caseSensitive), short_answer (answer, acceptedAnswers, caseSensitive; không yêu cầu [blank]), true_false_not_given (answer true/false/not_given), matching (pairs left/right). Mỗi câu có focus (skimming/scanning/inference/vocabulary, mặc định scanning) và points (0.1–10, mặc định 1), explanation/reference cho dẫn chứng. Xuất bản cần bài đọc và ít nhất một câu hỏi. Preview hiển thị [blank] thành dấu chấm, giữ nguyên marker trong bản biên soạn và JSON lưu trữ.

Ảnh Reading là tùy chọn: `imageUrl` tối đa 500 ký tự (MediaUrl như ảnh bìa), `imageAlt` tối đa 500, `imageCaption` tối đa 1000. Tải JPG/PNG/WebP tối đa 5 MB qua API uploads hiện có với `kind=cover`; ảnh dùng URL `/api/media/<guid>.<ext>`. Xuất bản hoặc sửa bài đang hiển thị kiểm tra ảnh managed tồn tại và đúng loại image. Quyền đọc ảnh yêu cầu tham chiếu chính xác trong nội dung Reading version 1 của bài đang kích hoạt, thuộc khóa học được phép xem; URL chỉ xuất hiện trong văn bản không cấp quyền đọc. Bài cũ không có ảnh vẫn tương thích, không đổi schema.

Mỗi bài chỉ được gửi đúng một nội dung tương ứng skillType; audioUrl của Reading/Writing phải null. GET quản trị trả nội dung Reading/Writing đã lưu; API danh mục/chi tiết học viên chỉ trả tóm tắt và hỗ trợ lọc skill=reading/writing, không lộ đáp án/bài mẫu/rubric qua danh mục. `ReadingWritingAuthoringTests.cs` kiểm tra khởi tạo 5 loại, thêm vào khóa hiện có, save/reload/publish/filter, validation, giới hạn từ/trọng số, quyền ghi và isolation giữa khóa học. Dữ liệu test được rollback. `ReadingWritingDemoTests.cs` kiểm tra các trường của demo mới, short_answer, validation điểm/kỹ năng và tương thích JSON version 1 cũ.

Writing/Reading hỗ trợ định dạng Markdown giới hạn: tiêu đề H2/H3, đậm, nghiêng, gạch chân (++), tô sáng (==), danh sách, trích dẫn và inline code. HTML/links/embeds không được thực thi. Frontend Reading mô phỏng chia đôi màn hình, chú giải từ vựng tại chỗ, song ngữ từ bản dịch nhập sẵn và Review tiến độ kiểm tra. Chưa kết nối dịch vụ chấm bài, dịch tự động hoặc sinh câu hỏi AI.

## Kiểm tra build

```powershell
dotnet build EnglishLearningSystem.sln
```

Câu trắc nghiệm Reading/Listening/Grammar (và chọn phần sai của Grammar) có 2–4 lựa chọn không trống, mỗi lựa chọn tối đa 500 ký tự và một correctOptionIndex hợp lệ. API từ chối ít hơn 2 hoặc nhiều hơn 4 lựa chọn. Không thay đổi schema database.

## Học viên luyện nghe và nộp bài

Tiền tố: `/api/v1/courses/{courseId}/lessons/{lessonId}/listening`. Các endpoint yêu cầu JWT và tài khoản còn hoạt động, khóa học đã xuất bản, bài Listening active thuộc đúng khóa. Khóa cá nhân chỉ chủ sở hữu được truy cập, cùng quy tắc catalog/media. Kết quả luôn lọc theo user trong JWT.

| Method | Hậu tố | Chức năng |
|---|---|---|
| GET | (trống) | Nội dung đã loại đáp án, mốc nghe, tiến độ nghe, điểm gần nhất và vị trí gần nhất. Không ghi DB. |
| POST | `/start` | Tạo đăng ký nếu chưa có, tiếp tục đăng ký abandoned, cập nhật bài đang học. Gọi lại không tạo đăng ký trùng. |
| PUT | `/position` | Lưu `{ positionSeconds }` từ 0–86400. Bỏ qua request trễ từ bài khác. |
| GET | `/transcript` | Transcript phục vụ luyện tập; UI điều khiển thời điểm mở. |
| POST | `/submissions` | Nhận contentVersion, answers, timeSpentSeconds; backend chấm và lưu kết quả. |
| GET | `/results?page=1&pageSize=10` | Lịch sử điểm của chính học viên, pageSize tối đa 50. |
| GET | `/results/{resultId}` | Điểm và ảnh chụp chi tiết câu sai đã lưu. |

Submission có `answers: [{questionId, optionIndex?, text?, matches: [{leftIndex, rightId}]}]`, questionId/leftIndex bắt đầu từ 0. Chỉ gửi trường phù hợp dạng câu. Câu thiếu/bỏ trống tính sai; câu trùng, câu lạ, lựa chọn sai phạm vi hoặc token nối ý giả trả 400. ContentVersion không khớp trả 409. Body tối đa 128 KiB.

Trắc nghiệm chấm theo chỉ số đáp án, điền từ chuẩn hóa Unicode + trim và tôn trọng caseSensitive, nối ý chấm toàn bộ nhóm. Điểm = số câu đúng / tổng câu × 100, làm tròn 2 chữ số. Không nhận điểm/tổng câu đúng từ client. Thời gian do client gửi chỉ dùng thống kê luyện tập, không dùng kiểm soát thi.

`ListeningGradingService` tạo mã lựa chọn nối ý bằng ASP.NET Core Data Protection, ràng buộc theo lesson/câu, và xáo thứ tự vế phải. DTO làm bài không có answer/correctOptionIndex/explanation/transcript hoặc cặp nối đúng. Khi triển khai nhiều instance, các instance cần dùng chung Data Protection key ring và application identity để giải mã cùng mã lựa chọn.

Lưu vào `ExerciseResults` hiện có; `WrongAnswersJson` version 1 chỉ chứa ảnh chụp câu sai/bỏ trống. Phản hồi nộp bài có chữa đủ câu, lịch sử sau reload chỉ trả chi tiết câu sai đã lưu. `UserCourses` dùng cho vào học và `LearningProgress` dùng vị trí gần nhất theo khóa. Ghi kết quả/cập nhật tiến độ trong transaction; start xử lý tranh chấp UNIQUE bằng transaction Serializable và retry giới hạn. Không đổi entity, mapping hoặc schema SQL.

Tiến độ nghe được tính từ các LessonId Listening đã có kết quả của học viên, không đếm lần nộp lặp. `GET /courses/{id}` bổ sung listeningProgress và listeningStatus cho từng bài; tiến độ toàn khóa trong UserCourses giữ quy tắc hiện có. Chưa có lưu nháp câu trả lời nhiều thiết bị hoặc khóa chống nộp trùng bền vững.

Kiểm thử mới: `ListeningGradingTests.cs` và `ListeningPracticeTests.cs`. Nhóm integration dùng SQL Server trong transaction rollback theo cấu hình kiểm thử ở trên. Kết quả kiểm tra và ảnh giao diện: `../reports/Bao_cao_Listening_User_2026-10-28.md`.

## Sửa và ẩn/hiện khóa học của Admin

Admin sửa thông tin chung, bài học và thêm bài mới qua các API PUT/POST lessons hiện có, bao gồm khóa đang hiển thị. IsPublished không tự đổi khi lưu. Với khóa đang hiển thị, API kiểm tra mô tả, ảnh bìa/media và tất cả bài active trên nội dung ứng viên trước khi persist; lỗi 400 giữ nguyên dữ liệu đã lưu. Không thể tắt bài active cuối cùng. Muốn soạn nội dung dở dang, ẩn khóa trước.

POST `/api/v1/admin/courses/{id}/hide` đặt Courses.IsPublished=false; POST `.../{id}/publish` kiểm tra và đặt true. Cả hai idempotent, yêu cầu role admin hiện tại trong SQL và chỉ quản lý SourceType=system. Không thay đổi schema/migration. IsPublished=false bao gồm bản nháp và khóa bị ẩn; không tạo trạng thái lịch sử xuất bản riêng.

Khóa ẩn vắng khỏi catalog/summary, chi tiết và luồng luyện nghe trả 404; media được quản lý cũng bị chặn với học viên. Admin vẫn xem trước/chỉnh sửa được. Ẩn/hiện không xóa Lessons, UserCourses, LearningProgress hoặc ExerciseResults. Bài nghe sửa nội dung dùng contentVersion hiện có để từ chối bài nộp cũ 409. URL ngoài hệ thống không chịu quyền truy cập của media proxy.

`PublishedCourseManagementTests.cs` kiểm tra sửa đủ năm loại bài, cập nhật ứng viên bị từ chối không ghi dở, thêm bài, tắt bài cuối cùng, ẩn/hiện, quyền admin/user và phạm vi system, catalog/practice/media, giữ bài nộp/đăng ký học và phiên bản bài nghe. Các dữ liệu SQL trong kiểm thử được rollback.

## Speaking cho học viên

Đã bổ sung `/api/v1/speaking` để đọc bài luyện, nhận WAV và chỉ số câu, gọi dịch vụ Python, lưu `SpeakingAttempts` và xem lịch sử/audio riêng. Câu mẫu được lấy ở server từ nội dung bài đã xuất bản. Dùng schema hiện có; JSON chi tiết nằm trong `PhonemeScores`. Không chạy migration khi khởi động.

Dịch vụ mô hình mặc định ở `http://127.0.0.1:8001`, cấu hình bằng `SpeakingAi:BaseUrl`. Hướng dẫn chi tiết và giới hạn đánh giá ở `../SPEAKING.md`.
# Từ điển song ngữ và đọc nghĩa tiếng Việt

Endpoint `GET /api/v1/vocabulary?word=book&direction=en-vi` hỗ trợ ba giá trị direction `en-en`, `en-vi`, `vi-en`. Khi thiếu direction, mặc định `en-en`. Request cần tài khoản đang hoạt động. Dữ liệu cache song ngữ được lưu vào hai collection riêng, nguồn từ `https://dict.minhqnd.com/` và giữ metadata nguồn ở từng nghĩa.

Chuẩn bị hai collection bằng `dotnet run --project backend/EnglishLearning.Api -- --initialize-bilingual-vocabulary=true` từ repository root. Cấu hình tên nằm trong `MongoDbSettings:EnglishVietnameseCollectionName` và `MongoDbSettings:VietnameseEnglishCollectionName`.

Audio phát âm Anh–Anh dùng endpoint hiện tại. Audio nghĩa Việt dùng `POST /api/v1/vocabulary/definition-audio/prepare` với body `{ "word": "book", "direction": "en-vi", "definitionId": "<id nhận từ lookup>" }`. Backend đối chiếu ID với nghĩa, tạo TTS theo yêu cầu rồi lưu Cloudinary. Response cung cấp playbackUrl qua proxy frontend. GET `/api/v1/vocabulary/definition-audio?key=<audioKey>` chỉ đọc asset đã chuẩn bị và hỗ trợ Range.

TTS mặc định tắt để nghiệm thu chất lượng giọng. Sau khi nghe đánh giá mẫu và đối chiếu điều kiện lưu media, bật bằng biến môi trường `DefinitionAudioSettings__Enabled=true` cùng cấu hình Cloudinary hợp lệ, rồi khởi động lại backend. `MaxTextLength`, `VoiceProfile`, giới hạn byte, thời lượng, deadline, số tác vụ và hạn mức tài khoản cấu hình trong `DefinitionAudioSettings`. Kiểm tra server xác nhận MIME, kích thước, chuỗi khung MPEG Layer III và thời lượng. Trình duyệt xử lý giải mã và phản hồi lỗi phát. Đánh giá nghe xác nhận độ chính xác đọc nội dung.

Kiểm thử liên quan nằm trong `BilingualVocabularyTests`, `BilingualHttpTests`, `DefinitionAudioTests`, `DefinitionAudioCloudTests` và `BilingualLiveTests`. Test nguồn thật bật bằng `ENGLISHLEARNING_RUN_LIVE_BILINGUAL_TEST=1`. Test MongoDB bật bằng `ENGLISHLEARNING_TEST_MONGODB_CONNECTION_STRING`, dùng database kết thúc bằng `Tests` và collection có prefix test. Test giao diện `frontend/tests/bilingual-dictionary.mjs` dùng Playwright, hỗ trợ `PLAYWRIGHT_MODULE_PATH` và `VOCABULARY_TEST_BASE_URL`.
