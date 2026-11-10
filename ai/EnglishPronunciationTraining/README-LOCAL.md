# Môi trường trên máy ADMIN

Thư mục dự án: `D:\EnglishPronunciationTraining\EnglishPronunciationTraining`.
Python 3.13.2 được đặt riêng tại `.tools/python313-portable/tools/python.exe`, lấy từ gói Python chính thức trên NuGet. Môi trường `.venv` được tạo lại trên máy này; `.venv-imported` là bản sao giữ lại từ máy cũ.

GPU hiện tại: NVIDIA GeForce RTX 3050 Laptop GPU, 4 GB VRAM. Các thư viện được cài theo `requirements-lock-win-py313-cu126.txt`. Cấu hình vẫn dùng float32, một câu mỗi lần suy luận và mô hình âm học đóng băng.

## Sử dụng trong PowerShell

```powershell
cd D:\EnglishPronunciationTraining\EnglishPronunciationTraining
.\Training-Python.cmd --version
.\Training-Python.cmd scripts\check_environment.py --require-cuda
.\Training-Python.cmd scripts\smoke_test_model.py --local-files-only
```

`Training-Python.cmd` dùng Python trong `.venv` và thiết lập cache/eSpeak riêng cho từng lệnh. Có thể gọi trực tiếp `.\.venv\Scripts\python.exe` với các script Python trong dự án. Cách gọi này không cần thay đổi chính sách chạy script PowerShell.

Trong VS Code, chọn interpreter `D:\EnglishPronunciationTraining\EnglishPronunciationTraining\.venv\Scripts\python.exe`.

## Báo cáo

Đã kiểm tra thành công trên máy hiện tại: `pip check`, CUDA, một bước cập nhật trọng số MLP trên GPU, đọc WAV và G2P. Báo cáo mới ở `reports/environment-check.json` và `reports/model-smoke-test.json`. Bản báo cáo nhập từ máy cũ được giữ ở `reports/imported-machine/`.

Dữ liệu gốc nằm tại `speechocean762-main/`. Chỉ dùng 5.000 câu trong `train/wav.scp` và `test/wav.scp`; thư mục còn có WAV ngoài hai danh sách này.

Đây là môi trường chuẩn bị huấn luyện. Mapping ký hiệu đã được tạo và kiểm tra; xem `PHONE-MAPPING.md` cho các trường hợp còn cần xem lại. Pipeline manifest, trích xuất GOP-CTC-align và huấn luyện bộ chấm điểm đã được triển khai; xem `TRAINING.md`. Chất lượng căn chỉnh vẫn cần kiểm tra bằng nghe/đối chiếu chuyên gia. Kiểm tra suy luận một câu không đánh giá chất lượng chấm phát âm.

## Kết quả suy luận thực tế

Checkpoint chạy thành công bằng CUDA/float32 với câu mẫu dài 2.58 giây; thời gian forward là 0.367 giây, peak CUDA allocated 1273.8 MiB. Thời gian này không bao gồm nạp mô hình, upload hay chấm GOP.
