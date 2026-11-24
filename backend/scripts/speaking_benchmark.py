"""Local, blind Vietnamese Speaking collection and reproducible evaluation.

prepare -> serve (record/two human raters) -> score -> evaluate -> fit-gate.
No database, automatic labels, test-set tuning or production threshold changes.
"""
import argparse
import csv
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlparse
import wave

from evaluate_speaking_human import DEFAULT_CALIBRATION, evaluate as evaluate_units, load_calibration

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path(__file__).with_name('speaking-lab')
PROMPTS = [
    ('read', 'I think this is the right thing to do.', ''),
    ('read', 'She sells fresh fish at the shop.', ''),
    ('read', 'Please put the blue book on the desk.', ''),
    ('read', 'The boys are playing football outside.', ''),
    ('read', 'I would like a cup of water.', ''),
    ('read', 'We watched a film last night.', ''),
    ('read', 'He walks to school every morning.', ''),
    ('read', 'There is a little bird near the window.', ''),
    ('read', 'The decision was a pleasure to discuss.', ''),
    ('read', 'My brother brought three red apples.', ''),
    ('read', 'I read a book every evening.', ''),
    ('read', 'Yesterday I read a book about music.', ''),
    ('omit_word', 'She likes playing badminton with her friends.', 'She likes badminton with her friends.'),
    ('different_sentence', 'The children are waiting for the bus.', 'I bought some fruit at the market.'),
    ('background_noise', 'We need to finish the work before Friday.', ''),
]
LABEL_FIELDS = ['recordingId', 'unitId', 'unitType', 'wordIndex', 'word', 'score', 'audioSha256']
GATE_FIELDS = ['recordingId', 'readMatch', 'usableAudio', 'actualText', 'audioSha256']
WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def write_jsonl(path, rows):
    path.write_text(''.join(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n' for row in rows), encoding='utf-8')


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def write_csv(path, rows, fields):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader(); writer.writerows(rows)
    temporary.replace(path)


def cases(workspace):
    rows = read_jsonl(workspace / 'manifest.jsonl')
    seen, speakers = set(), {}
    for row in rows:
        rid = row['recordingId']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', rid) or rid in seen:
            raise ValueError('Invalid/duplicate recordingId')
        seen.add(rid)
        if row['split'] not in ('train', 'calibration', 'test') or row['nativeLanguage'] != 'vi':
            raise ValueError('Invalid split or native language')
        if speakers.setdefault(row['speakerId'], row['split']) != row['split']:
            raise ValueError('Speaker leakage across splits')
        text = row['referenceText']
        if len(text) > 300 or not 1 <= len(WORD.findall(text)) <= 35 or re.search(r'[^A-Za-z\s\x27’.,!?;:\-"()]', text):
            raise ValueError('Invalid reference text')
    return rows


def audio_path(workspace, rid):
    path = (workspace / 'audio' / (rid + '.wav')).resolve()
    if not path.is_relative_to(workspace.resolve()):
        raise ValueError('Audio path leaves workspace')
    return path


def validate_wav(data):
    if not 44 <= len(data) <= 2 * 1024 * 1024:
        raise ValueError('WAV tối đa 2 MB.')
    try:
        with wave.open(io.BytesIO(data)) as source:
            if source.getcomptype() != 'NONE' or source.getsampwidth() != 2 or source.getnchannels() not in (1, 2):
                raise ValueError('Cần WAV PCM16 mono/stereo.')
            if not 8000 <= source.getframerate() <= 96000 or not .3 <= source.getnframes() / source.getframerate() <= 12.02:
                raise ValueError('WAV cần dài từ 0,3 đến 12 giây.')
            if len(source.readframes(source.getnframes())) != source.getnframes() * source.getnchannels() * 2:
                raise ValueError('WAV bị thiếu dữ liệu.')
    except (wave.Error, EOFError) as error:
        raise ValueError('Không đọc được WAV PCM16.') from error


def prepare(workspace, count=20):
    if not 5 <= count <= 100:
        raise ValueError('Use 5..100 planned speakers')
    workspace.mkdir(parents=True, exist_ok=False)
    (workspace / 'audio').mkdir()
    rows = []
    for speaker in range(1, count + 1):
        split = 'train' if speaker <= int(count * .6) else 'calibration' if speaker <= int(count * .8) else 'test'
        for prompt, (scenario, text, spoken) in enumerate(PROMPTS, 1):
            rows.append({'recordingId': f'vi{speaker:03d}_p{prompt:02d}', 'speakerId': f'vi{speaker:03d}',
                'split': split, 'nativeLanguage': 'vi', 'referenceText': text, 'scenario': scenario,
                'collectionText': spoken or text, 'status': 'planned'})
    write_jsonl(workspace / 'manifest.jsonl', rows)
    units = [{'recordingId': row['recordingId'], 'unitId': f'word:{index}', 'unitType': 'word',
        'wordIndex': index, 'word': word, 'score': '', 'audioSha256': ''}
        for row in rows for index, word in enumerate(WORD.findall(row['referenceText']))]
    gates = [{'recordingId': row['recordingId'], **{field: '' for field in GATE_FIELDS[1:]}} for row in rows]
    for reviewer in ('1', '2'):
        write_csv(workspace / f'words-rater-{reviewer}.csv', units, LABEL_FIELDS)
        write_csv(workspace / f'content-rater-{reviewer}.csv', gates, GATE_FIELDS)
    write_json(workspace / 'collection-status.json', {'status': 'awaiting_human_recordings',
        'planned_speakers': count, 'planned_recordings': len(rows), 'actual_recordings': 0,
        'note': 'Planned tasks are not observations, human labels or proof of accuracy.'})
    return rows


def score(workspace, output, training_root, include_test=False, limit=None):
    rows, engine, results = cases(workspace), None, []
    sys.path.insert(0, str(ROOT / 'backend/speaking-ai'))
    for row in rows:
        if row['split'] == 'test' and not include_test:
            continue
        path = audio_path(workspace, row['recordingId'])
        if not path.is_file():
            continue
        if limit is not None and len(results) >= limit:
            break
        data = path.read_bytes(); validate_wav(data)
        if engine is None:
            from engine import SpeakingEngine
            engine = SpeakingEngine(training_root)
        from engine import RecordingError
        trace = {}
        result = {'recordingId': row['recordingId'], 'referenceText': row['referenceText'], 'audioSha256': sha(data)}
        try:
            result['assessment'] = engine.score(data, row['referenceText'], trace=trace)
            result['status'] = 'scored'
        except RecordingError as error:
            result.update(status='rejected', title=str(error), recordingIssue=error.recording_issue)
        result.update(modelVersion=engine.model_version, trace=trace)
        results.append(result)
        print(row['recordingId'] + ': ' + result['status'], flush=True)
    write_jsonl(output, results)
    return {'status': 'scored' if results else 'insufficient_data', 'recordings_scored': len(results),
            'held_out_test_opened': include_test, 'output': str(output)}


def consensus(workspace, splits=None):
    all_cases = {row['recordingId']: row for row in cases(workspace)}
    manifest = {rid: row for rid, row in all_cases.items() if splits is None or row['split'] in splits}
    gates, words = [], []
    rating = []
    for reviewer in ('1', '2'):
        contents = read_csv(workspace / f'content-rater-{reviewer}.csv')
        units = read_csv(workspace / f'words-rater-{reviewer}.csv')
        gm, wm = {}, {}
        for row in contents:
            if row['recordingId'] not in all_cases: raise ValueError('Unknown content label')
            if row['recordingId'] not in manifest: continue
            if row['recordingId'] in gm:
                raise ValueError('Unknown/duplicate content label')
            if row['readMatch'] not in ('', 'yes', 'no', 'uncertain') or row['usableAudio'] not in ('', 'yes', 'no', 'uncertain'):
                raise ValueError('Invalid human content decision')
            gm[row['recordingId']] = row
        for row in units:
            key = (row['recordingId'], row['unitId'])
            if row['recordingId'] not in all_cases: raise ValueError('Unknown word label')
            if row['recordingId'] not in manifest: continue
            case = manifest.get(row['recordingId'])
            if case is None or key in wm or row['unitType'] != 'word':
                raise ValueError('Unknown/duplicate word label')
            index = int(row['wordIndex'])
            source = WORD.findall(case['referenceText'])
            if index < 0 or index >= len(source) or row['unitId'] != f'word:{index}' or row['word'] != source[index]:
                raise ValueError('Human label word ownership changed')
            if row['score']:
                value = float(row['score'])
                if not math.isfinite(value) or not 0 <= value <= 2:
                    raise ValueError('Human word score must be 0..2')
            wm[key] = row
        rating.append((gm, wm))
    hashes = {}
    def valid_audio(row):
        rid = row['recordingId']
        if rid not in hashes:
            path = audio_path(workspace, rid)
            hashes[rid] = sha(path.read_bytes()) if path.is_file() else None
        if not hashes[rid] or row['audioSha256'] != hashes[rid]:
            raise ValueError('Labels do not belong to current WAV: ' + rid)
    pending, disagreements = 0, 0
    for rid, case in manifest.items():
        pair = [group[0].get(rid) for group in rating]
        if any(not row or not row['readMatch'] or not row['usableAudio'] for row in pair):
            pending += 1; continue
        for row in pair: valid_audio(row)
        if any(pair[0][field] != pair[1][field] or pair[0][field] == 'uncertain' for field in ('readMatch', 'usableAudio')):
            disagreements += 1; continue
        gates.append({**case, 'readMatch': pair[0]['readMatch'] == 'yes',
                      'usableAudio': pair[0]['usableAudio'] == 'yes', 'audioSha256': hashes[rid]})
        if pair[0]['readMatch'] != 'yes' or pair[0]['usableAudio'] != 'yes':
            continue
        for index, _ in enumerate(WORD.findall(case['referenceText'])):
            key = (rid, f'word:{index}')
            wp = [group[1].get(key) for group in rating]
            if any(not row or not row['score'] for row in wp): continue
            for row in wp: valid_audio(row)
            scores = [float(row['score']) for row in wp]
            if abs(scores[0] - scores[1]) > 1:
                disagreements += 1; continue
            words.append({'recordingId': rid, 'unitId': key[1], 'unitType': 'word', 'speakerId': case['speakerId'],
                'split': case['split'], 'referenceText': case['referenceText'], 'nativeLanguage': 'vi',
                'source': 'human', 'humanScores': scores})
    return gates, words, {'pending_recordings': pending, 'disagreements_requiring_review': disagreements}


def predictions(workspace, path, splits=None):
    manifest = {row['recordingId']: row for row in cases(workspace)}
    results = {}
    for row in read_jsonl(path):
        rid = row['recordingId']
        if rid not in manifest: raise ValueError('Unknown prediction')
        if splits is not None and manifest[rid]['split'] not in splits: continue
        if rid not in manifest or rid in results or row['referenceText'] != manifest[rid]['referenceText']:
            raise ValueError('Unknown/duplicate/mismatched prediction')
        audio = audio_path(workspace, rid)
        if not audio.is_file() or sha(audio.read_bytes()) != row['audioSha256']:
            raise ValueError('Prediction belongs to another WAV: ' + rid)
        results[rid] = row
    if len({row['modelVersion'] for row in results.values()}) > 1:
        raise ValueError('Freeze one model version per scoring run')
    return results


def gate_metrics(rows, results, threshold=.7):
    paired = []
    for row in rows:
        result = results.get(row['recordingId'])
        trace = result.get('trace', {}) if result else {}
        ratio = trace.get('phonemeEditRatio')
        count = trace.get('decodedTokenCount')
        if not row['usableAudio'] or type(ratio) not in (int, float) or not math.isfinite(ratio) or not 0 <= ratio <= 1:
            continue
        if type(count) is not int or count < 0 or trace.get('hasClipping') is not False:
            continue
        paired.append((row['readMatch'], count == 0 or ratio > threshold))
    correct = sum(match for match, _ in paired)
    wrong = len(paired) - correct
    false_reject = sum(match and rejected for match, rejected in paired)
    false_accept = sum(not match and not rejected for match, rejected in paired)
    return {'scope': 'phoneme_distance_gate_only', 'labeled_recordings': len(rows), 'measured_recordings': len(paired),
        'correct_sentence_recordings': correct, 'wrong_sentence_recordings': wrong,
        'false_rejections': false_reject, 'false_acceptances': false_accept,
        'false_rejection_rate': false_reject / correct if correct else None,
        'false_acceptance_rate': false_accept / wrong if wrong else None,
        'reject_threshold': threshold,
        'balanced_error': (false_reject / correct + false_accept / wrong) / 2 if correct and wrong else None}


def evaluate(workspace, path, output, candidate=None):
    gates, labels, pending = consensus(workspace)
    scored = predictions(workspace, path)
    calibration = load_calibration(DEFAULT_CALIBRATION)
    exported = []
    for label in labels:
        prediction = scored.get(label['recordingId'])
        if prediction is None: continue
        assessment = prediction.get('assessment') or {}
        word_index = int(label['unitId'].split(':')[1])
        words = assessment.get('words', [])
        word = next((word for word in words if word['index'] == word_index), None)
        interpretation = assessment.get('interpretation') or {}
        if assessment and interpretation.get('calibrationVersion') != calibration['calibration_id']:
            raise ValueError('Prediction uses another calibration artifact')
        status = 'rejected' if prediction['status'] == 'rejected' else 'record_again' if interpretation.get('feedbackMode') == 'record_again' else 'scored'
        if status == 'scored' and (not word or word['status'] != 'scored' or word.get('reason')):
            status = 'unsupported'
        exported.append({**{key: label[key] for key in ('recordingId', 'unitId', 'referenceText')},
            'modelVersion': prediction['modelVersion'], 'calibrationId': calibration['calibration_id'],
            'status': status, 'score': word['score'] if status == 'scored' else None})
    report = evaluate_units(labels, exported, calibration)
    report['human_review'] = pending
    report['input_sha256'] = {name: sha((workspace / name).read_bytes()) for name in
        ('manifest.jsonl', 'words-rater-1.csv', 'words-rater-2.csv', 'content-rater-1.csv', 'content-rater-2.csv')}
    report['input_sha256']['predictions'] = sha(path.read_bytes())
    report['input_sha256']['calibration'] = sha(DEFAULT_CALIBRATION.read_bytes())
    report['content_gate'] = {split: gate_metrics([row for row in gates if row['split'] == split], scored)
                              for split in ('calibration', 'test')}
    if candidate:
        fit = json.loads(candidate.read_text(encoding='utf-8'))
        if fit.get('status') != 'candidate_only' or fit['modelVersion'] != next(iter(scored.values()), {}).get('modelVersion'):
            raise ValueError('Gate candidate is unavailable or uses another model')
        threshold = fit.get('reject_threshold')
        if type(threshold) not in (int, float) or not math.isfinite(threshold) or not .4 <= threshold <= .9:
            raise ValueError('Invalid gate candidate threshold')
        if fit.get('manifest_sha256') != sha((workspace / 'manifest.jsonl').read_bytes()):
            raise ValueError('Gate candidate belongs to another manifest')
        test = [row for row in gates if row['split'] == 'test']
        if set(fit['fit_speakers']) & {row['speakerId'] for row in test}:
            raise ValueError('Gate fit speakers overlap held-out speakers')
        report['content_gate']['candidate_test'] = gate_metrics(test, scored, fit['reject_threshold'])
    report['limitations'].extend(['Content match and pronunciation quality are evaluated separately.',
        'Content metrics exclude clipped, unusable and missing-trace recordings; no_speech and alignment failures need separate review.',
        'Word scores are exported automatically only for fully supported words; phoneme assessment still needs manually checked unit alignment.'])
    report['recording_outcomes'] = {}
    report['recording_outcomes_by_human_content'] = {'matched': {}, 'different': {}, 'unusable_audio': {}}
    for row in gates:
        result = scored.get(row['recordingId'])
        label = 'missing_prediction' if result is None else 'rejected:' + str((result.get('recordingIssue') or {}).get('code', 'other')) if result['status'] == 'rejected' else 'record_again' if result['assessment'].get('interpretation', {}).get('feedbackMode') == 'record_again' else 'assessed'
        report['recording_outcomes'][label] = report['recording_outcomes'].get(label, 0) + 1
        group = 'unusable_audio' if not row['usableAudio'] else 'matched' if row['readMatch'] else 'different'
        bucket = report['recording_outcomes_by_human_content'][group]
        bucket[label] = bucket.get(label, 0) + 1
    for sidecar in (output.with_suffix('.human.jsonl'), output.with_suffix('.predictions.jsonl')):
        if sidecar.exists(): raise ValueError('Evaluation sidecar already exists: ' + str(sidecar))
    write_json(output, report)
    write_jsonl(output.with_suffix('.human.jsonl'), labels)
    write_jsonl(output.with_suffix('.predictions.jsonl'), exported)
    return report


def fit_gate(workspace, path, output):
    gates, _, pending = consensus(workspace, {'calibration'})
    scored = predictions(workspace, path, {'calibration'})
    rows = [row for row in gates if row['split'] == 'calibration']
    baseline = gate_metrics(rows, scored)
    valid_ids = {row['recordingId'] for row in rows if gate_metrics([row], scored)['measured_recordings']}
    speakers = sorted({row['speakerId'] for row in rows if row['recordingId'] in valid_ids})
    result = {'status': 'insufficient_data', 'baseline': baseline, 'human_review': pending,
        'production_modified': False, 'fit_speakers': speakers,
        'manifest_sha256': sha((workspace / 'manifest.jsonl').read_bytes()),
        'modelVersion': next(iter(scored.values()), {}).get('modelVersion')}
    if baseline['balanced_error'] is not None and len(speakers) >= 2:
        grid = [gate_metrics(rows, scored, round(.4 + index * .025, 3)) for index in range(21)]
        best = min(grid, key=lambda value: (value['balanced_error'], abs(value['reject_threshold'] - .7)))
        result.update(status='candidate_only', reject_threshold=best['reject_threshold'], calibration_metrics=best,
            candidates=grid, note='Frozen research candidate, not deployed. Evaluate once on disjoint held-out speakers.')
    write_json(output, result)
    return result


def serve(workspace, port):
    rows = cases(workspace)
    by_id = {row['recordingId']: row for row in rows}
    asset_dir = workspace / 'assets'
    subprocess.run(['node', str(Path(__file__).with_name('build_speaking_lab.mjs')), str(asset_dir)], check=True)
    lock = threading.Lock()
    origin = f'http://127.0.0.1:{port}'

    class Handler(BaseHTTPRequestHandler):
        def reply(self, body, status=200, content_type='application/json; charset=utf-8'):
            if not isinstance(body, bytes): body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status); self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; worker-src blob:; frame-ancestors 'none'")
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            if self.headers.get('Host') != f'127.0.0.1:{port}': return self.reply({'error': 'Invalid host'}, 403)
            parsed = urlparse(self.path); query = parse_qs(parsed.query)
            if parsed.path == '/api/cases':
                return self.reply([{**{key: row[key] for key in ('recordingId', 'speakerId', 'referenceText', 'collectionText', 'scenario')},
                    'recorded': audio_path(workspace, row['recordingId']).is_file()} for row in rows])
            if parsed.path == '/api/audio':
                rid = query.get('id', [''])[0]
                if rid not in by_id or not audio_path(workspace, rid).is_file(): return self.reply({'error': 'Not found'}, 404)
                return self.reply(audio_path(workspace, rid).read_bytes(), content_type='audio/wav')
            if parsed.path == '/api/review':
                rid, reviewer = query.get('id', [''])[0], query.get('reviewer', [''])[0]
                if rid not in by_id or reviewer not in ('1', '2'): return self.reply({'error': 'Invalid selection'}, 400)
                with lock:
                    words = [row for row in read_csv(workspace / f'words-rater-{reviewer}.csv') if row['recordingId'] == rid]
                    content = next(row for row in read_csv(workspace / f'content-rater-{reviewer}.csv') if row['recordingId'] == rid)
                return self.reply({'words': words, 'content': content})
            files = {'/': (ASSETS / 'index.html', 'text/html; charset=utf-8'),
                '/lab.js': (ASSETS / 'lab.js', 'text/javascript; charset=utf-8'),
                '/assets/pcm-recorder.js': (asset_dir / 'pcm-recorder.js', 'text/javascript; charset=utf-8'),
                '/assets/recording-silence.js': (asset_dir / 'recording-silence.js', 'text/javascript; charset=utf-8')}
            if parsed.path not in files: return self.reply({'error': 'Not found'}, 404)
            file, mime = files[parsed.path]
            return self.reply(file.read_bytes(), content_type=mime)

        def do_POST(self):
            if self.headers.get('Host') != f'127.0.0.1:{port}' or self.headers.get('Origin') != origin:
                return self.reply({'error': 'Local same-origin requests only'}, 403)
            try:
                size = int(self.headers.get('Content-Length', '-1'))
                if not 0 < size <= 2 * 1024 * 1024: raise ValueError('Request size invalid')
                parsed = urlparse(self.path); query = parse_qs(parsed.query)
                if parsed.path == '/api/audio':
                    rid = query.get('id', [''])[0]
                    if rid not in by_id: raise ValueError('Recording not in manifest')
                    data = self.rfile.read(size); validate_wav(data)
                    with lock:
                        with audio_path(workspace, rid).open('xb') as stream: stream.write(data)
                    return self.reply({'saved': rid}, 201)
                if parsed.path != '/api/review': return self.reply({'error': 'Not found'}, 404)
                if self.headers.get_content_type() != 'application/json': raise ValueError('Expected JSON')
                body = json.loads(self.rfile.read(size))
                rid, reviewer = body['recordingId'], body['reviewer']
                if rid not in by_id or reviewer not in ('1', '2'): raise ValueError('Invalid reviewer/recording')
                if body['readMatch'] not in ('yes', 'no', 'uncertain') or body['usableAudio'] not in ('yes', 'no', 'uncertain'):
                    raise ValueError('Choose human judgments')
                digest = sha(audio_path(workspace, rid).read_bytes())
                scores = body['scores']
                if len(scores) != len(WORD.findall(by_id[rid]['referenceText'])) or any(value is not None and
                        (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 2) for value in scores):
                    raise ValueError('Scores must be blank or 0..2')
                with lock:
                    words = read_csv(workspace / f'words-rater-{reviewer}.csv')
                    for row in words:
                        if row['recordingId'] == rid:
                            value = scores[int(row['wordIndex'])]
                            row.update(score='' if value is None else value, audioSha256=digest)
                    contents = read_csv(workspace / f'content-rater-{reviewer}.csv')
                    for row in contents:
                        if row['recordingId'] == rid:
                            row.update(readMatch=body['readMatch'], usableAudio=body['usableAudio'],
                                actualText=str(body.get('actualText', ''))[:1000], audioSha256=digest)
                    write_csv(workspace / f'words-rater-{reviewer}.csv', words, LABEL_FIELDS)
                    write_csv(workspace / f'content-rater-{reviewer}.csv', contents, GATE_FIELDS)
                return self.reply({'saved': rid})
            except FileExistsError:
                self.reply({'error': 'Bản thu đã lưu. Giữ nguyên bản gốc để nhãn không bị lệch.'}, 409)
            except (ValueError, KeyError, OSError, TypeError) as error:
                self.reply({'error': str(error)}, 400)

    print(f'Speaking collection and blind review: {origin}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('prepare', 'serve', 'score', 'evaluate', 'fit-gate'):
        command = sub.add_parser(name); command.add_argument('--workspace', type=Path, required=True)
        if name == 'prepare': command.add_argument('--speakers', type=int, default=20)
        if name == 'serve': command.add_argument('--port', type=int, default=8013)
        if name in ('score', 'evaluate', 'fit-gate'): command.add_argument('--output', type=Path, required=True)
        if name in ('evaluate', 'fit-gate'): command.add_argument('--results', type=Path, required=True)
        if name == 'evaluate': command.add_argument('--gate-candidate', type=Path)
        if name == 'score':
            command.add_argument('--training-root', type=Path)
            command.add_argument('--include-test', action='store_true')
            command.add_argument('--limit', type=int)
    args = parser.parse_args()
    try:
        if args.command == 'score' and args.limit is not None and args.limit < 1:
            raise ValueError('Scoring limit must be positive')
        if hasattr(args, 'output'):
            if args.output.exists(): raise ValueError('Output exists; use a new filename')
            args.output.parent.mkdir(parents=True, exist_ok=True)
        if args.command == 'prepare': result = {'planned_recordings': len(prepare(args.workspace, args.speakers))}
        elif args.command == 'serve': return serve(args.workspace, args.port)
        elif args.command == 'score': result = score(args.workspace, args.output, args.training_root, args.include_test, args.limit)
        elif args.command == 'evaluate': result = evaluate(args.workspace, args.results, args.output, args.gate_candidate)
        else: result = fit_gate(args.workspace, args.results, args.output)
        print(json.dumps({key: result[key] for key in ('status', 'planned_recordings', 'recordings_scored') if key in result}))
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        parser.exit(2, f'Benchmark error: {error}\n')


if __name__ == '__main__':
    main()
