"""Project-local caches and eSpeak configuration shared by helper scripts."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def configure_environment():
    for name in (
        '.cache/huggingface', '.cache/pip', 'data/raw', 'data/processed',
        'data/manifests', 'features', 'checkpoints', 'reports', 'logs', 'notebooks',
    ):
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('HF_HOME', str(ROOT / '.cache/huggingface'))
    os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
    os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '120')
    os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
    library = ROOT / '.tools/espeak-ng/eSpeak NG/libespeak-ng.dll'
    if library.is_file():
        os.environ.setdefault('PHONEMIZER_ESPEAK_LIBRARY', str(library))
        os.environ.setdefault('ESPEAK_DATA_PATH', str(library.parent))

