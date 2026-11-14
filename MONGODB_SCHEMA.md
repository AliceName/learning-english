# MongoDB — thiết kế dữ liệu từ điển

## Mở rộng song ngữ ngày 07/11/2026

Người dùng đã yêu cầu thực hiện chức năng theo `reports/Thiet_ke_du_lieu_API_tu_dien_song_ngu_2026-11-07.md`. Collection Anh–Anh tiếp tục dùng hợp đồng hiện có ở các mục bên dưới.

| Hướng | Collection mặc định | Cấu hình | Prefix khóa | language | Ngôn ngữ nghĩa |
|---|---|---|---|---|---|
| Anh–Anh | `VocabularyEntries` | `VocabularyCollectionName` | `en:` | `en` | `en` |
| Anh–Việt | `VocabularyEntriesEnVi` | `EnglishVietnameseCollectionName` | `en:` | `en` | `vi` |
| Việt–Anh | `VocabularyEntriesViEn` | `VietnameseEnglishCollectionName` | `vi:` | `vi` | `en` |

Hai collection mới dùng năm field root `_id`, `language`, `normalizedWord`, `entries`, `fetchedAtUtc`. Tên ba collection được kiểm tra khác nhau. Validator riêng nằm trong `Resources/Vocabulary/schema-en-vi.json` và `schema-vi-en.json`. Các nghĩa song ngữ bắt buộc có `definitionLanguage` phù hợp và `sourceMetadata.provider=minhqnd`.

Entry dùng lại cấu trúc word/phonetics/meanings/definitions. Phần mở rộng song ngữ gồm `phonetics[].region`, `definitions[].definitionLanguage`, `definitions[].sourceMetadata` và `entry.providerMetadata`. Metadata nghĩa giữ tên nguồn, giấy phép đã xác nhận nếu có, loại từ gốc, loại từ phụ và links. Provider metadata giữ ngôn ngữ result, đường dẫn TTS nguồn, translations đã lọc ngôn ngữ đích và relations. Nguồn mới được ánh xạ BSON có cấu trúc. Định danh nghĩa, khả năng đọc TTS và hướng tra ở response được tính khi đọc.

Chuẩn hóa song ngữ dùng Unicode Form C, chữ thường invariant, dấu cách đơn giữa từ, hỗ trợ đầy đủ chữ tiếng Việt và dấu kết hợp. Giới hạn 300 đơn vị UTF-16 trước chuẩn hóa, 100 sau chuẩn hóa. Truy vấn khác dấu hoặc khác cách đặt dấu vẫn có khóa riêng. Cách chuẩn hóa và khóa Anh–Anh hiện tại tiếp tục được dùng cho dữ liệu cũ.

Cache và gộp request phân biệt hướng tra. Ba hướng chia sẻ hạn mức tài khoản và semaphore gọi nguồn. Đọc equality theo `_id`, ghi `$setOnInsert`, sửa document hỏng bằng compare-and-swap và xử lý `isPersisted=false` dùng cùng logic repository hiện có. Mỗi instance có single-flight, unique `_id` xử lý cạnh tranh ghi nhiều instance.

Cấp phát hai collection mới bằng lệnh tường minh từ repository root

```powershell
dotnet run --project backend/EnglishLearning.Api -- --initialize-bilingual-vocabulary=true
```

Audio nghĩa chỉ tạo khi bấm nghe và lưu qua kho Cloudinary hiện tại, với provider attribution `minhqnd-tts`, `synthetic=true`, locale `vi` và phiên bản cấu hình giọng. Khóa là SHA-256 của phiên bản request, provider, ngôn ngữ, voice profile và chính nội dung gửi đọc. Manifest và binary thuộc hợp đồng media hiện có. `DefinitionAudioSettings.Enabled` mặc định false trong thời gian nghiệm thu giọng đọc.

## Hợp đồng Anh–Anh hiện có

Phạm vi được người dùng cho phép triển khai ngày **26/10/2026** qua yêu cầu thực hiện theo `reports/Ke_hoach_tra_cuu_tu_vung_MongoDB.md`. MongoDB lưu kết quả từ điển dùng chung; SQL Server giữ nguyên schema hiện có. Không thêm dữ liệu tài khoản, lịch sử tìm kiếm, bookmark hoặc flashcard vào collection này.

## Database và collection

- Database: `MongoDbSettings.DatabaseName` của môi trường triển khai.
- Collection: `MongoDbSettings.VocabularyCollectionName`, mặc định `VocabularyEntries`.
- Một document cho một truy vấn tiếng Anh đã chuẩn hóa, collection chưa shard.
- Index duy nhất hiện cần là unique `_id` mặc định. Không tạo index trên entries hoặc thêm unique index normalizedWord trùng mục đích.

| Field | BSON type | Bắt buộc | Quy tắc |
|---|---|---|---|
| `_id` | string | Có | `en:` + normalizedWord; tối đa 103 ký tự |
| `language` | string | Có | `en` |
| `normalizedWord` | string | Có | 1–100 ký tự sau trim, Unicode Form C, chữ thường invariant; chữ cái Latin, nháy/gạch nối giữa các nhóm chữ |
| `entries` | array of objects | Có | Không rỗng; giữ đủ các entry và metadata nguồn hợp lệ |
| `fetchedAtUtc` | date | Có | Thời điểm lấy nguồn thành công, BSON date UTC chính xác mili giây; response lần đầu dùng cùng độ chính xác, không cập nhật khi cache hit |

Root chỉ cho phép 5 field này. `VocabularyEntryDocument.ToBson()` là ánh xạ persisted fields; DTO đầu ra và các thuộc tính tính toán C# không tạo field trong MongoDB.

Audio mới từ bước 3 (28/10/2026) cache trên Cloudinary: binary `video/authenticated` theo SHA-256 nội dung và manifest `raw/authenticated` theo định danh bản thu, giữ attribution/MIME/dung lượng. Từ bước 6, runtime mặc định cloud-only; cache `App_Data/dictionary-audio` cũ chỉ được đọc khi chủ động bật `Cloudinary:AllowLegacyReads=true` để rollback. Chưa xóa hoặc migrate file trong request. `entries[].phonetics[].audio/sourceUrl/license` gốc được giữ nguyên để truy nguồn và hỗ trợ từ đã có. Endpoint prepare tính `playbackUrl` ở DTO, không thêm field/index/collection MongoDB và không đổi SQL Server. Chi tiết ở `reports/Ke_hoach_Cloudinary_media_2026-10-27.md`.

Ngày 28/10/2026, CLI bước 5 đã migrate/verify 4 cache audio từ điển cũ lên Cloudinary, giữ nguyên key/hash/attribution. Toàn bộ byte JSON sidecar và audio gốc vẫn có trong nguồn local và backup migration; fingerprint tham chiếu MongoDB không đổi. Không thêm field hoặc index để thực hiện việc chuyển kho này.

## Cấu trúc entries

```text
entries[]
  word: string, bắt buộc và không chỉ khoảng trắng
  phonetic?: string | null
  origin?: string | null
  phonetics?: array | null
    text?: string | null
    audio?: string | null (URL; không lưu file/base64)
    sourceUrl?: string | null
    license?: {name?: string|null, url?: string|null} | null
  meanings[]: bắt buộc, không rỗng
    partOfSpeech: string, bắt buộc và không chỉ khoảng trắng
    definitions[]: bắt buộc, không rỗng
      definition: string, bắt buộc và không chỉ khoảng trắng
      example?: string | null
      synonyms?: string[] | null
      antonyms?: string[] | null
    synonyms?: string[] | null
    antonyms?: string[] | null
  license?: {name?: string|null, url?: string|null} | null
  sourceUrls?: string[] | null
```

Các field thêm của nhà cung cấp bên trong entry được giữ để không mất dữ liệu và metadata. Các trường tùy chọn không bị tự điền vào payload lưu; DTO hiển thị chuẩn hóa chúng thành null hoặc mảng rỗng. Payload lưu là BSON có cấu trúc, không phải chuỗi JSON, không có bản raw JSON lưu trùng.

## Validator và cấp phát

Nguồn validator duy nhất: `backend/EnglishLearning.Api/Resources/Vocabulary/schema.json`, được nhúng trong assembly. `MongoVocabularySchema` dùng `$jsonSchema`, `validationLevel=strict`, `validationAction=error`. Backend cũng kiểm tra cấu trúc và tính nhất quán `_id/language/normalizedWord` trước khi sử dụng document; validator prefix không tự bảo đảm được tương quan ba field.

Chạy lệnh tường minh từ repository root:

```powershell
dotnet run --project backend/EnglishLearning.Api -- --initialize-vocabulary=true
```

Lệnh tạo collection với validator nếu chưa có. Nếu đã có collection, nó kiểm tra dữ liệu cũ trước khi cập nhật validator; phát hiện bản ghi vi phạm thì dừng, không xóa hoặc tự sửa dữ liệu. Khởi động API thông thường không tạo collection, sửa validator hoặc chạy migration SQL.

## Quy tắc đọc, ghi và lỗi

1. Chuẩn hóa input trước khi tạo khóa. `Hello`, `HELLO`, ` hello ` cùng khóa `en:hello`. `play` và `played` là hai khóa riêng.
2. Đọc equality theo `_id`, tối đa một document; không dùng Count/Exists trước Find, regex, sort, join hoặc aggregation trong luồng tra chính xác.
3. Cache hit chỉ đọc. Cache miss gọi nguồn, kiểm tra payload tối đa 1 MiB rồi upsert `_id` với `$setOnInsert`.
4. Sau khi chèn mới được xác nhận, trả dữ liệu đã kiểm tra mà không đọc lại. Nếu khóa đã tồn tại hoặc duplicate-key, đọc và dùng bản hợp lệ đã lưu.
5. Bản cache hỏng được đọc như cache miss; sau khi lấy nguồn hợp lệ, thay thế bằng bộ lọc so sánh document cũ để không ghi đè một sửa chữa đồng thời.
6. Dữ liệu giữ lâu dài, không TTL. Không lưu phản hồi lỗi hoặc kết quả không tìm thấy thành mục từ.
7. Lỗi đọc MongoDB thì thử nguồn. Lỗi ghi mà nguồn thành công thì trả dữ liệu với `isPersisted=false`; không có tác vụ fire-and-forget hoặc lời hứa lưu bù.
8. Mỗi instance gộp các yêu cầu cùng từ; unique `_id` bảo vệ dữ liệu khi có nhiều instance, nhưng không bảo đảm chỉ một cuộc gọi nguồn trên toàn hệ thống.

## Kiểm chứng

Test MongoDB dùng database tên kết thúc bằng `Tests` và collection riêng `vocabulary_test_<guid>`. Chỉ dọn collection do test tạo. Test bao gồm cạnh tranh upsert, validator, sửa bản hỏng, đọc lại sau tạo repository mới, explain và benchmark 10.000/100.000 document.

Kết quả đo local được lưu tại `reports/Vocabulary_benchmark_2026-10-26.json`: 200 lượt đo sau warmup cho mỗi cỡ dữ liệu, tách thời gian DB và ánh xạ DTO; chưa bao gồm xác thực SQL, proxy hoặc mạng tới trình duyệt. Mọi thay đổi field/validator/index về sau phải được ghi rõ và kiểm tra dữ liệu cũ trước khi áp dụng.
