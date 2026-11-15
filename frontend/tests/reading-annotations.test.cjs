const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/reading-annotations.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, encodeURIComponent });
const api = moduleUnderTest.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const sample = { id: "test-id", region: "passage", start: 4, end: 12, quote: "journeys", kind: "highlight", color: "yellow", note: "Đoạn nêu ý chính." };
const payload = marks => JSON.stringify({ version: 1, marks });

test("notes are scoped to account, course, lesson and content revision", () => {
  const key = api.readingAnnotationKey(42, 1, 7, "revision:a");
  for (const input of [[43, 1, 7, "revision:a"], [42, 2, 7, "revision:a"], [42, 1, 8, "revision:a"], [42, 1, 7, "revision:b"]]) assert.notEqual(key, api.readingAnnotationKey(...input));
  assert.ok(key.includes("revision%3Aa"));
});
test("storage validates every mark and treats note text as literal data", () => {
  assert.deepEqual(plain(api.parseReadingMarks(payload([sample]))), [sample]);
  for (const input of [null, "{", "[]", '{"version":2,"marks":[]}', payload([null, {}])]) assert.deepEqual(plain(api.parseReadingMarks(input)), []);
  const invalid = [{ start: -1 }, { end: 3 }, { start: 4.5 }, { end: 500001 }, { quote: "wrong length" }, { region: "__proto__" }, { color: "red" }, { kind: "html" }, { note: "x".repeat(2001) }, { note: null }];
  for (const change of invalid) assert.equal(api.parseReadingMarks(payload([{ ...sample, ...change }])).length, 0);
  const literal = { ...sample, note: '<script>alert("test")</script>' };
  assert.equal(api.parseReadingMarks(payload([literal]))[0].note, literal.note);
  assert.equal(api.parseReadingMarks(payload([sample, sample])).length, 1);
  assert.equal(api.parseReadingMarks(payload(Array.from({ length: 250 }, (_, index) => ({ ...sample, id: String(index) })))).length, 200);
});
test("anchors check the exact occurrence and reject changed text", () => {
  assert.equal(api.matchingReadingMark(sample, "passage", "Our journeys start today."), true);
  assert.equal(api.matchingReadingMark(sample, "question-0", "Our journeys start today."), false);
  assert.equal(api.matchingReadingMark(sample, "passage", "The journeys have changed."), true);
  assert.equal(api.matchingReadingMark(sample, "passage", "Our journey starts today."), false);
  assert.equal(api.matchingReadingMark(sample, "passage", "journeys"), false);
});
test("geometry merges adjacent inline fragments without bridging separate lines", () => {
  const rects = [{ left: 40, top: 2, width: 20, height: 18 }, { left: 10, top: 2, width: 30, height: 18 }, { left: 10, top: 32, width: 45, height: 18 }, { left: 60, top: 32, width: 20, height: 18 }, { left: 0, top: 0, width: 0, height: 18 }];
  assert.deepEqual(plain(api.mergeReadingRects(rects)), [{ left: 10, top: 2, width: 50, height: 18 }, { left: 10, top: 32, width: 45, height: 18 }, { left: 60, top: 32, width: 20, height: 18 }]);
  assert.equal(rects[0].width, 20);
});

// Exercise the real component's event handlers without adding a DOM dependency.
// Native label-to-radio activation is also checked in the browser preview.
function answerCard(tool, activate) {
  const component = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const react = {
    createContext: () => ({}), useContext: () => ({ tool, beginSelection() {}, capture() {} }),
    useRef: current => ({ current }), useState: () => [[], () => {}], useEffect() {},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/course-text/reading-annotations.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: component, exports: component.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/lib/reading-annotations") return api;
      if (name.endsWith(".css")) return { default: {} };
      if (name === "@/components/site-icon") return () => null;
      throw new Error(name);
    },
    window: { getSelection: () => ({ isCollapsed: false, rangeCount: 1 }) },
  });
  return component.exports.AnnotatedReadingText({ region: "option-0-0", children: "Answer", onActivate: activate }).props;
}
function clickEvent(kind = "padding") {
  return {
    prevented: false, stopped: false,
    target: { closest(selector) { return selector === "[data-annotation-ignore]" ? kind === "letter" ? {} : null : kind === "radio" ? {} : null; } },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
  };
}
test("answer cards accept taps on padding, text and native radio in every annotation mode", () => {
  for (const tool of ["read", "highlight", "underline", "note"]) {
    let selected = 0;
    const card = answerCard(tool, () => selected++);
    for (const kind of ["padding", "text"]) {
      card.onPointerDown({ clientX: 10, clientY: 20 });
      card.onClickCapture(clickEvent(kind));
    }
    assert.equal(selected, 2, `whole-card activation in ${tool}`);
    for (const kind of ["letter", "radio"]) {
      const event = clickEvent(kind);
      card.onClickCapture(event);
      assert.equal(event.prevented, false, `${kind} must keep native label/radio behavior in ${tool}`);
    }
  }
});
test("a drag cannot select an answer; the next tap and keyboard input still work", () => {
  for (const tool of ["read", "highlight", "underline", "note"]) {
    let selected = 0;
    const card = answerCard(tool, () => selected++);
    card.onPointerDown({ clientX: 10, clientY: 20 });
    card.onPointerMove({ clientX: 100, clientY: 20, buttons: 1 });
    const dragClick = clickEvent("text");
    card.onClickCapture(dragClick);
    assert.equal(dragClick.prevented, true);
    assert.equal(selected, 0);
    card.onKeyDown();
    const keyboard = clickEvent("radio");
    card.onClickCapture(keyboard);
    assert.equal(keyboard.prevented, false);
    card.onPointerDown({ clientX: 10, clientY: 20 });
    card.onClickCapture(clickEvent());
    assert.equal(selected, 1);
    card.onPointerCancel();
    card.onClickCapture(clickEvent());
    assert.equal(selected, 1, "cancelled touch/pen gesture must not choose an answer");
  }
});
