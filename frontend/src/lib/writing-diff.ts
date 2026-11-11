/** Display-only word/punctuation diff. Never changes saved text or predicts errors. */
export type WritingDiffPart = { kind: "equal"; text: string }
  | { kind: "change"; before: string; after: string };
export type WritingDiff = { parts: WritingDiffPart[]; detailed: boolean };

const MAX_CELLS = 1_000_000;
const tokens = (text: string) => text.match(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|\s+|[^\s]/gu) ?? [];

export function diffWritingText(original: string, suggestion: string): WritingDiff {
  if (original === suggestion) return { parts: original ? [{ kind: "equal", text: original }] : [], detailed: true };
  const source = tokens(original), target = tokens(suggestion);
  let prefix = 0, suffix = 0;
  while (prefix < source.length && prefix < target.length && source[prefix] === target[prefix]) prefix++;
  while (suffix < source.length - prefix && suffix < target.length - prefix
    && source[source.length - suffix - 1] === target[target.length - suffix - 1]) suffix++;
  const a = source.slice(prefix, source.length - suffix), b = target.slice(prefix, target.length - suffix);
  const parts: WritingDiffPart[] = [];
  if (prefix) parts.push({ kind: "equal", text: source.slice(0, prefix).join("") });
  const cells = (a.length + 1) * (b.length + 1);
  if (cells > MAX_CELLS) {
    // Bounded work even for malformed/very large responses. The UI must show
    // plain text and an explicit notice, rather than marking an entire block wrong.
    parts.push({ kind: "change", before: a.join(""), after: b.join("") });
    if (suffix) parts.push({ kind: "equal", text: source.slice(source.length - suffix).join("") });
    return { parts, detailed: false };
  }
  const width = b.length + 1, matrix = new Uint32Array(cells);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      matrix[i * width + j] = a[i] === b[j] ? matrix[(i + 1) * width + j + 1] + 1
        : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
  let i = 0, j = 0;
  function change(before: string, after: string) {
    const last = parts[parts.length - 1];
    if (last?.kind === "change") { last.before += before; last.after += after; }
    else parts.push({ kind: "change", before, after });
  }
  function equal(text: string) {
    const last = parts[parts.length - 1];
    if (last?.kind === "equal") last.text += text;
    else parts.push({ kind: "equal", text });
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { equal(a[i]); i++; j++; }
    else if (i < a.length && (j === b.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) change(a[i++], "");
    else change("", b[j++]);
  }
  if (suffix) equal(source.slice(source.length - suffix).join(""));
  return { parts, detailed: true };
}
