# GEC hiện hành và các lỗi cần xử lý

**PARTIAL về chất lượng.** Runtime đã nạp `gec-viet-full-18ep-bs2-ga8-20261111`. Sửa được một số lỗi đơn giản và đã tái hiện một lỗi bị bỏ sót trong câu mà model có sửa. Người dùng phản ánh sửa thừa, bỏ sót và đổi nghĩa. Chưa có tỷ lệ đáng tin cậy cho từng nhóm đó trên bài học viên của sản phẩm.

## Checkpoint và huấn luyện

- `google/byt5-small` dạng encoder–decoder, đầu ra là toàn bộ câu đã sửa. LoRA PEFT trên attention `q/v`, rank 8, alpha 16, dropout 0.05. Checkpoint hiện hành khởi tạo từ base đã ghim revision. Cấu hình `run.json` ghi seed 42, BF16, batch 2 × tích lũy 8, learning rate 2e-4, trọng số edit 4, dự kiến tối đa 18 epoch. Early stopping hoạt động trên dev F0.5. Tên run thể hiện kế hoạch, số bước thực tế và checkpoint được chọn nằm trong manifest.
- Dữ liệu train/dev được ghim theo hash trong `run.json`, tên file `gec-train.jsonl` và `gec-dev.jsonl` dưới `prepared-first-final`. Pipeline chuẩn bị từ Cambridge Write & Improve Corpus 2024 v2, gồm cặp câu phiên bản đầu/cuối theo split chính thức và ca giữ nguyên. File held-out GEC có nguồn/ID, thiếu bản sửa gold công khai trong pipeline hiện có. Manifest không chứng minh đã chấm test.
- Khởi động dùng [Start-Writing.ps1](../../ai/writing/Start-Writing.ps1) và [model-defaults.json](../../ai/writing/model-defaults.json). [serve.py](../../ai/writing/serve.py) dựng `WritingEngine`. [inference.py](../../ai/writing/inference.py) kiểm hợp đồng run, hash adapter, load tokenizer chậm từ `best`, tải base revision rồi áp PEFT từ `best`. `WRITING_GEC_RUN` có thể override, kể cả chuỗi rỗng để tắt. Kiểm `/health` và provenance của phản hồi để biết checkpoint thực sự được dùng.
- Nguồn cho việc tái lập huấn luyện và kiểm tra dữ liệu gồm [train.py](../../ai/writing/train.py), [modeling.py](../../ai/writing/modeling.py), [training_state.py](../../ai/writing/training_state.py), [gec_loss.py](../../ai/writing/gec_loss.py), [data.py](../../ai/writing/data.py) và [Writing trong README](../../README.md). Các lệnh train cần được duyệt riêng.

## Bài gốc đi qua các bước nào

1. [WritingAiClient](../../backend/EnglishLearning.Api/Services/WritingAiClient.cs) gửi `text`, `corrections` đến `POST /internal/writing/analyze`. Dịch vụ nhận tối đa 12.000 ký tự. Bộ kiểm đầu vào CEFR và ngân sách 512 token có thể từ chối bài trước GEC. CEFR được dự đoán trên bài gốc.
2. [body_sentence_spans](../../ai/writing/gec_safety.py) lấy các dòng vật lý, bảo vệ lời chào, kết thư và đuôi chữ ký khớp quy tắc, rồi dùng `spacy.blank("en")` với sentencizer. Các khoảng trống giữa span được sao chép từ nguồn. GEC xử lý tối đa 20 câu thân bài, mỗi span gọi model một lần trên câu đã trim, không kèm đề hay câu trước/sau.
3. ByT5 tokenize đầu vào nguyên dấu câu và contraction, kiểm tối đa 384 token với `truncation=False`. Sinh tất định `do_sample=False` và beam mặc định 1, tối đa 384 token mới, không có bước thử lại/rerank. Xác nhận EOS, decode bỏ special token, trim và nối lại một số negative contractions bị tách. Câu quá ngân sách hoặc đầu ra rỗng/thiếu EOS giữ nguyên.
4. `gec-safety-v2` chặn ứng viên đổi bố cục, lặp bất thường, xóa/thêm quá nhiều, mất số, thay đổi dấu hiệu phủ định, mất từ viết hoa bên trong câu hoặc mất cả đoạn. Đây là heuristic theo chuỗi. Đổi quan hệ giữa hai thực thể, tinh chỉnh tình thái hay thay đổi hàm ý vẫn có thể lọt. Guard cũng có thể chặn một sửa đúng.
5. Runtime giữ khoảng trắng quanh span và xuất một suggestion cấp câu khi câu thay đổi, cùng offsets UTF‑16 và giải thích từ [writing_explanations.py](../../ai/writing/writing_explanations.py). Backend kiểm trả về. [writing-revision.ts](../../frontend/src/lib/writing-revision.ts) dựng các thay đổi nhỏ để highlight và review. Diff hiển thị cần đối chiếu với đúng occurrence, nhất là emoji, CRLF, câu lặp, nhiều edit và span chồng nhau.
6. `gecCoverage` chia số câu thành `changed`, `unchanged`, `rejected`, `inputOverBudget`, `incomplete`, `sentenceLimit`. `changed` chỉ xác nhận có output khác nguồn sau guard. Một câu changed có thể còn nhiều lỗi; một câu unchanged có thể đúng hoặc bị bỏ sót. Báo cả số bài bị từ chối ở bước CEFR nếu đánh giá pipeline.

## Bằng chứng và cách tái hiện

- **Đã tái hiện trên runtime thật với câu synthetic trong lượt bàn giao.** Đầu vào `She go to school every day and study English after class. He have two book in his bag.` trả `She goes to school every day and study English after class. He has two books in his bag.` Hai câu đều thuộc `changed`, không bị guard, quá budget hay sinh thiếu EOS. Lỗi hòa hợp ở động từ phối hợp `study → studies` còn lại. Đây là một ca xác nhận omission ở pipeline hiện tại. Muốn quy nguyên nhân cho model cần giữ cả output raw trước hậu xử lý.
- **Đối chứng synthetic trong cùng lượt.** Hai câu `The weather was pleasant, so we walked home after dinner. My sister called when she arrived.` được giữ nguyên. Hai câu `I did not tell Maria that the train leaves at 8. She told me she would meet us afterward.` cũng giữ nguyên. Hai đối chứng nhỏ chỉ xác nhận hành vi của các ca này.
- **Lỗi đã mô phỏng trong unit tests.** [test_gec_safety.py](../../ai/writing/tests/test_gec_safety.py) có mẫu mất đoạn, lặp, đổi số, phủ định và tên. [test_service.py](../../ai/writing/tests/test_service.py) kiểm fallback đầu ra không hoàn chỉnh, giữ bố cục, trần câu và cách phân loại coverage. [test_preflight.py](../../ai/writing/tests/test_preflight.py) kiểm span UTF‑16 và occurrence lặp. Ghi các lỗi này là lỗi được bảo vệ bằng fixture; test không nói model hiện tại sinh lỗi đó với tần suất nào.
- **Chưa tái hiện trong lượt này.** Sửa thừa trên câu đúng, sửa thiếu tự nhiên, đổi nghĩa và bỏ sót theo nhóm thì, mạo từ, giới từ, cấu trúc câu, trật tự từ hoặc chính tả. Đây là nhóm cần đo; phản ánh của người dùng không đủ để xếp hạng lỗi. Thu bài đã được phép hoặc tạo minimal pair có gold, rồi kiểm raw, guard và UI độc lập.
- **Benchmark lịch sử đúng checkpoint.** Trên bản cục bộ, `artifacts/gec-viet-full-18ep-bs2-ga8-20261111/run.json` có `dev_metrics.eval_gec_precision`, `recall`, `f05`, `tp`, `fp`, `fn` với tiền tố `eval_gec_`, cùng `gec_scoring_protocol=errant-3.0.2-raw-spacy-v2`. Đây là nhóm dev cân bằng chọn checkpoint, lấy mẫu theo hai nhóm sửa/giữ nguyên với seed cố định. Số liệu dẫn xuất chi tiết được giữ ngoài Git theo quyền corpus. Chưa tìm thấy benchmark held-out có gold hoặc ground truth đổi nghĩa cho đúng adapter. Kết quả `gec-expanded-v1`, QVO và Unicode là những run khác.

Để tái hiện omission, khởi động hai adapter đã xác minh theo [Hướng dẫn Windows](02_SETUP_WINDOWS.md), gọi thẳng Python local để không ghi SQL rồi so output theo đúng input:

```powershell
$body = @{ text = 'She go to school every day and study English after class. He have two book in his bag.'; corrections = $true } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/internal/writing/analyze' -Method Post -ContentType 'application/json' -Body $body
$r | Select-Object correctedText, gecCoverage, provenance | ConvertTo-Json -Depth 8
```

Bước đầu tiên là khóa đúng adapter và bộ đánh giá, tách lỗi coverage khỏi lỗi chất lượng và lỗi UI. Sau đó phân tích các ca raw sai, raw đúng bị guard chặn, raw sai thoát guard và lỗi sót trong câu có edit. Xem [protocol](06_AI_EVALUATION_PROTOCOL.md) và [backlog](07_AI_IMPROVEMENT_BACKLOG.md).
