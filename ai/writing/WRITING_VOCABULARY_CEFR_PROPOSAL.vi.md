# Đề xuất mở rộng từ vựng theo CEFR

`TargetCefr` là mục tiêu người học lưu cho phiên bản. `CefrLevel` là ước lượng của DeBERTa trên cả bài. Độ khó từ vựng là nhãn theo lemma, từ loại và nghĩa hoặc theo cụm từ, tùy nguồn. Giá trị học tập còn phụ thuộc câu gốc, mục tiêu, mức quen thuộc và các thẻ đã có.

## Phạm vi đang chạy

`WritingCardCandidates` ưu tiên sửa chính tả có giải thích `SPELL` từ template v1 và các cụm mới khớp danh sách trong đề xuất GEC. Span UTF‑16 phải khớp nguyên văn nguồn và giữ nguyên cặp surrogate. Với sửa chính tả, cả từ gốc và từ sửa phải khớp ranh giới từ và dạng chuẩn hóa phải khác. Đề xuất GEC có thể dùng sai nghĩa, đổi văn phong hoặc thêm cụm đúng ngữ pháp vào sai ngữ cảnh. Người học vẫn cần xem lại trước khi lưu.

Luồng thứ hai dò các mẫu trong toàn bài gốc, gồm câu GEC chưa xử lý. Ứng viên giữ đoạn nguồn dài tối đa 1.000 ký tự; kết quả gộp theo dạng chuẩn hóa, ưu tiên chỉnh sửa rồi lấy lần xuất hiện đầu tiên. Mẫu ưu tiên chuỗi dài hơn ở cùng vị trí. Pipeline hiện bỏ sót biến thể chia động từ, cụm gián đoạn, cụm ngoài danh sách và từ đa nghĩa. Tách câu theo dấu câu/xuống dòng có thể tách chữ viết tắt hoặc cụm bắc qua dòng.

- Liên kết ý gồm `as a result`, `as a result of`, `in addition to`, `in the long run`, `on the other hand`.
- Cụm động từ gồm `draw a conclusion`, `keep a journal`, `look forward to`, `make an informed decision`, `make progress`, `meet a deadline`, `pay attention to`, `play a role in`, `raise awareness`, `take into account`, `take notes`, `take responsibility for`.

Schema từ điển hiện có lưu mục từ, nghĩa, phát âm và nguồn theo mục. Chưa thấy dữ liệu nhãn CEFR ở cấp nghĩa hoặc cụm được cấp quyền và sẵn sàng tích hợp. Luồng Writing hiện vận hành cục bộ và để trống trường chưa có căn cứ.

## Lựa chọn

| Phương án | Nguồn, giấy phép và chi phí | Khả năng đánh giá và rủi ro |
|---|---|---|
| CEFR-J Wordlist v1.6 | Tono Laboratory công bố quyền dùng nghiên cứu/thương mại nếu ghi nguồn đúng. Ứng viên cho thử nghiệm lemma/POS A1–B2, tra cục bộ sau khi duyệt tải, kiểm định và xác nhận cách phân phối. Chi phí chủ yếu ở chuẩn hóa và chấm. [CEFR-J](https://cefr-j.org/download_eng) | Dễ truy dấu theo mục từ. Tập giáo trình và nhóm người học nguồn có thể lệch với người học Việt Nam. Phủ nghĩa và cụm còn hạn chế, thiếu C1/C2. |
| Oxford 3000/5000 và Oxford Phrase List | Wordlist theo CEFR và danh sách riêng cho cụm từ. Dùng tài liệu công khai để khảo sát. Cần xác nhận quyền nhúng/phân phối, định dạng và chi phí trước khi dùng trong sản phẩm. [Oxford word lists](https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000) · [Oxford Phrase List](https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford-phrase-list.html) | Nhãn cụm dễ giải thích hơn việc ghép nhãn từng từ. Vẫn phải gắn đúng mục, POS và ngữ cảnh, tránh ngoại suy nhãn cho biến thể. |
| English Vocabulary Profile | Tham chiếu A1–C2 theo nghĩa và cụm. Chủ nguồn nêu giới hạn mục đích phi thương mại/nghiên cứu và không cấp dữ liệu cho mục đích thương mại. [EVP](https://englishprofile.org/?menu=english-vocabulary-profile) · [Điều khoản](https://englishprofile.org/?menu=evp-terms-of-use) · [Chính sách cấp phép](https://englishprofile.org/?menu=contact-us) | Phân biệt nghĩa tốt hơn headword, nhưng mục đích tái sử dụng phải được xác nhận. |
| Trích xuất NLP và xếp hạng cục bộ | Có thể đánh giá spaCy/ERRANT English model đang có cho lemma, POS và span, rà giấy phép phiên bản trước khi phân phối. Tần suất cần corpus có quyền hoặc nguồn thống kê có phép. Chi phí CPU và gán nhãn, không cần gọi nhà cung cấp. | Ưu tiên bằng căn cứ từ câu gốc, nhãn lexical đã đối chiếu, loại cụm, tần suất và trạng thái đã lưu. Tần suất và tag POS có sai số, không trực tiếp quy đổi thành CEFR. |
| Gemini dùng trong nghiên cứu | Có phí theo model và token, cần quyền gửi dữ liệu và điều kiện trong protocol. | Có thể bổ sung ứng viên hoặc lý do theo câu, cần kiểm span, đánh giá mù và đối chiếu nguồn. Đầu ra sinh không tự chứng minh nhãn CEFR. |

## Thử nghiệm đề xuất

Ưu tiên thử CEFR-J Wordlist v1.6 cho lemma/POS A1–B2 sau khi duyệt nguồn. Giữ nhãn rỗng khi không khớp đủ hay có nhiều nghĩa bất đồng. Nhóm cụm từ cần nguồn có giấy phép dùng riêng hoặc bộ cụm do nhóm biên soạn và chuyên gia rà soát. Khóa phiên bản nguồn và quy tắc chuẩn hóa. Chạy trên cùng tập bài với baseline 17 mẫu, tách development để chỉnh quy tắc và giữ một tập đánh giá độc lập. Đo độ phủ ứng viên trước khi xếp hạng, rồi đo độ chính xác đề xuất, tỷ lệ ứng viên có ích ở top K, lỗi sai nghĩa, độ phủ theo CEFR mục tiêu và tỷ lệ bài không có gợi ý. Tách nhóm có lỗi GEC, câu giữ nguyên, cụm biến thể, từ đa nghĩa và bài không có đủ ứng viên. Giữ ID/span và căn cứ xếp hạng cho mỗi kết quả để người chấm truy lại được.
