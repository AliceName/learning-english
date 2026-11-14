"""Shared paths, provenance and phone-level feature schema for the baseline."""
import hashlib
import json
from pathlib import Path

import yaml

from phone_mapping import PHONE_TOKENS
from project_env import ROOT

BASE_PHONES = sorted(PHONE_TOKENS)
FEATURE_NAMES = ['gop_ctc_align', 'best_other_logp', 'target_margin', 'entropy',
                 'log_active_frames', 'target_peak_logp', 'utterance_blank_fraction', 'relative_position']
FEATURE_NAMES += ['mean_logp_' + p for p in BASE_PHONES]
FEATURE_NAMES += ['source_phone_' + p for p in BASE_PHONES]
METHOD = 'gop_ctc_align_v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def file_digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def config():
    return yaml.safe_load((ROOT / 'configs/baseline.yaml').read_text(encoding='utf-8'))


def snapshot_path(cfg):
    model = cfg['acoustic_model']
    return ROOT / '.cache/huggingface/hub' / ('models--' + model['id'].replace('/', '--')) / 'snapshots' / model['revision']


def read_jsonl(path):
    with Path(path).open(encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def write_jsonl(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='\n') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
