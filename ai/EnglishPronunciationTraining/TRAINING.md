# Trích xuất GOP và huấn luyện bộ chấm điểm

Pipeline này tạo một baseline chấm **điểm âm vị 0–2** bằng mô hình âm học đóng băng, đặc trưng GOP và bộ hồi quy nhỏ. Không fine-tune Wav2Vec2; chưa chẩn đoán âm thay thế, chưa đánh giá độ trôi chảy, trọng âm hay điểm nói CEFR.

## Chạy toàn bộ

Mở PowerShell trong thư mục dự án:

```powershell
.\Training-Python.cmd scripts\run_training.py
```

Hoặc chạy từng bước:

```powershell
.\Training-Python.cmd scripts\prepare_manifests.py
.\Training-Python.cmd scripts\extract_gop.py
.\Training-Python.cmd scripts\train_scorer.py
```

Trích xuất sử dụng lại cache có cùng fingerprint cấu hình, manifest và mapping. Audio thay đổi sẽ bị phát hiện bằng kích thước và thời điểm sửa. Chạy lại cả pipeline sẽ ghi lại manifest và báo cáo theo seed cố định, không xóa dữ liệu gốc. Giữ nguyên đường dẫn dự án và cache checkpoint.

## Chia dữ liệu và bảo toàn nhãn

Tập train chính thức có 125 người nói: lấy ngẫu nhiên 25 người làm validation, còn 100 người cho train; giữ nguyên 125 người nói của test chính thức. Seed là 42. Với dữ liệu hiện có, ba tập lần lượt có 2.000 / 500 / 2.500 câu. Không có người nói hoặc câu trùng giữa ba tập.

Chuỗi đích cho căn chỉnh là toàn bộ token G2P từ văn bản câu, không phải chuỗi mô hình nhận ra từ bản ghi học viên. Chỉ gắn nhãn giáo viên vào những vị trí có mapping một-một đã kiểm tra; các từ còn mơ hồ được giữ trong câu nhưng không tạo mẫu train. Nếu chưa xác định được ranh giới từ, cả câu bị bỏ qua và có lý do trong manifest. Những bản ghi dài hơn 12 giây được đánh dấu, không cắt ngắn và không dùng trong baseline này.

Việc masking làm thay đổi phân bố dữ liệu. Kết quả test chỉ đại diện cho phần âm vị được hỗ trợ, **không phải kết quả trên toàn bộ benchmark SpeechOcean762**. Mẫu bị loại khỏi test vẫn có trong manifest và được tính vào mẫu số của báo cáo coverage.

## GOP được tính thế nào?

`gop_ctc.py` dùng Viterbi trên đồ thị CTC có blank xen kẽ token đích, xử lý đúng các token lặp phải có blank ở giữa. GOP của một âm là trung bình log posterior của token tham chiếu trên các frame đi qua label-state của âm đó; các frame ở blank-state không tham gia trung bình. Đây là cách GOP-CTC-align được mô tả ở mục 3.1 trong [Cao và cộng sự, Interspeech 2024](https://www.isca-archive.org/interspeech_2024/cao24b_interspeech.pdf).

Tám đặc trưng bổ sung/đặc trưng vô hướng gồm GOP, xác suất log tốt nhất của âm cạnh tranh, chênh lệch, entropy, số frame hoạt động, đỉnh log posterior của âm đích, tỷ lệ blank của cả câu và vị trí tương đối. Ghép thêm 39 xác suất log tham chiếu và one-hot 39 âm gốc, tổng cộng **86 chiều**. Đây là lựa chọn baseline của dự án, không phải vector GOP alignment-free hay cấu hình GOPT nguyên bản trong bài báo.

Mốc thời gian lưu trong JSON là phạm vi hỗ trợ của frame mô hình, không phải ranh giới âm do chuyên gia xác nhận. Viterbi luôn ép đường đi theo câu mẫu; đường căn chỉnh hợp lệ về toán học chưa chứng minh độ chính xác ngôn ngữ học. Hình `reports/pilot-alignment-*.png` hỗ trợ xem lại các trường hợp này.

## Kiểm tra nhỏ trước khi trích xuất toàn bộ

```powershell
.\Training-Python.cmd -m unittest discover -s scripts -p "test_*.py" -v
.\Training-Python.cmd scripts\extract_gop.py --splits train --limit 50 --output-dir features/pilot_gop_ctc_align_v1 --report reports/pilot-extraction.json
```

Pilot có thư mục riêng, không được dùng thay bộ đặc trưng đầy đủ khi chạy train chính thức. Các kiểm tra đối chiếu Viterbi với phép duyệt mọi đường CTC trên ví dụ nhỏ, kiểm tra token lặp, loại blank khi tính GOP và bảo đảm thay điểm giáo viên không đổi đầu vào mô hình.

## Huấn luyện và chọn mô hình

Chỉ fit bộ chuẩn hóa trên train. MLP có hai lớp ẩn 128 và 64, dropout 0.2, đầu ra `2 * sigmoid`, Huber loss, AdamW và learning rate 0.001. Tối đa 50 epoch, dừng sớm sau 8 epoch validation MAE không cải thiện. Trọng số MLP được lấy ở epoch có validation MAE nhỏ nhất.

So sánh bốn ứng viên cố định: điểm trung bình toàn train, điểm trung bình theo âm từ train, hồi quy Ridge và MLP. Chọn ứng viên có validation MAE nhỏ nhất. Sau đó mới tính MAE, RMSE, Pearson và Spearman trên phần test được hỗ trợ. Tương quan với một dự đoán hằng số được ghi `null` vì không xác định, không ghi thành 0. Không điều chỉnh ngưỡng hoặc tham số dựa trên test.

Checkpoint đóng gói cả MLP và các baseline, bộ chuẩn hóa, fingerprint và tên mô hình được chọn. Có thể mô hình được chọn là Ridge hoặc điểm trung bình; xem kết quả thực tế thay vì mặc định MLP luôn tốt hơn.

## Tệp đầu ra

| Vị trí | Nội dung |
|---|---|
| `data/manifests/*.jsonl` | Mọi câu, split theo người nói, token đích, nhãn được gắn và lý do bỏ qua |
| `reports/manifest-summary.json` | Quy mô split và số mẫu đủ điều kiện |
| `features/gop_ctc_align_v1/{split}/{id}.npz` | Đặc trưng 86 chiều, điểm giáo viên, ID âm và vị trí token |
| JSON cạnh mỗi NPZ | Căn chỉnh, GOP, liên kết từ/âm/nhãn và metadata |
| `reports/gop-extraction.json` | Tiến trình và kết quả trích xuất, kể cả lỗi |
| `reports/training-history.csv` | Loss train và chỉ số validation từng epoch |
| `reports/scorer-evaluation.json` | So sánh mô hình, coverage và kết quả từng âm |
| `checkpoints/pronunciation_scorer.pt` | Gói bộ chấm điểm được chọn bằng validation |
| `logs/gop_ctc_align_v1/` | Log TensorBoard |
| `reports/test-predictions.npz` | Dự đoán test và thông tin truy vết |

## Dùng checkpoint với một file đặc trưng

```powershell
.\Training-Python.cmd scripts\score_cached_features.py features\gop_ctc_align_v1\train\TEN_ID.npz
```

Thay `TEN_ID` bằng ID có trong thư mục đặc trưng. Lệnh kiểm tra fingerprint trước khi dự đoán và không cần nhãn giáo viên để tính đầu ra. Chưa có API .NET/Python hay giao diện học viên trong pipeline này.

Điểm thấp chỉ biểu thị đánh giá chất lượng phát âm của baseline. Chưa đủ bằng chứng để khẳng định học viên thay âm nào bằng âm nào hoặc hướng dẫn sửa một lỗi cụ thể. Cần đánh giá bổ sung với người Việt trước khi kết luận về chất lượng với đối tượng sử dụng của nhóm.
