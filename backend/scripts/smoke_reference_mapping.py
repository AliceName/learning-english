"""Local service smoke check. Synthetic audio is not a pronunciation benchmark."""
import argparse
import json
from pathlib import Path
import time
import httpx


def main(directory, phase, training, output_directory=None):
    report = {'phase': phase, 'syntheticAudio': True, 'humanAccuracyMeasured': False, 'samples': []}
    with httpx.Client(base_url='http://127.0.0.1:8001', timeout=90) as client:
        report['health'] = client.get('/health').json()
        cases = json.loads((directory / 'smoke-input.json').read_text(encoding='utf-8'))
        for case in cases:
            path = directory / 'smoke-audio' / (case['level'] + '.wav')
            for attempt in range(3):
                with path.open('rb') as stream:
                    response = client.post('/score', files={'file': (path.name, stream, 'audio/wav')}, data={'text': case['text']})
                if response.status_code != 429:
                    break
                time.sleep(1)
            result = {'level': case['level'], 'id': case['id'], 'text': case['text'], 'statusCode': response.status_code, 'result': response.json()}
            report['samples'].append(result)
            print(f"{phase} {case['level']}: HTTP {response.status_code}", flush=True)
        path = training / 'speechocean762-main/WAVE/SPEAKER0001/000010011.WAV'
        with path.open('rb') as stream:
            response = client.post('/score', files={'file': (path.name, stream, 'audio/wav')}, data={'text': 'We call it bear'})
        report['realDatasetSample'] = {'audioSource': str(path), 'text': 'We call it bear', 'statusCode': response.status_code, 'result': response.json()}
    output_directory = output_directory or directory
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / f'live-{phase}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"{phase} real sample: HTTP {response.status_code}", flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('directory', type=Path)
    p.add_argument('--phase', choices=('before', 'after'), required=True)
    p.add_argument('--training-root', type=Path, required=True)
    p.add_argument('--output-directory', type=Path, help='Store new evidence separately from the input/baseline report')
    args = p.parse_args()
    main(args.directory, args.phase, args.training_root, args.output_directory)
