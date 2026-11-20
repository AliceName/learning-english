const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const mod = { exports: {} };
  const filename = path.join(__dirname, '../src/lib', file + '.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: name => load(name.replace('./', '')) }, { filename });
  return mod.exports;
}
const { revealLimit, progressiveReview, reviewExhausted, versionProgress, cefrSeries, revisionChecklist } = load('writing-practice');

const item = (id, status = 'pending') => ({ id, status });

test('beginners see three undecided suggestions at a time, others five', () => {
  assert.equal(revealLimit('Beginner'), 3);
  assert.equal(revealLimit('Intermediate'), 5);
  assert.equal(revealLimit(null), 5);
});

test('progressive review keeps decided items and reveals the next pending one after a decision', () => {
  const entries = [item('a'), item('b'), item('c'), item('d'), item('e')];
  let view = progressiveReview(entries, 2, false);
  assert.deepEqual([...view.shown].map(x => x.id), ['a', 'b']);
  assert.equal(view.hidden, 3);
  view = progressiveReview([item('a', 'accepted'), item('b'), item('c'), item('d'), item('e')], 2, false);
  assert.deepEqual([...view.shown].map(x => x.id), ['a', 'b', 'c']);
  assert.equal(view.hidden, 2);
});

test('show all removes the limit and keeps text order', () => {
  const entries = [item('a'), item('b', 'skipped'), item('c')];
  const view = progressiveReview(entries, 1, true);
  assert.deepEqual([...view.shown].map(x => x.id), ['a', 'b', 'c']);
  assert.equal(view.hidden, 0);
});

test('review is exhausted only for a corrections run with nothing pending', () => {
  assert.equal(reviewExhausted(true, 0), true);
  assert.equal(reviewExhausted(true, 1), false);
  assert.equal(reviewExhausted(false, 0), false);
});

const version = (over) => ({ submissionId: 1, cefrLevel: 'B1', correctedText: 'x', errors: [1, 2, 3], originalText: 'one two three',
  provenance: { cefrRun: 'cefr', gecRun: 'gec' }, ...over });

test('version progress reports fewer suggestions without claiming the essay is better', () => {
  const p = versionProgress(version({}), version({ submissionId: 2, errors: [1] }));
  assert.equal(p.cefr, 'same');
  assert.deepEqual({ ...p.suggestions }, { before: 3, after: 1 });
  assert.match(p.headline, /giảm từ 3 xuống 1/);
  assert.ok(p.caveats.some(c => /bỏ sót/.test(c)));
});

test('version progress does not compare across different models or CEFR-only runs', () => {
  const otherModels = versionProgress(version({}), version({ cefrLevel: 'B2', provenance: { cefrRun: 'new', gecRun: 'other' } }));
  assert.equal(otherModels.cefr, 'unknown');
  assert.equal(otherModels.suggestions, null);
  const cefrOnly = versionProgress(version({ correctedText: null }), version({ cefrLevel: 'B2' }));
  assert.equal(cefrOnly.cefr, 'up');
  assert.equal(cefrOnly.suggestions, null);
  assert.match(cefrOnly.headline, /B1 lên B2/);
});

test('CEFR series is ordered by version and skips missing levels', () => {
  const series = JSON.parse(JSON.stringify(cefrSeries([
    { submissionId: 9, cefrLevel: 'B1', versionNumber: 2 },
    { submissionId: 7, cefrLevel: 'A2', versionNumber: 1 },
    { submissionId: 11, cefrLevel: '', versionNumber: 3 },
  ])));
  assert.deepEqual(series.map(p => [p.label, p.level, p.index]), [['PB 1', 'A2', 1], ['PB 2', 'B1', 2]]);
});

test('revision checklist is Vietnamese guidance that ends with the task requirements', () => {
  assert.ok(revisionChecklist.length >= 6);
  assert.match(revisionChecklist.at(-1), /yêu cầu đề/);
});

const { locateSentence } = load('writing-practice');

test('after the learner edits the draft, the suggestion sentence is found again near its old place', () => {
  const draft = 'I go home. Yesterday I go to school. I go home.';
  const found = locateSentence(draft, 'I go home.', 40);
  assert.deepEqual({ ...found }, { start: 37, end: 47 });
  assert.deepEqual({ ...locateSentence(draft, 'I go home.', 0) }, { start: 0, end: 10 });
});

test('a sentence the learner already rewrote cannot be located', () => {
  assert.equal(locateSentence('Yesterday I went to school.', 'Yesterday I go to school.', 0), null);
  assert.equal(locateSentence('anything', '   ', 0), null);
});

const { practiceOrder, hideAnswerFirst } = load('writing-practice');

test('rule-explained grammar suggestions come first, otherwise text order is kept', () => {
  const entries = [{ id: 'a', type: 'unclassified' }, { id: 'b', type: 'grammar' }, { id: 'c', type: 'unclassified' }, { id: 'd', type: 'grammar' }];
  assert.deepEqual([...practiceOrder(entries)].map(x => x.id), ['b', 'd', 'a', 'c']);
});

test('only rule-explained suggestions hide the answer; uncertain ones show it with a warning', () => {
  assert.equal(hideAnswerFirst('grammar'), true);
  assert.equal(hideAnswerFirst('mechanics'), true);
  assert.equal(hideAnswerFirst('unclassified'), false);
  assert.equal(hideAnswerFirst('vocabulary'), false);
});

test('self-fixed items count as decided in the progressive view', () => {
  const view = progressiveReview([item('a', 'selfFixed'), item('b'), item('c')], 1, false);
  assert.deepEqual([...view.shown].map(x => x.id), ['a', 'b']);
});

const { taskPromptParts } = load('writing-practice');

test('task prompts with inline "*" bullets become intro, list items and a closing instruction', () => {
  const parts = JSON.parse(JSON.stringify(taskPromptParts("Your friend Rie sends you an email:     Hi, Can you come? Rie Write a note to Rie. In your note:     * say you can come to dinner    * say what you like to eat.     Write about 30 words.")));
  assert.deepEqual(parts, { intro: 'Your friend Rie sends you an email: Hi, Can you come? Rie Write a note to Rie. In your note:',
    bullets: ['say you can come to dinner', 'say what you like to eat.'], outro: 'Write about 30 words.' });
});

test('prompts that start with a bullet or have no bullets keep all their text', () => {
  const lead = JSON.parse(JSON.stringify(taskPromptParts('* What do you do? How often? * Tell us about the last time you did this.')));
  assert.deepEqual(lead, { intro: '', bullets: ['What do you do? How often?', 'Tell us about the last time you did this.'], outro: '' });
  const plain = JSON.parse(JSON.stringify(taskPromptParts('Write a report.  You should write about: goals.')));
  assert.deepEqual(plain, { intro: 'Write a report. You should write about: goals.', bullets: [], outro: '' });
});

const { targetAboveTask } = load('writing-practice');

test('a target above what the task level can show is flagged', () => {
  assert.equal(targetAboveTask('Beginner', 'B1'), true);
  assert.equal(targetAboveTask('Beginner', 'A2'), false);
  assert.equal(targetAboveTask('Intermediate', 'C1'), true);
  assert.equal(targetAboveTask('Intermediate', 'B2'), false);
  assert.equal(targetAboveTask('Advanced', 'C2'), false);
  assert.equal(targetAboveTask('Beginner', null), false);
});

test('a closing "Write ..." instruction is split off even after a single space', () => {
  const parts = JSON.parse(JSON.stringify(taskPromptParts('In your email: * apologise to Alex * suggest another day when you could meet. Write your email in about 100 words.')));
  assert.deepEqual(parts.bullets, ['apologise to Alex', 'suggest another day when you could meet.']);
  assert.equal(parts.outro, 'Write your email in about 100 words.');
});

const { sentenceShades } = load('writing-practice');

test('each suggested sentence is shaded: pending while any change in it is undecided, done after', () => {
  const originalText = 'I go home. It is fine. She go to school.';
  const errors = [
    { original: 'I go home.', suggestion: 'I went home.', sourceStart: 0, sourceEnd: 10 },
    { original: 'She go to school.', suggestion: 'She goes to school.', sourceStart: 23, sourceEnd: 40 },
  ];
  const items = [{ id: '0:1', suggestionIndex: 0, status: 'selfFixed' }, { id: '1:1', suggestionIndex: 1, status: 'pending' }];
  const shades = JSON.parse(JSON.stringify(sentenceShades(originalText, errors, items)));
  assert.deepEqual(shades, [
    { start: 0, end: 10, suggestionIndex: 0, state: 'fixed' },
    { start: 23, end: 40, suggestionIndex: 1, state: 'pending' },
  ]);
});

test('sentences without a trustworthy position or overlapping an earlier one are not shaded', () => {
  const originalText = 'Hi. Hi. Bye.';
  const errors = [
    { original: 'Hi.', suggestion: 'Hello.' },
    { original: 'Bye.', suggestion: 'Goodbye.', sourceStart: 8, sourceEnd: 12 },
    { original: 'Bye.', suggestion: 'Bye!', sourceStart: 8, sourceEnd: 12 },
    { original: 'wrong', suggestion: 'x', sourceStart: 0, sourceEnd: 3 },
  ];
  const items = errors.map((_, i) => ({ id: i + ':1', suggestionIndex: i, status: 'pending' }));
  const shades = JSON.parse(JSON.stringify(sentenceShades(originalText, errors, items)));
  assert.deepEqual(shades.map(s => s.suggestionIndex), [1]);
});

const writingLib = load('writing');

test('saved relevance is accepted only when consistent and quoting the essay', () => {
  const base = { submissionId: 5, topic: 'T', originalText: 'Hi Ken. We went to the beach.', cefrLevel: 'A2', correctedText: null,
    errors: [], warnings: [], createdAt: '2026-11-20T10:00:00Z' };
  const relevance = { score: 3, offTopic: false, topicSimilarity: 0.41, pointsCovered: 1, pointsTotal: 2,
    points: [{ point: 'say hello', covered: true, evidence: 'Hi Ken.' }, { point: 'suggest a time', covered: false, evidence: null }],
    keywords: ['ken', 'beach'], thresholdsVersion: 'relevance-minilm-v1', model: 'minilm' };
  assert.equal(writingLib.isWritingResult({ ...base, relevance }), true);
  assert.equal(writingLib.isWritingResult({ ...base, relevance: null }), true);
  assert.equal(writingLib.isWritingResult({ ...base, relevance: { ...relevance, score: 7 } }), false);
  assert.equal(writingLib.isWritingResult({ ...base, relevance: { ...relevance, points: [{ point: 'x', covered: true, evidence: 'Not in essay.' }], pointsTotal: 1 } }), false);
});

test('a sentence whose suggestions were all skipped is not shown as fixed', () => {
  const text = 'I go home. She go out.';
  const errors = [{ original: 'I go home.', suggestion: 'I went home.', sourceStart: 0, sourceEnd: 10 },
    { original: 'She go out.', suggestion: 'She goes out.', sourceStart: 11, sourceEnd: 22 }];
  const items = [{ suggestionIndex: 0, status: 'skipped' }, { suggestionIndex: 1, status: 'skipped' }, { suggestionIndex: 1, status: 'accepted' }];
  const shades = JSON.parse(JSON.stringify(sentenceShades(text, errors, items)));
  assert.deepEqual(shades.map(s => s.state), ['skipped', 'fixed']);
});

const { improvedSentences } = load('writing-practice');

test('sentences rewritten since the previous version that now have no suggestion count as improved', () => {
  const previous = 'I go home. She go out. It rains.';
  const current = 'I went home. She go out. It rains. We play.';
  const shades = [{ start: 13, end: 24, suggestionIndex: 0, state: 'pending' }];
  const improved = JSON.parse(JSON.stringify(improvedSentences(current, previous, shades)));
  assert.deepEqual(improved.map(s => current.slice(s.start, s.end)), ['I went home.', 'We play.']);
});

const { dictionaryGloss, dictionaryLookupWord } = load('writing-practice');

test('card meanings are prefilled from the first Vietnamese definitions, with the preposition noted for phrases', () => {
  const response = { entries: [{ meanings: [{ partOfSpeech: 'Tính từ', definitions: [{ definition: 'Đẹp; hay.' }, { definition: 'Tốt, tốt đẹp.' }, { definition: 'Thứ ba.' }] }] }] };
  assert.equal(dictionaryGloss(response, 'beautiful'), '(Tính từ) Đẹp; hay. / Tốt, tốt đẹp.');
  const listen = { entries: [{ meanings: [{ partOfSpeech: 'Động từ', definitions: [{ definition: 'Nghe, lắng nghe.' }] }] }] };
  assert.equal(dictionaryGloss(listen, 'listen to'), '(Động từ) Nghe, lắng nghe. — đi với “to”');
  assert.equal(dictionaryGloss({ entries: [] }, 'x'), '');
  assert.equal(dictionaryLookupWord('listen to'), 'listen');
  assert.equal(dictionaryLookupWord('beautiful'), 'beautiful');
});
