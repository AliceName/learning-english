# Luyện Speaking theo cụm — 2026-10-31

## Hành vi

- Mặc định luyện từng cụm khi API cung cấp metadata chia cụm. Chọn cụm trong câu đầy đủ; cụm đang luyện nổi bật, các cụm khác làm nhạt. Có nghe mẫu của đúng cụm, ghi/nghe lại, gửi chấm, xem màu và chuyển tiếp.
- Câu ≤6 từ có một cụm; câu dài chia 3–6 từ/cụm bằng quy tắc xác định, ưu tiên dấu câu và giới từ/liên từ. Không cắt bỏ hay đổi thứ tự từ; giữ dấu nháy, dấu câu và lưu vị trí từ. Phân hoạch tránh đuôi một/hai từ ở câu dài, có thể chưa trùng ranh giới ngữ nghĩa tốt nhất.
- `There is probably titanium in your eyeglass frames .` thành `There is probably titanium` / `in your eyeglass frames .`.
- Điểm, màu và bản ghi của một cụm chỉ áp dụng cho cụm đó. Chế độ cả câu vẫn có; không tổng hợp điểm cụm để giả lập kết quả đọc cả câu. Có tiến độ lượt theo cụm/câu và thông báo hoàn tất.
- Bản nháp được lưu riêng theo khóa câu/cụm/phiên bản trong bộ nhớ tab, giữ khi chuyển phần luyện hoặc lỗi gửi. Đóng/tải lại trang sẽ mất bản nháp. Lịch sử đã gửi có nhãn phạm vi, snapshot và mốc thời gian.
- So sánh chỉ cùng cụm/phạm vi/phiên bản/câu gốc, cùng model và cùng âm được hỗ trợ. Các bản ghi cần thu lại không được tính hoàn tất hoặc so sánh điểm.
- Tự dừng: RMS đủ rõ tích lũy ≥0,3 giây, bản ghi ≥1 giây, sau đó ≥1,5 giây yên lặng. Tiếng ngắn và im lặng đầu lượt không kết thúc ghi. Âm quay lại hoặc âm nền chưa rõ đặt lại khoảng chờ. Tắt tùy chọn để dừng thủ công; giới hạn cứng vẫn 12 giây. Không tự gửi bài khi dừng.
- Hủy trong lúc xin quyền/nạp module/resume cũng đóng tài nguyên, xử lý cả stream nhận được sau khi đã hủy. PCM được giữ sau tự dừng để encode; `finish()` dùng chung một promise để tránh mã hóa lặp.

Tự dừng là heuristic năng lượng, không nhận diện lời nói/đọc đủ câu. Ngắt cụm không phân loại CEFR. Điểm/gợi ý dùng mô hình hiện có; chưa có benchmark riêng chứng minh độ chính xác điểm cụm đối với người Việt.

## API và lưu trữ

`SpeakingLessonResponse` thêm `segments` (mảng cụm theo từng câu), `segmentationVersion`. Mỗi cụm có `index`, `text`, `startWordIndex`, `wordCount`.

POST `/api/v1/speaking/attempts`: multipart hiện có + `segmentIndex` tùy chọn. Backend chọn cụm từ nội dung server, giữ nguyên quyền khóa học/bài học, bỏ qua trường text từ client, từ chối chỉ số sai trước khi gọi bộ chấm. Không có `segmentIndex` là cả câu.

`SpeakingAttemptResponse` / JSON lưu trữ thêm scope tùy chọn: `kind=segment`, `segmentIndex`, `startWordIndex`, `wordCount`, `sentenceText`, `segmentationVersion`. Dùng lại cột `SpeakingAttempts.PhonemeScores`, JSON version 1. Không đổi Entity, mapping, migration, bảng/cột hay dữ liệu khóa học. Kết quả cũ không có scope vẫn là cả câu.

## Xác minh

- Frontend: `tsc --noEmit`, ESLint đạt; 43 kiểm thử đạt, 1 ca WAV→model tùy chọn bỏ qua. Bao gồm 15 ca detector/recorder (tự dừng, giới hạn, hủy startup, stream nhận muộn), 13 ca phạm vi/tiến độ/so sánh và 13 ca màu/phản hồi.
- Backend: 59 đạt, 40 ca tùy chọn bỏ qua trong suite thường. Chia cụm, bảo toàn từ/dấu câu, chỉ số, quyền, server-bound text, lưu/đọc JSON version1 và tương thích cả câu đều được kiểm tra.
- Live test riêng `SpeakingPhraseLiveTests`: 1/1 đạt. Câu bài học `We call it bear in the forest`, chọn cụm0; gửi WAV công khai thật “We call it bear” qua .NET→Python, kiểm tra kết quả hợp lệ, scope, metadata, audio và lịch sử InMemory. Không ghi SQL.
- Production build Next: đạt, tạo đủ 28 trang; API chính build đạt và đã khởi động lại.
- Runtime: API cổng5000 có trường `SegmentIndex` trong hợp đồng form; Python8001 ready với modelVersion `gop-ctc-mlp-68505cc756b1fbf8-ref2-470077d127db-cal1-f38fe9a705ac1e16`. Xem `runtime-check.json`.
- `git diff --check`: đạt.

UI fixture chạy `node scripts/preview-speaking.mjs --phrases`. Component, AudioWorklet và encoder thật; microphone được thay bằng nguồn WebAudio tổng hợp 0,65 giây rồi im lặng. Kết quả/fetch là giả lập và được gắn nhãn, không thu microphone thật, không tạo bản ghi trong tài khoản.

Các bước đã xác nhận trực tiếp trong trình duyệt: tự dừng tạo WAV, đổi cụm và quay lại giữ nháp, lỗi POST đầu vẫn giữ nháp rồi gửi lại thành công, kết quả/màu chỉ gồm từ trong cụm, lịch sử nhãn cụm, chuyển sang cả câu có tiến độ riêng 0/2, quay lại cụm giữ kết quả, luyện đủ 4/4 cụm qua 2 câu có thông báo hoàn tất. Ảnh `overview.jpg` là giao diện fixture đã luyện đủ bốn cụm.

Máy gặp thiếu bộ nhớ commit khi Roslyn/CoreCLR khởi động, không phải test assertion thất bại. Đã dừng fixture, tạm dừng đúng Python bộ chấm (~4,1 GB private), chạy build/test tuần tự với cache dependency hiện có rồi khởi động lại API và Python. Không lấy exit0 không có test count làm bằng chứng đạt. NuGet báo NU1900 do endpoint kiểm tra lỗ hổng không truy cập được; không thêm package mới.

Chạy kiểm thử .NET bằng một worker, tắt shared compiler và giới hạn heap riêng cho tiến trình trong lúc thiếu RAM. Ý nghĩa biến `DOTNET_gcServer` / `DOTNET_GCHeapHardLimit` theo [tài liệu Microsoft](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector). Cấu hình hệ điều hành không bị thay đổi; API đã nạp bản mới với giới hạn heap cho phiên chạy cục bộ này.
