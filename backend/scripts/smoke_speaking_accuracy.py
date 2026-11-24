"""One public-data engineering smoke test, never a Vietnamese accuracy metric."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import sys


def available_memory():
    if os.name != 'nt': return None
    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong),
            *[(field, ctypes.c_ulonglong) for field in ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]]
    memory = Memory(); memory.length = ctypes.sizeof(memory)
    return memory.available if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists(): parser.error('Choose a new output path')
    memory = available_memory()
    if memory is not None and memory < 3 * 1024 ** 3:
        args.output.write_text(json.dumps({'status': 'skipped_low_memory', 'available_bytes': memory}), encoding='utf-8')
        print('Skipped model loading: insufficient free RAM.'); return
    root = Path(__file__).resolve().parents[2]
    os.environ['SPEAKING_DEVICE'] = 'cpu'
    sys.path.insert(0, str(root / 'backend/speaking-ai'))
    from engine import RecordingError, SpeakingEngine
    engine = SpeakingEngine()
    reference = 'The decision was a pleasure to discuss.'
    support = engine.training_support
    engine.training_support = None
    try:
        _, _, before, _ = engine.build_reference(reference)
    finally:
        engine.training_support = support
    _, _, after, words = engine.build_reference(reference)
    assert any(phone['base_phone'] == 'ZH' for phone in before), 'Smoke sentence did not exercise the unseen phone'
    assert not any(phone['base_phone'] == 'ZH' for phone in after)
    assert any(word.get('reason') for word in words), 'Incomplete word must disclose partial support'
    source = json.loads((root / 'backend/reports/speaking-score-calibration/live-after.json').read_text(encoding='utf-8'))['realDatasetSample']
    audio = Path(source['audioSource']).read_bytes()
    trace = {}
    try:
        assessment = engine.score(audio, source['text'], trace=trace)
        assert assessment['coverage'] > 0 and len(trace.get('phonePredictions', [])) > 0
        outcome = {'status': 'assessed', 'assessment': assessment}
    except RecordingError as error:
        outcome = {'status': 'recording_rejected', 'recordingIssue': error.recording_issue, 'title': str(error)}
        assert trace.get('modelVersion'), 'Inference did not start'
    report = {'status': 'engineering_smoke_passed', 'available_memory_before_bytes': memory,
        'modelVersion': engine.model_version, 'untrained_phone': 'ZH',
        'phone_candidates_before': len(before), 'supported_candidates_after': len(after),
        'sample_source': 'existing public SpeechOcean762 engineering fixture', 'sample_text': source['text'],
        'audio_sha256': hashlib.sha256(audio).hexdigest(), 'outcome': outcome, 'trace': trace,
        'limitations': 'One public sample and a reference-mapping assertion do not validate Vietnamese grading accuracy.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'sample_status': outcome['status'],
        'phone_candidates_before': len(before), 'supported_candidates_after': len(after)}), flush=True)


if __name__ == '__main__': main()
