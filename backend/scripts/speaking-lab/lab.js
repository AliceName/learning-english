import { PcmRecorder } from '/assets/pcm-recorder.js';

const $ = id => document.getElementById(id);
const entries = await fetch('/api/cases').then(response => response.json());
let current, active, startup, blob, objectUrl, listened = false, loading = false, generation = 0;
function message(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
function busy(value) {
  loading = value;
  for (const id of ['mode', 'speaker', 'reviewer', 'case', 'upload', 'record', 'save-audio', 'save-review']) $(id).disabled = value;
  if (!value) { $('record').disabled = !!current?.recorded; $('upload').disabled = !!current?.recorded; $('save-audio').disabled = !blob || !!current?.recorded; }
}
function cleanupAudio() {
  $('audio').pause(); $('audio').removeAttribute('src'); $('audio').hidden = true;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined; blob = undefined; listened = false;
}
function preview(value) {
  cleanupAudio(); blob = value; objectUrl = URL.createObjectURL(value);
  $('audio').src = objectUrl; $('audio').hidden = false; $('save-audio').disabled = false;
}
for (const speaker of new Set(entries.map(row => row.speakerId))) $('speaker').add(new Option(speaker, speaker));
function list() {
  const review = $('mode').value === 'review';
  $('reviewer-label').hidden = !review; $('speaker-label').hidden = review;
  const choices = entries.filter(row => review ? row.recorded : row.speakerId === $('speaker').value);
  $('case').replaceChildren(...choices.map(row => new Option(`${row.recordingId}${row.recorded ? ' · Đã thu' : ''}`, row.recordingId)));
  $('progress').textContent = `${entries.filter(row => row.recorded).length}/${entries.length} bản thu đã lưu`;
  void select();
}
async function select() {
  const version = ++generation;
  cleanupAudio(); message(''); $('timer').textContent = '';
  current = entries.find(row => row.recordingId === $('case').value);
  const review = $('mode').value === 'review';
  $('collect').hidden = review || !current; $('review').hidden = !review || !current;
  $('sentence').textContent = current?.referenceText ?? 'Chưa có bản ghi để đánh giá.';
  $('instruction').textContent = '';
  if (!current) return;
  if (!review) {
    const instruction = current.scenario === 'omit_word' || current.scenario === 'different_sentence'
      ? `Lượt kiểm tra nội dung: hãy đọc “${current.collectionText}”.`
      : current.scenario === 'background_noise' ? 'Lượt kiểm tra môi trường: đọc câu trên trong điều kiện có tiếng nền thông thường.' : 'Hãy đọc câu tham chiếu ở trên.';
    $('instruction').textContent = instruction;
  }
  if (current.recorded) { $('audio').src = '/api/audio?id=' + encodeURIComponent(current.recordingId); $('audio').hidden = false; }
  $('record').disabled = current.recorded; $('save-audio').disabled = true; $('upload').disabled = current.recorded;
  if (!review) return;
  busy(true);
  try {
    const response = await fetch(`/api/review?id=${encodeURIComponent(current.recordingId)}&reviewer=${$('reviewer').value}`);
    if (!response.ok) throw new Error('Chưa tải được phiếu chấm.');
    const data = await response.json();
    if (version !== generation) return;
    $('read-match').value = data.content.readMatch; $('quality').value = data.content.usableAudio;
    $('actual-text').value = data.content.actualText;
    $('words').replaceChildren(...data.words.map(word => {
      const label = document.createElement('label');
      const text = document.createElement('span'); text.lang = 'en'; text.textContent = word.word;
      const score = document.createElement('select'); score.dataset.wordIndex = word.wordIndex;
      score.add(new Option('Chưa chấm', ''));
      for (const value of [0, .5, 1, 1.5, 2]) score.add(new Option(String(value), String(value)));
      score.value = word.score; label.append(text, score); return label;
    }));
  } catch (error) { message(error.message, true); }
  finally { if (version === generation) busy(false); }
}
async function stop() {
  const recorder = active; if (!recorder) return;
  active = undefined; $('stop').disabled = true;
  try { preview(await recorder.finish()); message('Nghe lại bản ghi rồi bấm Lưu bản thu.'); }
  catch (error) { message(error.message, true); }
  finally { busy(false); }
}
$('record').onclick = async () => {
  if (loading || active) return;
  busy(true); message('Đang mở microphone…'); $('audio').pause(); startup = new AbortController();
  try {
    active = await PcmRecorder.start(12, seconds => { $('timer').textContent = `${seconds.toFixed(1)} / 12 giây`; }, () => void stop(), { signal: startup.signal });
    $('stop').disabled = false; message('Đang ghi âm. Bấm Dừng khi đọc xong.');
  } catch (error) { message(error.message, true); busy(false); }
  finally { startup = undefined; }
};
$('stop').onclick = () => void stop();
$('upload').onchange = event => { if (event.target.files[0]) preview(event.target.files[0]); event.target.value = ''; };
$('audio').onplay = () => { listened = true; };
$('save-audio').onclick = async () => {
  if (!blob || loading) return;
  busy(true);
  try {
    const response = await fetch('/api/audio?id=' + encodeURIComponent(current.recordingId), { method: 'POST', body: blob });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    current.recorded = true; list(); message('Đã lưu bản thu. Bạn có thể chọn câu tiếp theo.');
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
};
$('review').onsubmit = async event => {
  event.preventDefault(); if (loading) return;
  if (!listened) return message('Hãy nghe bản ghi trước khi lưu đánh giá.', true);
  busy(true);
  try {
    const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      recordingId: current.recordingId, reviewer: $('reviewer').value, readMatch: $('read-match').value,
      usableAudio: $('quality').value, actualText: $('actual-text').value,
      scores: [...$('words').querySelectorAll('select')].map(select => select.value === '' ? null : Number(select.value)),
    }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    message('Đã lưu đánh giá. Không có điểm AI hiển thị trong phiếu này.');
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
};
for (const id of ['mode', 'speaker']) $(id).onchange = list;
$('case').onchange = () => void select(); $('reviewer').onchange = () => void select();
window.addEventListener('pagehide', () => { startup?.abort(); active?.dispose(); cleanupAudio(); });
list();
