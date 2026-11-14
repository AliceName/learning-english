# Môi trường, checkpoint và hiện vật cần bàn giao

## Hiện trạng runtime

`GET http://127.0.0.1:8000/health` trong lượt bàn giao đã trả ready, corrections enabled, feedback disabled. Ba ca synthetic `/analyze` xác nhận tên và hash cả hai adapter trong provenance. Đây là kiểm chứng tại máy hiện có. Máy nhận cần cài dependencies và có bản sao artifact được phép.

| Vai trò | Run và đường dẫn tính từ gốc repo | Base đã ghim revision |
|---|---|---|
| CEFR | `ai/writing/artifacts/cefr-my-first-run` | `microsoft/deberta-v3-base`, `8ccc9b6f36199bec6961081d44eb72fb3f7353f3` |
| GEC | `ai/writing/artifacts/gec-viet-full-18ep-bs2-ga8-20261111` | `google/byt5-small`, `68377bdc18a2ffec8a0533fef03b1c513a4dd49d` |

SHA-256 của file `best/adapter_model.safetensors` đã đối chiếu với phản hồi runtime:

```text
cefr-my-first-run                        1c51e4e33b2cc423ba8dd6372cb0ff6c1eeffb9e2c4911045998a796c188e161
gec-viet-full-18ep-bs2-ga8-20261111       a04006b472ff51d647421637a7aea40586ab215158a4e6f229469f98afb13373
```

```powershell
$root = '.\ai\writing\artifacts'
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root 'cefr-my-first-run/best/adapter_model.safetensors')
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root 'gec-viet-full-18ep-bs2-ga8-20261111/best/adapter_model.safetensors')
```

Hai SHA trên chỉ nhận diện file adapter. Khi có chuyển giao hợp lệ, cần kiểm manifest toàn gói gồm `run.json`, `best/adapter_config.json`, tokenizer và base revision. CEFR có `best/spm.model`; ByT5 tokenizer có cấu hình và special/added tokens, không suy ra tokenizer từ file weights. Chỉ lấy gói đúng run hoàn tất từ custodian; không cần `checkpoint-*` hay optimizer state để phục vụ. Giữ bản gốc, không sửa absolute path bên trong manifest chỉ để evaluator chạy; ưu tiên `--data-root` ở công cụ GEC.

## Git, package manager và hiện vật riêng

| Nguồn | Thành phần và cách dùng |
|---|---|
| Git | Code [serve.py](../../ai/writing/serve.py), [inference.py](../../ai/writing/inference.py), [default GEC](../../ai/writing/model-defaults.json), launcher [Start-Writing.ps1](../../ai/writing/Start-Writing.ps1), code chuẩn bị dữ liệu/train/đánh giá, unit tests và tài liệu trong repo. |
| Package manager | [requirements-service.txt](../../ai/writing/requirements-service.txt), [requirements.txt](../../ai/writing/requirements.txt), [requirements-evaluation.txt](../../ai/writing/requirements-evaluation.txt). Máy kiểm có Python 3.11.9, torch 2.9.1+cu126, transformers 4.57.3, tokenizers 0.22.2, PEFT 0.17.1, accelerate 1.10.1, FastAPI 0.148.0, uvicorn 0.54.0, spaCy 3.8.16, ERRANT 3.0.2. Gói spaCy `en_core_web_sm` phục vụ ERRANT, runtime tách câu bằng `spacy.blank("en")`. |
| Base models và runtime riêng | Base models tại revision chính xác từ nhà phát hành, thường cache trong `ai/writing/.cache/huggingface` trừ khi `HF_HOME` được override. CPU chạy float32 với `WRITING_DEVICE=cpu`; mặc định `auto` chọn CUDA nếu khả dụng, BF16 chỉ khi được hỗ trợ. GPU driver/Torch wheel phải tương thích. Không dùng chung GPU với run nghiên cứu nặng. |
| Checkpoint ngoài Git · BLOCKED | Hai adapter là dependency bắt buộc, đang có trên máy bàn giao. Chưa xác nhận nguồn chia sẻ được duyệt. Custodian cần xác nhận quyền từ Cambridge và điều khoản base trước khi cấp gói qua artifact store hạn chế quyền, kèm manifests/hash/version. Nếu thiếu quyền hoặc gói, máy mới vẫn chạy tests không cần weights và đọc code, nhưng chưa chạy AI thật. Tải base không thay thế adapter. |
| Dataset ngoài Git | Mỗi người dùng được cấp phép tải từ Cambridge, chuẩn bị cục bộ bằng [data.py](../../ai/writing/data.py). CEFR dùng `prepared`, GEC hiện hành dùng `prepared-first-final` có train/dev và held-out chỉ nguồn. Ghi license, raw fingerprint và split SHA. Không chia sẻ file gốc, JSONL chuẩn bị, M2/predictions và log chứa bài. [Cambridge W&I 2024 v2](https://researchdatasets.cambridge.org/datasets/write-and-improve-corpus-2024) |
| Experiment outputs ngoài Git | `run.json`, `test-metrics.json`, private reports, tokenizer cache, validation logs, test/trainer state. Kết quả lịch sử ở `artifacts/cefr-evaluation-foundation-20261028-v2` và các thư mục báo cáo nghiên cứu local. Người nhận chỉ tiếp cận bản được duyệt. |
| Feedback optional | Qwen GGUF, llama.cpp và manifest riêng, cờ `WRITING_FEEDBACK_ENABLED` mặc định tắt. Setup Writing cơ bản không cần feedback weights hoặc provider key. [Cấu hình feedback](../../ai/writing/Start-Writing.ps1) |

## Script theo vai trò

- Chuẩn bị và kiểm dữ liệu: [data.py](../../ai/writing/data.py), [prepare_verified_corpus.py](../../ai/writing/prepare_verified_corpus.py), [gec_data_paths.py](../../ai/writing/gec_data_paths.py), [training_preparation.py](../../ai/writing/training_preparation.py).
- Huấn luyện khi có phê duyệt: [train.py](../../ai/writing/train.py), [modeling.py](../../ai/writing/modeling.py), [training_state.py](../../ai/writing/training_state.py), [Writing trong README](../../README.md). Smoke/experiment runs không tự dùng làm checkpoint phục vụ.
- Chẩn đoán và đánh giá: [evaluate_gec.py](../../ai/writing/evaluate_gec.py), [audit_gec.py](../../ai/writing/audit_gec.py), [gec_evaluation.py](../../ai/writing/gec_evaluation.py), [predict.py](../../ai/writing/predict.py), [gec_gemini_replay.py](../../ai/writing/gec_gemini_replay.py). Các pilot CEFR ở máy cũ, kể cả công cụ được ignore, là bằng chứng nghiên cứu riêng.
- `gec-expanded-v1`, `gec-qvo-expanded-v1`, `gec-unicode-verified-v1` và `cefr-balanced-v1` là run lịch sử/candidate. Một số hướng dẫn cũ còn dùng `gec-expanded-v1` trong ví dụ. Đối chiếu `model-defaults.json`, `/health` và SHA trên response trước khi diễn giải chất lượng. [Thiết lập Windows](02_SETUP_WINDOWS.md) · [Protocol](06_AI_EVALUATION_PROTOCOL.md)
