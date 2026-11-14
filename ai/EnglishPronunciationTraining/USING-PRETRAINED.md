# Dùng model đã train trên máy khác

Repo có code huấn luyện, cấu hình, báo cáo và model MLP đã train tại `checkpoints/pronunciation_scorer.pt`. Không cần train lại để chấm bản ghi mới.

Không đưa lên Git: `.venv`, `.venv-imported`, `.cache`, `.tools`, dữ liệu SpeechOcean762, đặc trưng đã trích xuất và log. Mô hình âm học Wav2Vec2 gốc khoảng 1,26 GB cần tải riêng đúng revision; đây là tải trọng số có sẵn, không phải huấn luyện.

## 1. Tạo môi trường trên Windows

Cài Python 3.13 x64, mở PowerShell trong thư mục clone rồi chạy:

```powershell
py -3.13 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-lock-win-py313-cu126.txt
```

Lockfile sử dụng PyTorch CUDA 12.6. Máy gốc dùng NVIDIA RTX 3050 Laptop 4 GB và float32. Bộ chấm web có nhánh CPU khi CUDA không khả dụng; tốc độ trên máy khác cần đo lại.

## 2. Chuẩn bị eSpeak NG

Chạy trong PowerShell. MSI được giải nén cục bộ, không cài dịch vụ hay sửa PATH toàn máy.

```powershell
$ErrorActionPreference = 'Stop'
$inferenceRoot = (Get-Location).Path
New-Item -ItemType Directory -Path '.tools\downloads' -Force | Out-Null
$inferenceMsi = Join-Path $inferenceRoot '.tools\downloads\espeak-ng-1.52.0.msi'
Invoke-WebRequest -Uri 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi' -OutFile $inferenceMsi
$expectedMsiHash = '7F673C709EA5DD579D3B5EBB98688CC575328A6AB7438D2BC405B88CEDAEAFB9'
if ((Get-FileHash -LiteralPath $inferenceMsi -Algorithm SHA256).Hash -ne $expectedMsiHash) {
    throw 'Sai SHA256 của eSpeak MSI.'
}
$inferenceExtract = Join-Path $inferenceRoot '.tools\espeak-ng'
$inferenceArguments = '/a "' + $inferenceMsi + '" /qn TARGETDIR="' + $inferenceExtract + '"'
$inferenceProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList $inferenceArguments -WindowStyle Hidden -Wait -PassThru
if ($inferenceProcess.ExitCode -notin @(0, 3010)) { throw 'Không giải nén được eSpeak.' }
if (-not (Test-Path -LiteralPath '.tools\espeak-ng\eSpeak NG\libespeak-ng.dll')) {
    throw 'Thiếu thư viện eSpeak sau khi giải nén.'
}
```

Không dùng `scripts/setup_environment.ps1` cho cài đặt không có dataset: các bước kiểm tra trong script đó vẫn đọc SpeechOcean762, kể cả khi chọn `-SkipModelCheck`.

## 3. Tải mô hình âm học đúng phiên bản

Chạy tại thư mục clone, có kết nối mạng và dung lượng trống cho model:

```powershell
@"
from pathlib import Path
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="facebook/wav2vec2-lv-60-espeak-cv-ft",
    revision="ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4",
    cache_dir=str(Path.cwd() / ".cache/huggingface/hub"),
    allow_patterns=[
        "config.json", "preprocessor_config.json", "pytorch_model.bin",
        "special_tokens_map.json", "tokenizer_config.json", "vocab.json",
    ],
)
"@ | & .\.venv\Scripts\python.exe -
```

Có thể chép `.tools/espeak-ng` và cache mô hình tương ứng từ máy đã chạy thay cho tải lại. Tạo lại `.venv` trên máy mới thay vì sao chép môi trường Python cũ.

## 4. Kết nối với website English Learning

Repo này là phần huấn luyện và artifact. API chấm phát âm nằm ở project website, tại `backend/speaking-ai`.

Trong terminal chạy website, đặt đường dẫn tới thư mục clone của repo này, ví dụ:

```powershell
$env:SPEAKING_TRAINING_ROOT = 'D:\EnglishPronunciationTraining\EnglishPronunciationTraining'
& "$env:SPEAKING_TRAINING_ROOT\.venv\Scripts\python.exe" -m pip install -r backend/speaking-ai/requirements.txt
```

Tiếp tục theo `SPEAKING.md` trong project website. Chỉ khởi động bộ chấm và website, không chạy `scripts/run_training.py` nếu không có nhu cầu train lại. Không cần dataset SpeechOcean762 để chấm audio mới.

## Kiểm tra artifact

Giữ nguyên nội dung file mapping vì bộ chấm kiểm tra SHA256 theo byte. `.gitattributes` đã tắt chuyển đổi dòng cho mapping và checkpoint.

- `checkpoints/pronunciation_scorer.pt`: `68505cc756b1fbf8b475ae799f394bc635b6abade4a63fb6f047159ff3a484ff`
- `configs/phone_mapping.json`: `9c83c28585ba0d4eb90966073576278b58ee69beb3219ed7edc7bd43a1443dcc`

```powershell
Get-FileHash -LiteralPath checkpoints/pronunciation_scorer.pt,configs/phone_mapping.json -Algorithm SHA256
```

Để huấn luyện lại hoặc tái lập đánh giá, cần chuẩn bị dataset riêng theo `TRAINING.md`. Các báo cáo trong `reports/` là kết quả đã có, không phải kết quả đánh giá trên máy vừa clone.
