"""Import a reviewed course manifest through the local admin API; never publishes.

Uses Python's standard library. Run without --apply first to validate the package.
Credentials are read from the API project's existing local .NET User Secrets.
"""
import argparse
import hashlib
import json
import mimetypes
import os
import sys
import uuid
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def request_hash(data):
    return digest(json.dumps(data, ensure_ascii=False, sort_keys=True).encode('utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=REPO / 'backend/course-data/tkkh.json')
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--base-url', default='http://localhost:5000')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--defer-audio', action='store_true',
                        help='Save listening lessons inactive without uploading audio; rerun without this flag to attach it later.')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    url = urllib.parse.urlsplit(base)
    if url.hostname not in ('localhost', '127.0.0.1', '::1') or url.scheme not in ('http', 'https') or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError('This importer only sends saved credentials to a local API origin.')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    if manifest['schemaVersion'] != 1:
        raise ValueError('Unsupported package version.')
    source = args.source_root.resolve(strict=True)
    files = {}
    for relative, expected in manifest['audioFiles'].items():
        path = (source / relative).resolve(strict=True)
        if not path.is_relative_to(source):
            raise ValueError('Audio paths must stay within --source-root.')
        data = path.read_bytes()
        if len(data) != expected['bytes'] or digest(data) != expected['sha256']:
            raise ValueError(f'Audio differs from the reviewed package: {relative}')
        files[relative] = path
    courses = manifest['courses']
    if len({course['key'] for course in courses}) != len(courses) or len({course['course']['title'] for course in courses}) != len(courses):
        raise ValueError('Course keys and titles must be unique.')
    for course in courses:
        lessons = course['lessons']
        if not lessons or len({item['key'] for item in lessons}) != len(lessons):
            raise ValueError('Each course needs lessons with unique keys.')
        for item in lessons:
            req = item['request']
            if req['skillType'] not in ('speaking', 'listening', 'grammar', 'reading', 'writing') or req['difficultyLevel'] != course['level']:
                raise ValueError('Invalid skill or level.')
            if item.get('audioFile') and item['audioFile'] not in files:
                raise ValueError('Audio is missing from the package inventory.')
        print(f"Validated {course['course']['title']}: {len(lessons)} lessons")
    print(f'Validated {len(files)} audio files. Courses will remain drafts.')
    if not args.apply:
        return

    project = ET.parse(REPO / 'backend/EnglishLearning.Api/EnglishLearning.Api.csproj')
    secrets_id = project.findtext('.//UserSecretsId')
    if not secrets_id:
        raise ValueError('The API project has no UserSecretsId.')
    secrets = json.loads((Path(os.environ['APPDATA']) / 'Microsoft/UserSecrets' / secrets_id / 'secrets.json').read_text(encoding='utf-8-sig'))
    def secret(name):
        return secrets.get('BootstrapAdmin:' + name) or secrets.get('BootstrapAdmin', {}).get(name)
    if not secret('Email') or not secret('Password'):
        raise ValueError('Initialize the local admin before importing.')

    # Do not follow redirects with either the password or bearer credentials.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect())
    token = None
    def api(method, route, body=None, content_type='application/json'):
        headers = {'Accept': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = content_type
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(base + '/api/v1/' + route, body, headers, method=method)
        try:
            with opener.open(req, timeout=100) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'{method} {route}: HTTP {error.code}: {detail}') from None
    token = api('POST', 'auth/login', dict(email=secret('Email'), password=secret('Password')))['accessToken']
    manifest_hash = digest(args.manifest.read_bytes())
    state_path = REPO / 'reports/course-import' / (manifest['packageId'] + '-' + digest(base.encode())[:12] + '.json')
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding='utf-8'))
        if state['manifestSha256'] != manifest_hash or state['baseUrl'] != base:
            raise ValueError('The package changed since this import. Review the saved state before continuing.')
    else:
        state = dict(packageId=manifest['packageId'], manifestSha256=manifest_hash, baseUrl=base, media={}, courses={})
    def save():
        state_path.parent.mkdir(parents=True, exist_ok=True)
        temp = state_path.with_suffix('.tmp')
        temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temp.replace(state_path)

    # Detect all title conflicts before uploading media or creating a course.
    for course in courses:
        result = api('GET', 'admin/courses?' + urllib.parse.urlencode(dict(search=course['course']['title'], pageSize=24)))
        matches = [item for item in result['items'] if item['title'] == course['course']['title']]
        previous = state['courses'].get(course['key'])
        if matches and (not previous or any(item['courseId'] != previous['courseId'] for item in matches)):
            raise ValueError('An existing course has the same title; refusing to overwrite: ' + course['course']['title'])
        if previous:
            current = api('GET', f"admin/courses/{previous['courseId']}")
            if current['isPublished'] or current['title'] != course['course']['title']:
                raise ValueError('Previously imported course changed or was published; refusing to overwrite.')

    for relative, path in ([] if args.defer_audio else files.items()):
        fingerprint = manifest['audioFiles'][relative]['sha256']
        if fingerprint in state['media']:
            continue
        boundary = 'course-import-' + uuid.uuid4().hex
        filename = 'audio' + path.suffix.lower()
        mime = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\naudio\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f'Content-Type: {mime}\r\n\r\n').encode() + path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
        uploaded = api('POST', 'admin/uploads', body, 'multipart/form-data; boundary=' + boundary)
        state['media'][fingerprint] = uploaded['url']
        save()
        print('Uploaded audio: ' + relative, flush=True)

    for course in courses:
        key = course['key']
        if key not in state['courses']:
            first = course['lessons'][0]['request']
            created = api('POST', 'admin/courses', dict(**course['course'], difficultyLevel=course['level'],
                estimatedMinutes=first['estimatedMinutes'], skills=[first['skillType']]))
            state['courses'][key] = dict(courseId=created['courseId'], placeholderId=created['lessons'][0]['lessonId'], lessons={})
            save()
        progress = state['courses'][key]
        course_id = progress['courseId']
        current = api('GET', f'admin/courses/{course_id}')
        for index, item in enumerate(course['lessons']):
            req = dict(item['request'])
            deferred = False
            if relative := item.get('audioFile'):
                media_url = state['media'].get(manifest['audioFiles'][relative]['sha256'])
                if media_url:
                    req['audioUrl'] = media_url
                else:
                    req['audioUrl'] = None
                    req['isActive'] = False
                    deferred = True
            fingerprint = request_hash(req)
            existing_id = None
            if existing := progress['lessons'].get(item['key']):
                remote = [value for value in current['lessons'] if value['lessonId'] == existing['lessonId']]
                if len(remote) != 1 or request_hash(remote[0]) != existing['responseSha256']:
                    raise ValueError('An imported lesson was edited; refusing to overwrite it.')
                if existing['requestSha256'] == fingerprint:
                    continue
                if not existing.get('deferredAudio') or deferred:
                    raise ValueError('An imported lesson changed in the package; refusing to overwrite.')
                existing_id = existing['lessonId']
            # Recover a POST that reached the server before its checkpoint was saved.
            matches = [value for value in current['lessons'] if value['title'] == req['title']]
            if len(matches) > 1:
                raise ValueError('Duplicate lesson title in an imported course.')
            target_id = existing_id or (progress['placeholderId'] if index == 0 else matches[0]['lessonId'] if matches else None)
            if target_id:
                current = api('PUT', f'admin/courses/{course_id}/lessons/{target_id}', req)
            else:
                current = api('POST', f'admin/courses/{course_id}/lessons', req)
            saved = [value for value in current['lessons'] if value['title'] == req['title']]
            if len(saved) != 1:
                raise ValueError('Could not identify the saved lesson.')
            progress['lessons'][item['key']] = dict(lessonId=saved[0]['lessonId'], requestSha256=fingerprint,
                responseSha256=request_hash(saved[0]), deferredAudio=deferred)
            save()
        verified = api('GET', f'admin/courses/{course_id}')
        if verified['isPublished'] or len(verified['lessons']) != len(course['lessons']):
            raise ValueError('Imported course status or lesson count differs from the package.')
        ids = {item['lessonId'] for item in verified['lessons']}
        if any(item['lessonId'] not in ids for item in progress['lessons'].values()):
            raise ValueError('An imported lesson is missing from the API response.')
        print(f"Imported draft {course_id}: {verified['title']} ({len(verified['lessons'])} lessons)", flush=True)
    deferred_count = sum(value.get('deferredAudio', False) for course in state['courses'].values() for value in course['lessons'].values())
    if deferred_count:
        print(f'Audio pending for {deferred_count} inactive listening lessons. Configure Cloudinary and rerun without --defer-audio.')
    print('Checkpoint: ' + str(state_path))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
