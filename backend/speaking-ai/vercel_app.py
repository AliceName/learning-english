"""Vercel entrypoint with bundled assets and server-to-server authentication."""
import os
from pathlib import Path
from tempfile import gettempdir

from espeakng_loader import get_data_path, get_library_path

from app import create_app
from engine import SpeakingEngine


def create_engine():
    assets = Path(__file__).resolve().parent / "vercel_assets"
    os.environ.setdefault("HF_HOME", str(Path(gettempdir()) / "lewa-huggingface"))
    os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = get_library_path()
    os.environ["ESPEAK_DATA_PATH"] = str(Path(get_data_path()).parent)
    return SpeakingEngine(assets / "training", model_path=assets / "model")


api_token = os.getenv("SPEAKING_API_TOKEN", "").strip()
if not api_token:
    raise RuntimeError("Set SPEAKING_API_TOKEN to run the hosted Speaking service.")

app = create_app(api_token=api_token, engine_factory=create_engine)
