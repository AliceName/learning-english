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
