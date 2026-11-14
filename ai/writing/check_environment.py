"""Read-only check before downloading models or running a training job."""
import importlib.metadata
import json
import shutil
from pathlib import Path

import torch

cuda = torch.cuda.is_available()
report = {
    "torch": torch.__version__,
    "cuda_runtime": torch.version.cuda,
    "cuda_available": cuda,
    "bf16_supported": cuda and torch.cuda.is_bf16_supported(),
    "disk_free_gib": round(shutil.disk_usage(Path(__file__).anchor).free / 1024**3, 1),
    "packages": {p: importlib.metadata.version(p) for p in ("transformers", "peft", "accelerate")},
}
if cuda:
    free, total = torch.cuda.mem_get_info()
    report.update(gpu=torch.cuda.get_device_name(0), free_vram_mib=round(free / 1024**2),
                  total_vram_mib=round(total / 1024**2))
print(json.dumps(report, indent=2))
