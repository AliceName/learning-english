const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const mod = {exports:{}};
  const filename=path.join(__dirname,'../src/lib',file+'.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:mod,exports:mod.exports,Uint32Array,require:name=>load(name.replace('./',''))},{filename});
  return mod.exports;
}
const {writingEdits,applyWritingEdits,currentEditPosition}=load('writing-revision');
const {writingReviewItems,writingReviewView,restoreWritingReview}=load('writing-review');
const {loadWritingDraft,saveWritingDraft}=load('writing-draft');
test('accepts a verb without accepting the incorrect name capitalization',()=>{
  const r={originalText:'It were Friends.',correctedText:'It was friends.',errors:[{original:'It were Friends.',suggestion:'It was friends.',sourceStart:0,sourceEnd:16}]};
  const {edits,unmapped}=writingEdits(r);
  assert.equal(unmapped,0);assert.equal(edits.length,2);
  const verb=edits.find(e=>e.before==='were');
  assert.equal(applyWritingEdits(r.originalText,edits,[verb.id]),'It was Friends.');
  assert.equal(applyWritingEdits(r.originalText,edits,[]),r.originalText);
});
test('UTF16 offsets select the later repeated sentence after emoji and CRLF',()=>{
  const original='👩‍💻 I work.\r\n\r\nI work.';
  const start=original.lastIndexOf('I work.');
  const r={originalText:original,correctedText:original.slice(0,start)+'I worked.',errors:[{original:'I work.',suggestion:'I worked.',sourceStart:start,sourceEnd:original.length}]};
  const {edits}=writingEdits(r);assert.equal(edits.length,1);
  assert.equal(applyWritingEdits(original,edits,[edits[0].id]),r.correctedText);
  assert.equal(currentEditPosition(edits[0],edits,[]).start,start+2);
});
test('accepting edits in sequence leaves a skipped edit and untouched text intact',()=>{
  const first = 'It were Friends.';
  const second = 'She go home.';
  const originalText = first + '\n\n' + second;
  const result = {
    originalText,
    correctedText: 'It was friends.\n\nShe goes home.',
    errors: [
      { original: first, suggestion: 'It was friends.', sourceStart: 0, sourceEnd: first.length },
      { original: second, suggestion: 'She goes home.', sourceStart: first.length + 2, sourceEnd: originalText.length },
    ],
  };
  const { edits, unmapped } = writingEdits(result);
  assert.equal(unmapped, 0);
  assert.equal(edits.length, 3);
  const accepted = [edits.find(edit => edit.before === 'were').id];
  const draft = applyWritingEdits(originalText, edits, accepted);
  assert.equal(draft, 'It was Friends.\n\nShe go home.');
  const next = edits.find(edit => edit.before === 'go');
  const span = currentEditPosition(next, edits, accepted);
  assert.equal(draft.slice(span.start, span.end), 'go');
  assert.equal(applyWritingEdits(originalText, edits, [...accepted, next.id]), 'It was Friends.\n\nShe goes home.');
});
test('ambiguous legacy repeated source offers no write action',()=>{
  const result=writingEdits({originalText:'I work. I work.',correctedText:'I work. I worked.',errors:[{original:'I work.',suggestion:'I worked.'}]});
  assert.equal(result.edits.length,0);assert.equal(result.unmapped,1);
});
test('unique legacy source preserves whitespace, insertion and deletion',()=>{
  const r={originalText:'Hi,\r\nI like the cats.\r\nBye',correctedText:'Hi,\r\nI really like cats.\r\nBye',errors:[{original:'I like the cats.',suggestion:'I really like cats.'}]};
  const {edits}=writingEdits(r);assert.ok(edits.length);
  assert.equal(applyWritingEdits(r.originalText,edits,edits.map(e=>e.id)),r.correctedText);
});
test('invalid/overlapping spans and inconsistent corrected text cannot write to draft',()=>{
  assert.equal(writingEdits({originalText:'It work.',correctedText:'It works.',errors:[{original:'It work.',suggestion:'It works.',sourceStart:1,sourceEnd:8}]}).edits.length,0);
  assert.equal(writingEdits({originalText:'It work.',correctedText:'Other text.',errors:[{original:'It work.',suggestion:'It works.'}]}).edits.length,0);
  assert.throws(()=>applyWritingEdits('a',[{id:'x',start:0,end:1,before:'b',after:'c'}],['x']));
  assert.throws(()=>applyWritingEdits('a',[],['unknown']));
  assert.throws(()=>applyWritingEdits('😀.',[{id:'split',start:1,end:2,before:'😀'.slice(1),after:'x'}],['split']));
});

test('review types require exact, versioned evidence for the individual change', () => {
  const result = {
    originalText: 'She go becuase I asked. I work. I work.',
    correctedText: null,
    errors: [
      { original: 'She go becuase I asked.', suggestion: 'She goes because I asked.', explanations: [
        { original: 'go', suggestion: 'goes', category: 'VERB:SVA', templateVersion: 'vi-edit-templates-v1' },
        { original: 'becuase', suggestion: 'because', category: 'SPELL', templateVersion: 'vi-edit-templates-v1' },
      ] },
      { original: 'I work.', suggestion: 'I worked.' },
    ],
  };
  const { edits } = writingEdits(result);
  const items = writingReviewItems(result.errors, edits);
  assert.deepEqual(Array.from(items, item => item.type), ['grammar', 'unclassified', 'unclassified']);
  assert.equal(items[2].edit, null);
  assert.equal(writingReviewView(items, [], 'vocabulary', 'all').visible.length, 0);
  assert.equal(writingReviewView(items, [], 'expression', 'all').visible.length, 0);
  result.errors[0].explanations[0].templateVersion = 'unknown';
  assert.equal(writingReviewItems(result.errors, edits)[0].type, 'unclassified');
});

test('combined filters select the same stable IDs and leave progress and draft decisions intact', () => {
  const items = [
    { id: '0:1', type: 'grammar' }, { id: '0:3', type: 'grammar' }, { id: '1:unmapped', type: 'unclassified' },
    { id: '2:1', type: 'vocabulary' }, { id: '3:1', type: 'expression' },
  ];
  const decisions = [{ id: '0:1', status: 'accepted' }, { id: '1:unmapped', status: 'skipped' }];
  const grammarPending = writingReviewView(items, decisions, 'grammar', 'pending');
  assert.deepEqual(Array.from(grammarPending.visibleIds), ['0:3']);
  assert.deepEqual(Array.from(writingReviewView(items, decisions, 'grammar', 'accepted').visibleIds), ['0:1']);
  assert.deepEqual(Array.from(writingReviewView(items, decisions, 'all', 'skipped').visibleIds), ['1:unmapped']);
  assert.deepEqual(Array.from(writingReviewView(items, decisions, 'vocabulary', 'pending').visibleIds), ['2:1']);
  assert.deepEqual(Array.from(writingReviewView(items, decisions, 'expression', 'pending').visibleIds), ['3:1']);
  assert.deepEqual([grammarPending.total, grammarPending.accepted, grammarPending.skipped, grammarPending.pending, grammarPending.percent], [5, 1, 1, 3, 40]);
  assert.equal(writingReviewView(items, decisions, 'all', 'all').percent, 40);
  assert.equal(writingReviewView(items, decisions.slice(0, -1), 'all', 'all').percent, 20);
  assert.equal(writingReviewView([], [], 'all', 'all').percent, null);
});

test('session draft restores ordered review decisions only for the owner and matching submission', () => {
  const values = new Map();
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const review = [{ id: '0:1', status: 'accepted' }, { id: '1:unmapped', status: 'skipped' }];
  const original = '🙂 Tôi học.\r\nShe go.\r\nShe go.';
  const result = { originalText: original, correctedText: original.replace(/She go\.$/, 'She goes.'),
    errors: [{ original: 'She go.', suggestion: 'She goes.', sourceStart: original.lastIndexOf('She go.'), sourceEnd: original.length },
      { original: 'I write.', suggestion: 'I wrote.' }] };
  const { edits } = writingEdits(result);
  const items = writingReviewItems(result.errors, edits);
  assert.equal(items[0].id, '0:1');
  const input = { topic: '', text: 'My manual edit. ' + result.correctedText, corrections: true, baseSubmissionId: 9, review };
  assert.equal(saveWritingDraft(store, 5, input), true);
  const restored = loadWritingDraft(store, 5, 9);
  assert.equal(restored.text, input.text);
  assert.equal(JSON.stringify(restoreWritingReview(restored, 9, items)), JSON.stringify(review));
  assert.equal(restoreWritingReview(restored, 10, items).length, 0);
  assert.equal(loadWritingDraft(store, 6, 9), null);
  assert.equal(loadWritingDraft(store, 5, 10), null);
  const [key, raw] = [...values.entries()][0];
  values.set(key, JSON.stringify({ ...JSON.parse(raw), review: [{ id: 'invalid', status: 'accepted' }] }));
  const invalid = loadWritingDraft(store, 5, 9);
  assert.equal(invalid.text, input.text);
  assert.equal(invalid.review, undefined);
});
