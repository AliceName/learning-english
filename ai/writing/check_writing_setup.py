"""Check that this machine can run the LEWA Writing feature, and say how to fix what is missing.

Usage (from ai/writing):  .venv/Scripts/python.exe check_writing_setup.py
Exit code 0 = everything required is present; 1 = something required is missing.
Reads only local files; downloads nothing and never prints essay text or secrets.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

from data import ROOT

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))

ADAPTERS = {  # run directory -> expected SHA-256 of best/adapter_model.safetensors
    "cefr-my-first-run": "1c51e4e33b2cc423ba8dd6372cb0ff6c1eeffb9e2c4911045998a796c188e161",
    "gec-viet-full-18ep-bs2-ga8-20261111": "a04006b472ff51d647421637a7aea40586ab215158a4e6f229469f98afb13373",
}
BASES = {
    "microsoft/deberta-v3-base": "8ccc9b6f36199bec6961081d44eb72fb3f7353f3",
    "google/byt5-small": "68377bdc18a2ffec8a0533fef03b1c513a4dd49d",
    "sentence-transformers/all-MiniLM-L6-v2": "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
}
CATALOGUE_SHA256 = "d2a57c6f4fb6681eaba409590e90456b110baba6f4fd9bc35e771d6b5904e10b"
PACKAGES = ["torch", "transformers", "peft", "numpy", "sklearn", "fastapi", "uvicorn", "httpx", "spacy", "errant", "huggingface_hub"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def checks():
    rows = []  # (status, item, detail, fix); status: OK / MISSING (required) / OPTIONAL
    add = lambda ok, required, item, detail, fix="": rows.append(("OK" if ok else "MISSING" if required else "OPTIONAL", item, detail, "" if ok else fix))
    add(sys.version_info[:2] == (3, 11), True, "Python 3.11", sys.version.split()[0], "Create the venv with Python 3.11 (docs/WRITING_SETUP_FOR_AGENTS.md step 2).")
    install = r"pip install -r requirements-service.txt"
    for name in PACKAGES:
        add(importlib.util.find_spec(name) is not None, True, f"package {name}", "", install)
    spacy_model = importlib.util.find_spec("spacy") is not None and __import__("spacy.util").util.is_package("en_core_web_sm")
    add(spacy_model, True, "spaCy en_core_web_sm", "needed for explanation types (v2)", install)
    try:
        from huggingface_hub import try_to_load_from_cache
        for repo, revision in BASES.items():
            cached = try_to_load_from_cache(repo, "config.json", revision=revision)
            add(isinstance(cached, str), True, f"base {repo}", revision[:8], "python download_base_models.py")
    except ImportError:
        add(False, True, "huggingface_hub", "", install)
    defaults = json.loads((ROOT / "model-defaults.json").read_text(encoding="utf-8"))
    for run, expected in ADAPTERS.items():
        file = ROOT / "artifacts" / run / "best" / "adapter_model.safetensors"
        ok = file.is_file() and sha256(file) == expected
        add(ok, True, f"adapter {run}", "present, SHA matches" if ok else ("SHA differs" if file.is_file() else "not found"),
            f"Get the approved adapter bundle from the custodian and unpack it to ai/writing/artifacts/{run}/ (step 4).")
    add(defaults.get("gecRun", "").endswith(next(r for r in ADAPTERS if r.startswith("gec"))), True, "model-defaults.json gecRun",
        defaults.get("gecRun", ""), "Do not edit model-defaults.json; restore it from Git.")
    relevance = ROOT / "config" / "relevance-minilm-v1.json"
    add(relevance.is_file(), False, "relevance thresholds", str(relevance.relative_to(ROOT)),
        "python calibrate_relevance.py --corpus <W&I corpus>/whole-corpus --device cpu (step 6). Without it there is no relevance score.")
    catalogue = ROOT / "data" / "prompt-catalogue.v1.json"
    ok = catalogue.is_file() and sha256(catalogue) == CATALOGUE_SHA256
    add(ok, False, "task library (50 W&I prompts)", "present, SHA matches" if ok else ("SHA differs" if catalogue.is_file() else "not built"),
        "python build_prompt_catalogue.py --source <W&I corpus>/whole-corpus/en-writeandimprove2024-prompts-info.tsv (step 5). "
        "Without it Writing works with custom topics only and no relevance score.")
    return rows


def main():
    rows = checks()
    for status, item, detail, fix in rows:
        print(f"[{status:8}] {item}" + (f" — {detail}" if detail else ""))
        if fix:
            print(f"           fix: {fix}")
    missing = [r for r in rows if r[0] == "MISSING"]
    print(f"\n{len(rows) - len(missing)}/{len(rows)} checks passed" + (" — fix the MISSING items above." if missing else "."))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
