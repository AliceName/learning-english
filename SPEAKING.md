# Speaking: ghi âm và chấm điểm trong LinguaAI

## Luyện cụm ngắn và tự dừng — 2026-10-31

Các bài mặc định mở **Đọc cả câu** để học viên đọc từ đầu đến cuối trong một bản ghi. Khi chọn **Luyện từng cụm**, giao diện dùng các cụm 3–6 từ do máy chủ tạo theo dấu câu và ranh giới giới từ hoặc liên từ. Câu không quá 6 từ giữ một cụm.

Chọn trực tiếp cụm trong câu, nghe giọng mẫu chậm/bình thường, ghi âm cụm rồi gửi chấm để xem màu và điểm riêng. Có cụm trước/tiếp, giữ bản nháp riêng cho từng cụm và cả câu, lịch sử ghi rõ Câu N · cụm M hoặc cả câu. Sau khi luyện các cụm có thể chọn **Đọc cả câu** để ôn lại; điểm cụm không được cộng/gộp thành điểm cả câu. Tiến độ và so sánh các lần luyện cũng tách theo phạm vi cụm/cả câu và phiên bản chia cụm.

Tùy chọn **Tự dừng sau khoảng 1,5 giây im lặng** mặc định tắt khi đọc cả câu và bật khi luyện từng cụm. Học viên có thể đổi tùy chọn này trong lượt luyện. Khi bật, tự dừng chỉ kích hoạt sau khi nhận đủ âm thanh. Microphone được đóng và WAV sẵn sàng để nghe lại trước khi gửi chấm. Mỗi lần ghi có giới hạn 12 giây.

API bài học trả `segments` theo từng câu và `segmentationVersion=phrase-v1`. POST bài nói có `segmentIndex` tùy chọn; bỏ trường này vẫn chấm cả câu như trước. Backend tự lấy cụm từ câu được phép học, không dùng văn bản do client gửi. Kết quả cụm có `scope` chứa chỉ số, vị trí từ, số từ, câu gốc snapshot và phiên bản; lưu trong JSON `PhonemeScores` version 1 hiện có. Không thay đổi schema hay dữ liệu bài học. Lịch sử cũ vẫn đọc được với scope null.

Đã chạy 59 kiểm thử backend đạt; 40 ca tùy chọn bỏ qua trong lần chạy thường. Live test riêng .NET → Python dùng WAV thật “We call it bear” làm cụm đầu của câu dài hơn: đạt, lưu/đọc scope và audio bằng InMemory, không ghi SQL. Frontend 43 ca đạt, 1 ca live tùy chọn bỏ qua; TypeScript/lint và production build đạt. Browser fixture dùng worklet/encoder thật với tín hiệu tổng hợp, đã kiểm tra tự dừng, bản nháp, gửi lại sau lỗi, bốn cụm hoàn tất và tách điểm cả câu. Xem [báo cáo triển khai cụm](backend/reports/speaking-phrase-practice/REPORT.md).

## Màu từng từ trong câu kết quả — 2026-10-31

Đã tách màu của toàn câu khỏi danh sách tối đa ba từ gợi ý. Mỗi từ được tô theo điểm âm thấp nhất và ngưỡng lưu cùng kết quả: xanh = điểm tốt (từ 1,50/2 ở cal1), vàng = nên nghe lại (1,10–<1,50), đỏ = ưu tiên luyện (<1,10), xám = chưa đủ dữ liệu. Màu xanh chỉ dùng khi toàn bộ từ được hỗ trợ; từ chỉ chấm được một phần có gạch dưới nét đứt, nếu điểm phần được chấm cao vẫn dùng màu xám thay vì khẳng định cả từ tốt. Các ngưỡng tùy biến/phiên bản cũ lấy từ metadata, có fallback hữu hạn và đúng thứ tự.

Chế độ `record_again` tô xám mọi từ và giữ cảnh báo ghi âm lại: chưa có căn cứ kết luận đúng/sai từ bản ghi chưa ổn định. Độ phủ toàn câu thấp vẫn cho phép xem màu các từ được hỗ trợ cùng ghi chú phạm vi. Có chú thích màu, tooltip điểm và nhãn đọc màn hình; dấu câu, từ lặp, dấu nháy thẳng/cong được giữ nguyên và ghép theo vị trí từ.

Đã kiểm tra 21 ca frontend đạt (một ca live tùy chọn bỏ qua), TypeScript/lint và build production đạt. Giao diện giả lập được kiểm tra cả normal, limited_coverage và record_again; ảnh/báo cáo tại `backend/reports/speaking-word-colors/`. Chạy xem thử bằng `node scripts/preview-speaking.mjs --word-colors` từ frontend; kết quả là dữ liệu giả lập, không lưu tài khoản.

## Trải nghiệm luyện tập theo câu

Giao diện có ba bước: nghe mẫu → thu/nghe lại → xem phản hồi. Có tốc độ mẫu chậm 0,75× / bình thường 1×, dừng nghe và chuyển câu trước/sau. Audio mẫu, bản ghi và giọng tổng hợp được dừng khi bắt đầu ghi; khi phát một nguồn âm, các nguồn còn lại được dừng để tránh chồng tiếng.

Bản nháp WAV giữ riêng theo câu trong tab hiện tại. Chuyển câu rồi quay lại vẫn nghe/gửi được bản nháp; lỗi quyền microphone, hủy mở mic, ghi quá ngắn hoặc chọn tệp không hợp lệ giữ bản ghi trước đó. Có nút hủy lần ghi và bỏ bản ghi tạm. URL audio tạm được thu hồi khi thay/bỏ bản ghi hoặc đóng component. Tải lại/đóng trang sẽ mất bản nháp chưa gửi; giao diện có thông báo điều này. Bản đã gửi thành công không hiển thị nút gửi lần nữa; có thể ghi mới để luyện lại.

Tiến độ “Lượt luyện này” tính các câu có kết quả được chấp nhận trong lần mở bài hiện tại; bản ghi `record_again` chưa được tính. Luyện đủ các câu có thông báo hoàn tất và nút bắt đầu lượt mới; lịch sử đã lưu được giữ nguyên. Không xem tiến độ lượt luyện là điểm đạt bài hay chứng nhận phát âm. Lịch sử hiển thị 20 lần gần nhất, có tải lại và xử lý lỗi riêng; kết quả vừa gửi được hợp nhất theo ID để không bị mất khi tải lại đồng thời.

Phản hồi có nút nghe giọng mẫu của từ và nghe đoạn bạn đọc quanh từ đó. Đoạn bản ghi sử dụng min/max timestamp của các âm được hỗ trợ, đệm 0,12 giây và giới hạn trong độ dài audio; đây là mốc ước lượng, có thể kèm âm bên cạnh. Có thể dừng đoạn hoặc nghe toàn bộ bản ghi. Điểm chi tiết từng từ/âm nằm trong mục mở rộng để người học thấy gợi ý luyện trước.

So sánh với lần luyện trước cùng câu chỉ hiển thị chênh lệch khi cùng `modelVersion`, cùng chuỗi âm/vị trí được hỗ trợ và cả hai bản ghi không cần thu lại. Khác phạm vi/phiên bản sẽ hiển thị lý do chưa so sánh. So sánh dùng lần trước gần nhất, không chọn điểm tốt nhất để đối chiếu. Bản ghi lịch sử có câu mẫu đã đổi vẫn xem được, nhưng không cho ghi lại trực tiếp từ phản hồi cũ.

Kiểm tra và ảnh bố cục: [báo cáo trải nghiệm luyện tập](backend/reports/speaking-practice-ux/REPORT.md). Bộ kiểm thử frontend có 12 ca khi bật WAV live, gồm bộ chấm thật; không ghi SQL. Giao diện tương tác được kiểm tra bằng fixture tách riêng, không tạo bản ghi trong tài khoản thật. Build production giới hạn hai worker do máy hết bộ nhớ khi tạo trang bằng 11 worker.

## Hiệu chỉnh điểm và phản hồi cal1

Đã chọn ngưỡng ưu tiên luyện 1,10/2 từ validation SpeechOcean762 được hỗ trợ, chia fold theo người nói. Giữ nguyên điểm MLP vì affine/isotonic làm tăng MAE validation. Trên phần test được hỗ trợ, ngưỡng ưu tiên mới giảm gợi ý nhầm 402 → 174 và tăng precision 66,80% → 77,08%, đồng thời giảm recall 40,92% → 29,59%. Đây là đánh đổi của gợi ý luyện tập, không phải tăng độ chính xác điểm số; vùng 1,10–<1,50 vẫn được gợi ý “nên nghe lại”. Chưa kiểm chứng riêng cho người Việt và các âm mới được ref2 mở rộng.

Kết quả hiển thị số âm đã chấm/tổng âm tham chiếu, nhắc rõ điểm /100 không phải phần trăm phát âm đúng. Coverage <80% có ghi chú phạm vi; bản ghi clipping hoặc chưa khớp rõ câu mẫu chuyển sang yêu cầu ghi âm lại và ẩn gợi ý lỗi cụ thể. Có nút ghi âm lại ngay trong phần phản hồi. Các quy tắc chất lượng bản ghi/coverage là kiểm tra kỹ thuật, chưa phải ngưỡng độ tin cậy đã hiệu chuẩn.

Artifact `backend/speaking-ai/configs/scoring-calibration.json` khóa theo checkpoint, mapping và feature signature; modelVersion hiện tại là `gop-ctc-mlp-68505cc756b1fbf8-ref2-470077d127db-cal1-f38fe9a705ac1e16`. Trường tùy chọn `rawScore`/`interpretation` lưu trong JSON hiện có, không thay đổi schema. Lịch sử cũ vẫn dùng ngưỡng hiển thị cũ có ghi chú. Chi tiết thí nghiệm, giới hạn và xác minh tại [báo cáo hiệu chỉnh](backend/reports/speaking-score-calibration/REPORT.md).

## Mapping tham chiếu phiên bản ref2

Đã cải thiện mapping phục vụ tại `backend/speaking-ai/reference_mapping.py`. Bảng 39 âm, vocabulary, feature schema và trọng số đã train được giữ nguyên. Khôi phục ranh giới dùng mọi cách phát âm CMUdict, không chỉ biến thể đầu; G2P từng từ chỉ hỗ trợ xác định ranh giới, không tạo nhãn âm để chấm cho từ ngoài từ điển. Tìm phân hoạch duy nhất khớp chính xác chuỗi token toàn câu. Không dùng dự đoán từ audio hoặc điểm giáo viên để đổi âm đích.

Trong từ có token gộp (ví dụ EH+R → ɛɹ, AH+L → əl), chỉ chấm các token một-một có cùng chủ sở hữu trên mọi cách đối chiếu hợp lệ. Token gộp không được tách, nhân đôi hay nhận điểm thay cho hai âm. Nếu còn mơ hồ, phần đó vẫn chưa được chấm. Giao diện hiển thị ghi chú khi từ chỉ được chấm một phần. `modelVersion` có hậu tố `ref2` và hash module, để phân biệt kết quả lịch sử trước/sau thay đổi.

Trên cùng 3.313 câu CEFR-SP đã qua lọc định dạng: câu bị từ chối mapping giảm 732 → 316, gồm lỗi ranh giới từ giảm 729 → 313; khôi phục 416 câu. Mapping đầy đủ 300 → 326; mapping một phần 2.281 → 2.671. Coverage trung bình theo câu (từ chối tính 0) 56,18% → 70,81%; không có câu giảm coverage hay từ từng được chấm chuyển thành không hỗ trợ trong tập đối chiếu. Đây là độ phủ ký hiệu, không phải accuracy phát âm.

Báo cáo: `backend/reports/cefr-speaking-mapping-v2/COMPARISON.md`, chi tiết `comparison.json`, `mapping.jsonl`. Dùng lại bản đo TTS cũ vì câu gốc/IDs giữ nguyên; không đo lại người đọc thật. Số ứng viên đủ lọc kỹ thuật hiện là 1.454 trước loại trùng (bao gồm một câu C2), chưa tự nhập thêm bài. Các bài 921 câu đã nhập trước đó giữ nguyên; không sửa database hoặc báo cáo baseline cũ.

Kiểm tra an toàn mới tại `test_reference_mapping.py`, cùng bộ `test_serving.py`: trường hợp /r/ gộp, phụ âm âm tiết, biến thể phát âm, D/T còn mơ hồ, tên ngoài từ điển, vị trí token sau phần gộp, và từ có nguyên âm khác không được ép khớp. Cần tiếp tục kiểm chứng ranh giới/điểm chấm bằng người đọc thật. Nguồn mô tả backend: https://bootphon.github.io/phonemizer/api_reference.html ; tokenizer: https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme .

Đã chạy 15/15 kiểm thử Python tại đợt ref2; lint/TypeScript cho giao diện đạt. Kiểm tra dịch vụ thật trên 6 câu tổng hợp được chọn trong nhóm từng lỗi (mỗi cấp A1–C2 một câu): HTTP 422 trước cập nhật → HTTP 200 sau cập nhật; đây là smoke test, không phải mẫu ngẫu nhiên hoặc benchmark giọng người Việt. WAV mẫu công khai “We call it bear” vẫn chấm được, coverage 7/9 → 8/9 nhờ chấm B trong BEAR, không chấm tách token ɛɹ. Kiểm thử SpeakingLiveModelTests .NET → Python → lưu/đọc InMemory đạt, không ghi SQL. Xem `live-before.json`, `live-after.json`, `live-validation.json` trong thư mục báo cáo ref2. Phiên bản tại thời điểm kiểm tra mapping: `gop-ctc-mlp-68505cc756b1fbf8-ref2-470077d127db`; bản hiện tại thêm hậu tố cal1 ở trên.

## Bài luyện CEFR-SP đã nhập

Đợt nhập ngày 2026-10-27 theo yêu cầu người dùng: thêm 13 khóa, 95 bài, 921 câu CEFR-SP. 924 ứng viên từ báo cáo `backend/reports/cefr-speaking-audit` được đối chiếu lại hash dữ liệu/mapping; bỏ 3 câu lặp nội dung chỉ khác dấu câu, giữ mọi nguồn tương ứng trong provenance. Phân bố: A1 53, A2 301, B1 414, B2 129, C1 24. Không tạo bài C2 do chưa có câu đạt bộ lọc.

Các câu có nhãn hai người đánh giá đồng thuận, mapping tham chiếu ít nhất 80% và audio giọng tổng hợp chậm không quá 10 giây. Chưa xác nhận thời gian người học tự đọc, căn chỉnh âm thanh hay độ chính xác điểm chấm. Nhãn CEFR mô tả độ khó câu; không xác định trình độ Speaking của người học. Mỗi bài có tối đa 10 câu, ghi âm từng câu tối đa 12 giây. Giữ nguyên văn bản và nhãn, không cắt câu để ép qua thời lượng.

Tách khóa theo nguồn SCoRE / Wiki-Auto, có thông tin tác giả, URL nguồn và giấy phép trong mô tả khóa/mục tiêu bài học. SCoRE: CC BY-NC-SA 4.0; Wiki-Auto: CC BY-SA 3.0 theo README CEFR-SP. Nội dung nhập ở `backend/speaking-ai/cefr-practice/courses.json`; nguồn theo từng câu, độ phủ, thời lượng tổng hợp, hai nhãn và bản lặp đã loại ở `provenance.json`; ID khóa/bài đã đối chiếu SQL ở `import-receipt.json` cùng thư mục.

Công cụ xây dựng tệp nhập: `backend/scripts/build_cefr_practice.py`. Nhập lại: `./backend/scripts/Import-SpeakingPractice.ps1 -CourseFile backend/speaking-ai/cefr-practice/courses.json -Apply`. Xác minh: `./backend/scripts/Verify-CefrPractice.ps1`. Bước nhập chỉ thêm dữ liệu vào Courses/Lessons hiện có, không thay đổi schema, không sửa các bài cũ. Đã xác minh mọi câu và metadata khớp tệp nhập, chạy lại bỏ qua đủ 13 khóa. SpeechOcean762 vẫn giữ 44 khóa/501 bài.

Mở danh mục `/courses?skill=speaking&search=CEFR-SP` để chỉ xem các khóa mới. Lần nhập đầu: bài A1 đầu tiên tại `/courses/51/speaking/520` (xem receipt để lấy ID trên máy khác).

Luồng đã tích hợp: danh mục khóa học → bài Speaking → chọn câu → ghi âm hoặc chọn WAV → nghe lại → gửi chấm → xem điểm âm/từ và lịch sử. Câu mẫu được lấy từ bài học trên backend, không lấy từ trường văn bản do trình duyệt gửi lên.

## Chạy trên máy hiện tại

Frontend đã tự khởi động Speaking khi dùng `npm run dev` hoặc `npm start`; không cần mở terminal Python riêng trong luồng thông thường. Chỉ cần chạy API .NET trong Visual Studio và frontend bằng npm. Bước khởi động đợi mô hình ready tối đa 180 giây, dùng lại dịch vụ đang chạy và ghi log vào `backend/EnglishLearning.Api/App_Data/speaking-service/service.log`. Python tiếp tục chạy nền khi đóng frontend. Ba terminal bên dưới là cách chạy thủ công tùy chọn.

Mở ba terminal từ thư mục `D:\learning-english`:

```powershell
# Terminal 1: dịch vụ mô hình đã train, chỉ nghe trên loopback
.\backend\speaking-ai\run.cmd

# Terminal 2: API .NET
dotnet run --project backend/EnglishLearning.Api --launch-profile http

# Terminal 3: frontend
cd frontend
npm.cmd run dev
```

Mở `http://localhost:3000/courses?skill=speaking`, đăng nhập, chọn khóa học đã xuất bản rồi bấm **Luyện nói** trên bài Speaking. Nếu chưa có nội dung, admin có thể tạo/soạn/xuất bản khóa học qua giao diện quản trị hiện có; hệ thống không tự tạo khóa học mẫu.

Microphone cần localhost hoặc HTTPS. Trình duyệt yêu cầu quyền khi người học bấm bắt đầu. Có thể thay bằng tệp WAV dài 0,3–12 giây, tối đa 2 MB. Ghi âm trên trình duyệt dùng AudioWorklet, chuẩn hóa về WAV PCM16 mono 16 kHz; âm thanh tải lên cũng được dịch vụ kiểm tra, đổi sample rate nếu cần và không cắt ngắn bản ghi quá giới hạn.

Python dùng môi trường và artifact tại `D:\EnglishPronunciationTraining\EnglishPronunciationTraining`. Để dùng vị trí khác:

```powershell
$env:SPEAKING_TRAINING_ROOT='D:\duong-dan\EnglishPronunciationTraining'
.\backend\speaking-ai\run.cmd
```

Lần cài mới, dùng Python của dự án train:

```powershell
$env:SPEAKING_TRAINING_ROOT='D:\EnglishPronunciationTraining\EnglishPronunciationTraining'
& "$env:SPEAKING_TRAINING_ROOT\.venv\Scripts\python.exe" -m pip install -r backend/speaking-ai/requirements.txt
```

Cần giữ các script trích xuất/mapping, `configs/baseline.yaml`, `configs/phone_mapping.json`, `checkpoints/pronunciation_scorer.pt`, checkpoint âm học và eSpeak đi kèm. Dịch vụ không cần đọc `scores.json` hoặc nhãn giáo viên khi chấm audio mới. Không retrain mô hình khi khởi động web.

## Nội dung mẫu theo cấp độ

Cập nhật theo yêu cầu xóa: 6 khóa biên soạn ban đầu (18 bài, CourseId 1–6) đã được xóa khỏi database, cùng 6 lần chấm liên quan. Bản sao lưu riêng lưu trong `backend/EnglishLearning.Api/App_Data/speaking-archives/`; audio được giữ lại. Các nội dung mô tả bên dưới về 6 khóa ban đầu là lịch sử triển khai, không còn là danh mục hiện tại. Script nhập mặc định đã đổi sang `training-practice-courses.json` để không thêm lại 18 bài cũ. Các khóa SpeechOcean762 được giữ nguyên; sau thay đổi này không còn khóa B2/C1/C2 do dự án biên soạn ban đầu.

Đã thêm theo phê duyệt: 6 khóa Speaking A1–C2, mỗi khóa 3 bài, mỗi bài 3 câu (18 bài, 54 câu). Cấp độ là phân loại nội dung tham khảo; mô hình không chứng nhận năng lực CEFR. Mỗi câu được ghi và chấm riêng, giới hạn 12 giây.

Nội dung gốc: `backend/speaking-ai/practice-courses.json`. Xem trước bằng `./backend/scripts/Import-SpeakingPractice.ps1`; dùng `-Apply` để nhập vào database cấu hình Development. Script chạy trong transaction, bỏ qua khóa trùng tên và không chỉnh sửa khóa hiện có. Không tự chạy khi API khởi động, không thay đổi schema. Khi triển khai máy khác, cần chủ động phê duyệt database đích trước khi nhập.

## Cấu hình dịch vụ

### Bài bổ sung từ EnglishPronunciationTraining

Đợt nhập toàn bộ: đã đối chiếu 5.000 bản ghi manifest (train 2.000, validation 500, test 2.500), có 4.947 câu khác nhau sau chuẩn hóa khoảng trắng/viết hoa/dấu câu để loại trùng. 18 câu đã có được giữ nguyên; thêm 4.929 câu trong 42 khóa, 495 bài, tối đa 10 câu mỗi bài và 12 bài mỗi khóa. 53 bản ghi nguồn trùng câu không tạo bài lặp. Không loại bản ghi vì điểm phát âm hoặc nhãn giáo viên.

Tệp nhập: `backend/speaking-ai/speechocean-catalog/courses.json`; báo cáo đối chiếu: `provenance.json` cùng thư mục, chứa SHA256 manifest, ID và split của tất cả bản ghi nguồn (kể cả câu trùng và câu đã có). Chỉ xuất văn bản, không xuất audio hay điểm giáo viên. Transcript được giữ nguyên và chưa được biên tập ngữ pháp từng câu.

Phân nhóm tự động phục vụ lựa chọn độ dài: A1 tối đa 5 từ, A2 từ 6–9 từ, B1 từ 10 từ. **Đây chỉ là nhóm độ dài tham khảo được hiển thị bằng cấp độ sẵn có, không phải phân loại CEFR đã kiểm chứng.** Giữ nguyên khóa B2/C1/C2 đã soạn riêng, không đẩy câu ngắn vào cấp cao. Câu nhập từ test/validation không còn phù hợp làm bài kiểm tra sản phẩm độc lập; không thay đổi manifest hoặc nhãn đánh giá mô hình gốc.

Nhập lại cùng tệp bằng `./backend/scripts/Import-SpeakingPractice.ps1 -CourseFile backend/speaking-ai/speechocean-catalog/courses.json -Apply` sẽ bỏ qua các khóa đã có. Công cụ `backend/scripts/build_speechocean_catalog.py` xây dựng tệp nhập từ ba manifest và snapshot danh sách câu hiện hữu; chỉ tạo tệp cục bộ, không tự ghi database.

`backend/speaking-ai/training-practice-courses.json` chứa 2 khóa A1–A2, 6 bài và 18 câu được rà soát từ manifest train của SpeechOcean762. Mỗi câu lưu ID nguồn trong tệp để đối chiếu; chỉ thay viết hoa và dấu câu. Không nhập audio người học, điểm giáo viên, dữ liệu cá nhân hoặc tập test/validation. A1/A2 là phân loại nội dung tham khảo của dự án, không phải nhãn của SpeechOcean762. Các câu đã xuất hiện trong tập train nên không dùng kết quả luyện các câu này làm benchmark độc lập.

Nhập trên môi trường được phê duyệt bằng `./backend/scripts/Import-SpeakingPractice.ps1 -CourseFile backend/speaking-ai/training-practice-courses.json -Apply`. Script bỏ qua tên khóa đã tồn tại. Nguồn: https://github.com/jimbozhang/speechocean762 và README cục bộ trong thư mục train.

- .NET: `SpeakingAi:BaseUrl`, mặc định `http://127.0.0.1:8001`; có thể ghi đè bằng `SpeakingAi__BaseUrl`.
- .NET: `SpeakingStorage:RootPath`, mặc định `backend/EnglishLearning.Api/App_Data/speaking`; không nằm trong wwwroot.
- Python: `SPEAKING_TRAINING_ROOT`, mặc định tìm thư mục train bên cạnh repository theo bố cục hiện tại.
- Frontend: dùng `API_BASE_URL` server-only hiện có; JWT ở cookie HttpOnly. Trình duyệt không gọi trực tiếp dịch vụ mô hình.

Kiểm tra dịch vụ: `GET http://127.0.0.1:8001/health`. Dịch vụ chỉ báo ready sau khi đã nạp model. Bản hiện tại chạy một worker và chấm tuần tự để phù hợp GPU 4 GB.

## API

| Method | Backend | Mục đích |
|---|---|---|
| GET | `/api/v1/speaking/lessons/{id}` | Nội dung bài Speaking đang hoạt động trong khóa học được phép xem |
| POST | `/api/v1/speaking/attempts` | Multipart: `lessonId`, `sentenceIndex`, `file` WAV |
| GET | `/api/v1/speaking/lessons/{id}/attempts` | 20 lần luyện gần đây của tài khoản hiện tại |
| GET | `/api/v1/speaking/attempts/{id}` | Kết quả của chủ bản ghi |
| GET | `/api/v1/speaking/recordings/{name}.wav` | Audio riêng, có kiểm tra chủ sở hữu và hỗ trợ Range |

Frontend proxy tương ứng qua `/api/speaking/...`, kiểm tra same-origin khi gửi bài, giới hạn dung lượng thực khi đọc request và giữ token ở server. Khóa học upload chỉ được học bởi chủ sở hữu theo cùng quy tắc catalog; khóa chưa xuất bản hoặc bài bị tắt không mở được để luyện.

Sử dụng đúng bảng `SpeakingAttempts` và các cột đã có. `PhonemeScores` lưu JSON version 1 gồm câu mẫu snapshot, chỉ số câu, điểm, danh sách âm, coverage và phiên bản model; `Feedback`, `OverallScore`, `DurationSeconds`, `AudioUrl`, `CreatedAt` lưu theo schema hiện tại. Không có migration, bảng hoặc cột mới. Audio chỉ được ghi sau khi chấm thành công; nếu lưu database thất bại thì file mới được dọn.

## Ý nghĩa và giới hạn kết quả

Giao diện kết quả gợi ý tối đa ba từ dựa trên âm đã chấm có điểm thấp nhất: dưới 1,10/2 là ưu tiên luyện màu cam, từ 1,10 đến dưới 1,50/2 là nên nghe lại màu nhạt. Hiển thị vị trí từ/âm đã chấm, điểm thực tế, cách đặt môi/lưỡi tham khảo và nút đọc từ/cả câu bằng giọng tổng hợp của trình duyệt. Đây là gợi ý luyện tập, chưa được hiệu chuẩn để chẩn đoán lỗi. Không xem từ chưa hỗ trợ là phát âm sai. Nhận xét không khẳng định thay âm/bỏ âm chỉ từ điểm thấp. Tất cả điểm từ/âm vẫn có trong bảng chi tiết; bản ghi có cảnh báo chất lượng cần ghi lại trước khi nhận xét phát âm.

- Điểm âm vị nằm trong 0–2. Điểm hiển thị /100 là trung bình điểm các âm được hỗ trợ nhân 50, mang tính tham khảo.
- CMUdict và G2P văn bản cung cấp âm đích khi chấm bản ghi mới; chỉ các đối chiếu một-một không mơ hồ mới được chấm. Từ/âm gộp chưa hỗ trợ hiển thị “chưa đánh giá được”. Coverage đi kèm điểm để thể hiện phần đã chấm.
- Chưa xác định chính xác học viên thay âm nào bằng âm nào, chưa chấm trọng âm, ngữ điệu, độ trôi chảy hoặc CEFR. Kết quả benchmark trước đó chỉ phủ 65,16% âm vị test, không đại diện toàn bộ benchmark hay người học Việt Nam.
- Từ chối im lặng dựa trên năng lượng tín hiệu và đối chiếu chuỗi token nhận diện với câu mẫu bằng khoảng cách chỉnh sửa. Đây là kiểm tra kỹ thuật ban đầu, chưa phải bộ phát hiện giọng nói/sai câu đã hiệu chuẩn; cần thử thêm bằng bản ghi thật của nhóm.
- Timestamp là phạm vi frame hỗ trợ, chưa phải ranh giới âm đã được chuyên gia xác nhận.

## Kiểm tra

```powershell
dotnet test backend/EnglishLearning.Api.Tests/EnglishLearning.Api.Tests.csproj
& 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe' -m unittest discover -s backend/speaking-ai -p 'test_*.py' -v
cd frontend
npm.cmd run test:speaking
npm.cmd run lint
npm.cmd run build
```

Kiểm tra Speaking của .NET dùng InMemory riêng để xác nhận lưu/đọc kết quả, giới hạn quyền truy cập và không ghi SQL Server. Các kiểm tra SQL Server cũ của repository vẫn chỉ chạy khi có `ENGLISHLEARNING_TEST_CONNECTION_STRING`.

Kiểm tra kết nối tới mô hình thật, với service đang chạy:

```powershell
$env:SPEAKING_LIVE_TEST_AUDIO='D:\EnglishPronunciationTraining\EnglishPronunciationTraining\speechocean762-main\WAVE\SPEAKER0001\000010011.WAV'
dotnet test backend/EnglishLearning.Api.Tests/EnglishLearning.Api.Tests.csproj --filter FullyQualifiedName~SpeakingLiveModelTests
```

Lệnh này kiểm tra một câu mẫu “We call it bear” qua HTTP tới Python, nạp checkpoint thật, nhận điểm và lưu dữ liệu trong bộ nhớ. Nó không thay thế việc thử microphone và đánh giá giọng nói người Việt.

Chấm độc lập một WAV không cần mở web:

```powershell
cd backend/speaking-ai
& 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe' score_audio.py --audio 'D:\thu-am.wav' --text 'We call it bear'
```
