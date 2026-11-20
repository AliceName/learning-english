"""Download the PUBLIC base models used by the Writing AI service, at pinned revisions.

Only public Hugging Face models are fetched (into ai/writing/.cache/huggingface unless HF_HOME is
set). The LEWA adapters (CEFR and GEC) are NOT public: get them from the project custodian and
place them under ai/writing/artifacts/ (see docs/WRITING_SETUP_FOR_AGENTS.md).

  microsoft/deberta-v3-base              CEFR base     MIT          ~0.7 GB
  google/byt5-small                      GEC base      Apache-2.0   ~1.2 GB (PyTorch weights)
  sentence-transformers/all-MiniLM-L6-v2 relevance     Apache-2.0   ~92 MB

Usage (from ai/writing):  .venv/Scripts/python.exe download_base_models.py [--only minilm]
"""
from __future__ import annotations

import argparse
import os

from data import ROOT

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))

MODELS = {
    "deberta": ("microsoft/deberta-v3-base", "8ccc9b6f36199bec6961081d44eb72fb3f7353f3"),
    "byt5": ("google/byt5-small", "68377bdc18a2ffec8a0533fef03b1c513a4dd49d"),
    "minilm": ("sentence-transformers/all-MiniLM-L6-v2", "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"),
}
# Skip TensorFlow/Flax/ONNX/Rust copies; the service loads PyTorch weights only.
IGNORE = ["*.h5", "*.msgpack", "*.onnx", "*.ot", "tf_model*", "flax_model*", "onnx/*", "openvino/*", "*.tflite"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", choices=sorted(MODELS), action="append", help="Download just these models")
    args = parser.parse_args(argv)
    from huggingface_hub import snapshot_download
    for key in args.only or list(MODELS):
        repo, revision = MODELS[key]
        path = snapshot_download(repo, revision=revision, ignore_patterns=IGNORE)
        print(f"{key}: {repo}@{revision[:8]} -> {path}")


if __name__ == "__main__":
    main()
