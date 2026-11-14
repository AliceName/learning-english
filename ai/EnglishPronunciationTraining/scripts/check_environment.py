"""Check actual CUDA operations, audio decoding, G2P and training dependencies."""
import argparse
from datetime import datetime, timezone
import importlib
import importlib.metadata
import json
import platform
import sys

from project_env import ROOT, configure_environment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-cuda', action='store_true')
    args = parser.parse_args()
    configure_environment()
    sys.stdout.reconfigure(encoding='utf-8')
    report = {
        'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'python': sys.version, 'executable': sys.executable,
        'platform': platform.platform(), 'packages': {}, 'errors': [],
    }
    imports = {
        'torch': 'torch', 'torchaudio': 'torchaudio', 'transformers': 'transformers',
        'accelerate': 'accelerate', 'datasets': 'datasets', 'numpy': 'numpy',
        'scipy': 'scipy', 'pandas': 'pandas', 'scikit-learn': 'sklearn',
        'soundfile': 'soundfile', 'phonemizer': 'phonemizer', 'cmudict': 'cmudict',
        'sentencepiece': 'sentencepiece', 'PyYAML': 'yaml', 'matplotlib': 'matplotlib',
        'tqdm': 'tqdm', 'tensorboard': 'tensorboard', 'ipykernel': 'ipykernel',
    }
    for package, module in imports.items():
        try:
            importlib.import_module(module)
            report['packages'][package] = importlib.metadata.version(package)
        except Exception as exc:
            report['errors'].append(f'{package}: {type(exc).__name__}: {exc}')
    try:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        from torch.utils.tensorboard import SummaryWriter
        report['wav2vec2_import'] = bool(Wav2Vec2ForCTC and Wav2Vec2Processor)
        report['tensorboard_writer_import'] = bool(SummaryWriter)
        report['cuda_available'] = torch.cuda.is_available()
        report['cuda_runtime'] = torch.version.cuda
        if args.require_cuda and not report['cuda_available']:
            raise RuntimeError('CUDA is required but unavailable')
        device = torch.device('cuda' if report['cuda_available'] else 'cpu')
        torch.manual_seed(42)
        if device.type == 'cuda':
            prop = torch.cuda.get_device_properties(0)
            report['gpu'] = {
                'name': prop.name, 'vram_gib': round(prop.total_memory / 2**30, 2),
                'compute_capability': list(torch.cuda.get_device_capability(0)),
                'compiled_architectures': torch.cuda.get_arch_list(),
            }
        # A real optimizer step verifies CUDA kernels and backward, not just detection.
        model = torch.nn.Sequential(
            torch.nn.Linear(32, 128), torch.nn.ReLU(), torch.nn.Dropout(0.2),
            torch.nn.Linear(128, 64), torch.nn.ReLU(), torch.nn.Linear(64, 1),
        ).to(device)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        x = torch.randn(128, 32, device=device)
        target = torch.rand(128, 1, device=device) * 2
        optimizer.zero_grad(set_to_none=True)
        prediction = 2 * model(x).sigmoid()
        loss = torch.nn.functional.huber_loss(prediction, target)
        loss.backward()
        optimizer.step()
        if device.type == 'cuda':
            torch.cuda.synchronize()
        if not torch.isfinite(loss):
            raise RuntimeError('Non-finite loss in optimizer check')
        report['optimizer_check'] = {'device': str(device), 'loss': loss.item()}
    except Exception as exc:
        report['errors'].append(f'compute: {type(exc).__name__}: {exc}')
    try:
        from phonemizer import phonemize
        from phonemizer.separator import Separator
        report['g2p_example'] = phonemize(
            'Think about it.', language='en-us', backend='espeak', strip=True,
            separator=Separator(phone=' ', word=' | ', syllable=''),
        )
        import cmudict
        report['cmudict_example'] = cmudict.dict().get('think')
    except Exception as exc:
        report['errors'].append(f'g2p: {type(exc).__name__}: {exc}')
    try:
        import soundfile as sf
        dataset = ROOT / 'speechocean762-main'
        speakers = {}
        for split in ('train', 'test'):
            rows = [line.split() for line in (dataset / split / 'utt2spk').read_text().splitlines() if line.strip()]
            speakers[split] = {row[1] for row in rows}
            report[f'dataset_{split}'] = {'utterances': len(rows), 'speakers': len(speakers[split])}
        overlap = speakers['train'] & speakers['test']
        if overlap:
            raise RuntimeError(f'Speaker overlap between train/test: {sorted(overlap)}')
        uid, relative_path = (dataset / 'train/wav.scp').read_text().splitlines()[0].split(maxsplit=1)
        audio, sr = sf.read(dataset / relative_path, dtype='float32')
        report['audio_check'] = {
            'utterance_id': uid, 'sample_rate': sr, 'shape': list(audio.shape),
            'duration_seconds': len(audio) / sr,
        }
        if sr != 16000 or audio.ndim != 1:
            raise RuntimeError('Expected mono 16 kHz audio in this dataset')
    except Exception as exc:
        report['errors'].append(f'dataset: {type(exc).__name__}: {exc}')
    report['status'] = 'passed' if not report['errors'] else 'failed'
    output = ROOT / 'reports/environment-check.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'Report: {output}')
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())

