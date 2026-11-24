"""Assemble inference assets before Vercel packages the Function."""
from pathlib import Path
from shutil import copy2

from huggingface_hub import snapshot_download
import yaml


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "vercel_assets"
TRAINING = ROOT.parents[1] / "ai" / "EnglishPronunciationTraining"
TRAINING_FILES = (
    "checkpoints/pronunciation_scorer.pt",
    "configs/baseline.yaml",
    "configs/phone_mapping.json",
    "scripts/gop_ctc.py",
    "scripts/phone_mapping.py",
    "scripts/project_env.py",
    "scripts/scorer_model.py",
    "scripts/training_common.py",
)
MODEL_FILES = (
    "config.json",
    "preprocessor_config.json",
    "pytorch_model.bin",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "vocab.json",
)


def main():
    for name in TRAINING_FILES:
        target = ASSETS / "training" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copy2(TRAINING / name, target)

    config = yaml.safe_load((TRAINING / "configs/baseline.yaml").read_text(encoding="utf-8"))
    model = config["acoustic_model"]
    model_path = ASSETS / "model"
    snapshot_download(
        repo_id=model["id"],
        revision=model["revision"],
        local_dir=model_path,
        allow_patterns=list(MODEL_FILES),
    )
    for name in MODEL_FILES:
        if not (model_path / name).is_file():
            raise RuntimeError(f"Missing acoustic model file: {name}")
    print(f"Prepared Speaking assets for {model['id']} at {model['revision']}.")


if __name__ == "__main__":
    main()
