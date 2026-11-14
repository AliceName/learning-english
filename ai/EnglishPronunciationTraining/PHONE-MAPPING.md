# Mapping âm vị SpeechOcean762 và checkpoint eSpeak

Đã xây bảng đối chiếu 39 âm ARPAbet cơ sở, phủ 67 nhãn xuất hiện trong 5.000 câu hiện có. Bảng nằm tại `configs/phone_mapping.json`, gắn với đúng revision checkpoint và SHA-256 của vocabulary. Đây là mapping ký hiệu; chưa xác nhận chất lượng căn chỉnh audio hay điểm GOP.

## Cách chạy lại

Từ thư mục dự án:

```powershell
.\Training-Python.cmd scripts\build_phone_mapping.py
.\Training-Python.cmd -m unittest discover -s scripts -p test_phone_mapping.py -v
```

Script dùng checkpoint/tokenizer trong cache, không tải model và không chạy suy luận audio. Nó giữ nguyên train/test và không dùng điểm giáo viên hoặc dự đoán âm thanh để chọn token. Tập test chỉ được kiểm kê riêng; không dùng để điều chỉnh mapping hay chọn ngưỡng.

Kết quả:

- `configs/phone_mapping.json`: canonical token, ID, biến thể tham chiếu cho phép, metadata checkpoint và chính sách xử lý.
- `reports/phone-inventory.csv`: tần suất từng nhãn gốc, âm cơ sở, dấu trọng âm và ID token.
- `reports/phone-mapping-audit.json`: số lượng đối chiếu được/cần xem lại, cùng ví dụ giữ nguyên điểm và thứ tự âm.
- `reports/phone-mapping-review.csv`: danh sách từ và ngữ cảnh tham chiếu cần xử lý, kèm tần suất riêng train/test.

## Quy tắc bảo toàn nhãn

`IY0`, `IY1`, `IY2` cùng thuộc âm cơ sở `IY`; số cuối vẫn được giữ trong `stress`, không bị xóa khỏi dữ liệu nguồn. Không suy ra `AH0` luôn là schwa: dữ liệu hiện có gán `AH0` cả cho BUT. Biến thể tham chiếu được chọn bằng G2P của văn bản câu, không dựa trên điểm giáo viên hay âm mà học viên đã đọc.

Backend G2P đúng phiên bản đang cài được gọi theo câu với thêm dấu phân cách từ. Script kiểm tra việc thêm dấu phân cách không làm thay đổi chuỗi token của tokenizer. Khi eSpeak nối cụm như “in the”, chỉ khôi phục ranh giới nếu có đúng một cách phân nhóm hoàn chỉnh và mọi âm trong cụm nối khớp một-một với token được phép. Không dùng khoảng cách chỉnh sửa, chèn/xóa âm hay điểm giáo viên để chọn phân nhóm. Trường hợp còn mơ hồ hoặc không khớp được đánh dấu `g2p_word_boundaries_mismatch` cho cả câu.

Chỉ từ có số âm và số token khớp, từng token nằm trong danh sách biến thể cho phép, mới nhận trạng thái `mapped`. Trạng thái này biểu thị tương thích ký hiệu một-một, không đảm bảo model chấm đúng hay căn chỉnh đúng.

## Ví dụ

| Nhãn gốc | Token tham chiếu | ID |
|---|---|---|
| W | w | 32 |
| IY0 | iː | 30 |
| TH | θ | 52 |
| G | ɡ | 35 |
| AH0 trong BUT | ʌ | 33 |

Dùng `ɡ` (ký hiệu IPA), không thay bằng chữ ASCII `g`. CTC blank của checkpoint là ID 0 (`<pad>`); blank và các token đặc biệt không là âm đích.

Trong BEAR, dữ liệu có `B EH0 R`, nhưng eSpeak có thể phát `b ɛɹ`: `ɛɹ` là **một token**. Script phát hiện nguy cơ gộp nhưng giữ riêng ba nhãn giáo viên. Không chia đôi token hoặc nhân đôi điểm để tạo hai ví dụ huấn luyện.

Một số từ có số âm khớp nhưng khác loại nguyên âm giữa hai nguồn, ví dụ NOT trong dữ liệu có `N AH0 T`, còn G2P trả `n ɑː t`. Trường hợp đó cũng cần xem lại; không coi việc thay AH bằng AA là đối chiếu tương đương mặc định.

`R*`, `<DEL>`, `<unk>` và các ký hiệu lạ không được biến thành R, blank hoặc âm gần nhất. Các nhãn chẩn đoán lỗi vẫn cần một bộ xử lý riêng; mapping này xử lý chuỗi âm đích `words[].phones`.

## Dùng trong code trích xuất sau này

```python
from phone_mapping import PhoneMapping

# vocab là vocabulary của đúng checkpoint; mapping.load kiểm tra fingerprint.
mapping = PhoneMapping.load('configs/phone_mapping.json', vocab)
ids = mapping.require_target_ids(
    ['B', 'AH0', 'T'], [2, 1.2, 0.4], ['b', 'ʌ', 't']
)
# ids == [26, 33, 6]
```

`require_target_ids` dừng nếu ngữ cảnh chưa kiểm tra, nhãn/điểm không hợp lệ hoặc đối chiếu còn mơ hồ. Module mapping không chia nhãn cho token gộp. Pipeline riêng tại `TRAINING.md` đã có căn chỉnh CTC toàn câu, trích xuất GOP cho những âm được hỗ trợ và huấn luyện bộ chấm điểm.

## Việc tiếp theo

Dùng các từ đã đối chiếu ký hiệu để kiểm tra căn chỉnh audio trên một nhóm câu train. Xem các ca ranh giới từ/âm gộp trong báo cáo trước khi quyết định căn chỉnh theo âm gốc, hỗ trợ token ghép hoặc chọn một mô hình với inventory khác. Không dùng dự đoán của học viên để đổi âm đích cho khớp vì sẽ che mất lỗi phát âm. Nếu sau này bỏ qua ca khó khi train, phải báo cáo tỷ lệ bị loại và đánh giá tác động; không âm thầm xóa chúng khỏi test.

Nguồn đối chiếu:

- https://github.com/cmusphinx/cmudict
- https://github.com/jimbozhang/speechocean762
- https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft
- https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme
