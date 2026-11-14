"""Run one training-set recording through the pinned, frozen acoustic model.

This verifies inference only; it does not compute GOP or pronunciation scores.
"""
import argparse
from datetime import datetime, timezone
import json
import sys
import time

from project_env import ROOT, configure_environment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', choices=('cuda', 'cpu'), default='cuda')
    parser.add_argument('--local-files-only', action='store_true')
    args = parser.parse_args()
    configure_environment()
    sys.stdout.reconfigure(encoding='utf-8')
    import numpy as np
    import soundfile as sf
    import torch
    import yaml
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    config = yaml.safe_load((ROOT / 'configs/baseline.yaml').read_text(encoding='utf-8'))
    acoustic = config['acoustic_model']
    if args.device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA unavailable. Check environment or use --device cpu.')
    torch.set_num_threads(2)
    dataset = ROOT / config['dataset']['root']
    uid, relative_path = (dataset / 'train/wav.scp').read_text().splitlines()[0].split(maxsplit=1)
    reference = dict(line.split(maxsplit=1) for line in (dataset / 'train/text').read_text().splitlines() if line.strip())[uid]
    audio, sr = sf.read(dataset / relative_path, dtype='float32')
    if audio.ndim != 1 or sr != config['audio']['sample_rate']:
        raise ValueError('Smoke-test input must be mono at the configured sample rate')
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError('Empty or invalid input audio')
    print(f'Loading pinned checkpoint {acoustic["id"]}@{acoustic["revision"]}', flush=True)
    common = {'revision': acoustic['revision'], 'local_files_only': args.local_files_only}
    processor = Wav2Vec2Processor.from_pretrained(acoustic['id'], **common)
    dtype = torch.float32 if args.device == 'cpu' else getattr(torch, acoustic['dtype'])
    model = Wav2Vec2ForCTC.from_pretrained(
        acoustic['id'], dtype=dtype, low_cpu_mem_usage=True,
        attn_implementation=acoustic['attention_implementation'],
        use_safetensors=False, **common,
    ).to(args.device)
    model.eval()
    model.requires_grad_(False)
    inputs = processor(audio, sampling_rate=sr, return_tensors='pt')
    input_values = inputs.input_values.to(device=args.device, dtype=dtype)
    if args.device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
    started = time.perf_counter()
    with torch.inference_mode():
        logits = model(input_values).logits
    if args.device == 'cuda':
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - started
    if not torch.isfinite(logits).all():
        raise RuntimeError('Non-finite acoustic logits')
    report = {
        'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'status': 'passed', 'purpose': 'acoustic inference only, not pronunciation assessment',
        'model_id': acoustic['id'], 'revision': acoustic['revision'],
        'device': args.device, 'dtype': str(dtype), 'frozen': not any(p.requires_grad for p in model.parameters()),
        'utterance_id': uid, 'reference_text': reference,
        'audio_seconds': len(audio) / sr, 'logits_shape': list(logits.shape),
        'decoded_phones': processor.batch_decode(logits.argmax(dim=-1).cpu())[0],
        # SpeechOcean text is uppercase; lowercase ordinary words so eSpeak
        # does not read words such as IT as individual letter names.
        'g2p_input_text': reference.lower(),
        'reference_g2p': processor.tokenizer.phonemize(reference.lower()),
        'inference_seconds': round(elapsed, 3),
        'peak_cuda_allocated_mib': round(torch.cuda.max_memory_allocated() / 2**20, 1) if args.device == 'cuda' else None,
    }
    output = ROOT / 'reports/model-smoke-test.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f'Report: {output}')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        (ROOT / 'reports').mkdir(parents=True, exist_ok=True)
        failure = {
            'checked_at_utc': datetime.now(timezone.utc).isoformat(),
            'status': 'failed', 'error': f'{type(exc).__name__}: {exc}',
        }
        (ROOT / 'reports/model-smoke-test.json').write_text(
            json.dumps(failure, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
        )
        raise

