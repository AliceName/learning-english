# Môi trường huấn luyện chấm phát âm tiếng Anh

> **Dùng trên máy khác, không train lại:** Repo đã có `checkpoints/pronunciation_scorer.pt`. Xem [USING-PRETRAINED.md](USING-PRETRAINED.md) để cài môi trường và tải mô hình âm học. Dataset và môi trường Python không nằm trong Git.

Pipeline manifest, GOP-CTC-align và huấn luyện bộ chấm điểm đã có tại `TRAINING.md`. Chạy bằng `.\Training-Python.cmd scripts\run_training.py`.

Môi trường cục bộ phục vụ quy trình: mô hình nhận dạng âm vị có sẵn → đặc trưng GOP phù hợp với CTC → bộ chấm điểm âm vị → bộ chẩn đoán lỗi. Giai đoạn đầu khóa trọng số mô hình âm học và huấn luyện bộ chấm điểm nhỏ từ đặc trưng đã lưu.

Bản môi trường ban đầu được chuẩn bị trên máy khác có Windows x64, Python 3.13.2, NVIDIA GTX 1650 Max-Q 4 GB VRAM và khoảng 8 GB RAM. Máy ADMIN hiện tại có RTX 3050 Laptop 4 GB; xem `README-LOCAL.md` và các báo cáo mới trong `reports/` để biết trạng thái trên máy hiện tại. Cấu hình ban đầu dùng một câu mỗi lần suy luận, float32 trên GPU và `num_workers: 0`. Checkpoint được chọn trả về logits không hữu hạn khi thử float16 trên máy này, nên cấu hình dùng float32. Các giới hạn bộ nhớ phải được kiểm tra lại khi tăng độ dài audio hoặc kích thước batch.

## Sử dụng môi trường đã cài

Mở PowerShell tại `D:\EnglishPronunciationTraining\EnglishPronunciationTraining`. Hướng dẫn riêng cho máy hiện tại ở `README-LOCAL.md`.

```powershell
. .\Enter-Training.ps1
python scripts\check_environment.py --require-cuda
```

Cũng có thể gọi Python trực tiếp mà không cần kích hoạt môi trường. Các script Python tự thiết lập đường dẫn cache và thư viện eSpeak trong dự án:

```powershell
.\.venv\Scripts\python.exe scripts\check_environment.py --require-cuda
.\.venv\Scripts\python.exe scripts\smoke_test_model.py --local-files-only
```

Nếu checkpoint chưa tải, bỏ `--local-files-only` để tải phiên bản đã khóa từ Hugging Face. Smoke test dùng câu đầu tiên của tập train, chạy nhận dạng âm vị và lưu báo cáo. Câu viết hoa trong dữ liệu được chuyển về chữ thường trước khi G2P để tránh eSpeak đánh vần từ như IT. Đây là kiểm tra suy luận, chưa thực hiện chấm điểm GOP hoặc huấn luyện trên dữ liệu.

Trong VS Code hoặc ứng dụng notebook, chọn interpreter `.venv\Scripts\python.exe`. Đã cài `ipykernel`, không bắt buộc đăng ký kernel vào cấu hình toàn máy. Có thể xem log huấn luyện sau này bằng:

```powershell
.\.venv\Scripts\tensorboard.exe --logdir logs
```

## Cài lại

Từ thư mục dự án, chạy bằng Python 3.13 x64:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_environment.ps1
```

Script tạo `.venv` khi chưa có, cài gói theo lockfile, giải nén eSpeak NG cục bộ vào `.tools`, kiểm tra CUDA và chạy một lượt suy luận. Tham số `-SkipModelCheck` chỉ bỏ kiểm tra checkpoint, vẫn kiểm tra các thư viện, bước cập nhật trọng số trên CUDA, audio và G2P.

PyTorch được cài từ kho wheel CUDA 12.6 chính thức. Driver NVIDIA hiện có cung cấp CUDA driver API; môi trường dùng CUDA runtime đi kèm wheel PyTorch. Không cần cài thêm CUDA Toolkit để sử dụng các wheel này. eSpeak NG được giải nén bằng chế độ administrative extraction của MSI, không cài dịch vụ và không thêm đường dẫn vào PATH hệ thống.

## Thành phần được khóa phiên bản

- Python 3.13.2 x64 trong `.venv`, dựa trên Python hiện có trên máy.
- PyTorch 2.8.0 + CUDA 12.6, torchaudio 2.8.0 cùng bản CUDA.
- Transformers 4.57.1, Accelerate, datasets, NumPy, pandas, SciPy, scikit-learn.
- SoundFile để đọc WAV; phonemizer và eSpeak NG 1.52.0 x64 để chuyển văn bản thành âm vị; CMUdict để tra ARPAbet.
- Matplotlib, TensorBoard và ipykernel cho phân tích kết quả và notebook.
- Checkpoint `facebook/wav2vec2-lv-60-espeak-cv-ft`, revision `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`.

`requirements.txt` khóa các gói chính; `requirements-torch-cu126.txt` khóa PyTorch; `requirements-lock-win-py313-cu126.txt` lưu toàn bộ gói đã giải quyết sau khi cài thành công. Lockfile dành cho Windows x64 và Python 3.13.

## Thư mục

```text
.venv/                    Môi trường Python riêng
.tools/espeak-ng/         eSpeak NG và dữ liệu giọng đọc
.cache/huggingface/       Checkpoint và processor trong dự án
.cache/pip/               Cache tải gói trong dự án
speechocean762-main/      Dữ liệu gốc hiện có
data/raw/                 Dữ liệu bổ sung chưa xử lý
data/processed/           Dữ liệu đã chuẩn hóa
data/manifests/           Danh sách train, validation và test
configs/baseline.yaml     Cấu hình khởi đầu cho máy hiện tại
features/                 Đặc trưng GOP và metadata căn chỉnh đã trích xuất
checkpoints/              Trọng số bộ chấm điểm
logs/                     Log huấn luyện
reports/                  Báo cáo kiểm tra và đánh giá
notebooks/                Notebook thí nghiệm
scripts/                  Script cài đặt và kiểm tra
```

## Dữ liệu và bước tiếp theo

Dữ liệu SpeechOcean762 hiện có 2.500 câu train và 2.500 câu test. Dùng danh sách trong `train/wav.scp`, `test/wav.scp` và ID người nói trong `utt2spk`; thư mục WAV có cả tệp ngoài danh sách chính thức. Điểm giáo viên nằm trong `resource/scores.json`, nhãn gốc của từng người chấm nằm trong `resource/scores-detail.json`.

Đã tạo bảng mapping ký hiệu ARPAbet sang token checkpoint tại `configs/phone_mapping.json` và công cụ kiểm tra toàn bộ dữ liệu. Xem `PHONE-MAPPING.md` để chạy lại và đọc giới hạn. Cấu hình đánh dấu `phone_mapping_validation: symbolic_only`: các từ không khớp một-một hoặc chưa xác định ranh giới vẫn cần xem lại trước khi trích xuất GOP. Pipeline đã tách validation theo người nói, chạy thử 50 câu train và trích xuất GOP-CTC-align trên phần dữ liệu được hỗ trợ. Xem `TRAINING.md` và `reports/scorer-evaluation.json` cho quy trình và kết quả thực tế; chất lượng căn chỉnh vẫn chưa được chuyên gia kiểm tra.

Các báo cáo kiểm tra được lưu ở `reports/environment-check.json` và `reports/model-smoke-test.json`. Báo cáo suy luận một câu không đại diện cho chất lượng chấm điểm hay độ trễ trên toàn bộ dữ liệu.

## Nguồn cài đặt

- [PyTorch với CUDA 12.6](https://pytorch.org/get-started/previous-versions/#v280)
- [Wav2Vec2Phoneme](https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme)
- [Checkpoint âm vị](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft)
- [Phonemizer trên Windows](https://bootphon.github.io/phonemizer/install.html#on-windows)
- [eSpeak NG 1.52.0](https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0)
