import { diffWritingText, type WritingDiff } from "./writing-diff";
import { writingBoundary, type WritingResult } from "./writing";

export type WritingEdit = {
  id: string;
  suggestionIndex: number;
  start: number;
  end: number;
  before: string;
  after: string;
};

/** Character offsets are UTF-16, exactly like textarea.selectionStart. Never guess repeated matches. */
export function writingEdits(result: Pick<WritingResult, "originalText" | "correctedText" | "errors">) {
  const edits: WritingEdit[] = [];
  let unmapped = 0;
  for (const [suggestionIndex, suggestion] of result.errors.entries()) {
    let start = suggestion.sourceStart;
    if (start == null) {
      const first = result.originalText.indexOf(suggestion.original);
      // Legacy records lack positions: use only a unique exact occurrence.
      if (!suggestion.original || first < 0 || result.originalText.indexOf(suggestion.original, first + 1) >= 0) {
        unmapped++; continue;
      }
      start = first;
    }
    const end = suggestion.sourceEnd ?? start + suggestion.original.length;
    if (!writingBoundary(result.originalText, start) || !writingBoundary(result.originalText, end)
      || result.originalText.slice(start, end) !== suggestion.original) { unmapped++; continue; }
    const diff = diffWritingText(suggestion.original, suggestion.suggestion);
    if (!diff.detailed) { unmapped++; continue; }
    let cursor = start;
    for (const [partIndex, part] of diff.parts.entries()) {
      if (part.kind === "equal") cursor += part.text.length;
      else {
        edits.push({ id: `${suggestionIndex}:${partIndex}`, suggestionIndex, start: cursor,
          end: cursor + part.before.length, before: part.before, after: part.after });
        cursor += part.before.length;
      }
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  if (edits.some((edit, index) => index > 0 && (edit.start < edits[index - 1].end
    || edit.start === edits[index - 1].start))) return { edits: [], unmapped: result.errors.length };
  // All accepted edits must reproduce the server proposal exactly. A malformed
  // record must not offer write actions against the learner's draft.
  if (!unmapped && result.correctedText != null
    && applyWritingEdits(result.originalText, edits, edits.map(e => e.id)) !== result.correctedText)
    return { edits: [], unmapped: result.errors.length };
  return { edits, unmapped };
}

export function applyWritingEdits(original: string, edits: WritingEdit[], accepted: readonly string[]): string {
  const ids = new Set(accepted);
  if (ids.size !== accepted.length || accepted.some(id => !edits.some(e => e.id === id)))
    throw new Error("Unknown or duplicate writing edit");
  const selected = edits.filter(e => ids.has(e.id)).sort((a, b) => a.start - b.start || a.end - b.end);
  if (selected.some((e, index) => !writingBoundary(original, e.start) || !writingBoundary(original, e.end) || e.end < e.start
    || original.slice(e.start, e.end) !== e.before
    || (index > 0 && e.start <= selected[index - 1].start)
    || (index > 0 && e.start < selected[index - 1].end))) throw new Error("Invalid writing edit span");
  return [...selected].reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.after + text.slice(edit.end), original);
}

/**
 * Maps a span of the managed text (original + accepted edits) into the learner's hand-edited draft, using the
 * word diff between the two. Returns null when the learner changed that spot or the texts are too different to align.
 */
export function draftSpan(managed: string, draft: string, start: number, end: number,
  diff: WritingDiff = diffWritingText(managed, draft)): { start: number; end: number } | null {
  if (managed === draft) return { start, end };
  if (!diff.detailed) return null;
  let from = 0, to = 0;
  for (const part of diff.parts) {
    if (part.kind === "equal") {
      if (start >= from && end <= from + part.text.length) return { start: to + start - from, end: to + end - from };
      from += part.text.length; to += part.text.length;
    } else { from += part.before.length; to += part.after.length; }
  }
  return null;
}

/** Where a suggestion's edit sits in the current draft (before it is accepted, or after when it already was). */
/** Pass `diff` (managed → draft) when checking many edits against the same draft, so it is computed once. */
export function editInDraft(original: string, draft: string, edit: WritingEdit, edits: WritingEdit[], accepted: readonly string[],
  diff?: WritingDiff) {
  const managed = applyWritingEdits(original, edits, accepted);
  const at = currentEditPosition(edit, edits, accepted);
  const span = managed === draft ? at : draftSpan(managed, draft, at.start, at.end, diff ?? diffWritingText(managed, draft));
  const expected = accepted.includes(edit.id) ? edit.after : edit.before;
  return span && draft.slice(span.start, span.end) === expected ? span : null;
}

export function currentEditPosition(edit: WritingEdit, edits: WritingEdit[], accepted: readonly string[]) {
  const shift = edits.filter(e => accepted.includes(e.id) && e.start < edit.start)
    .reduce((sum, e) => sum + e.after.length - e.before.length, 0);
  return { start: edit.start + shift, end: edit.start + shift + (accepted.includes(edit.id) ? edit.after.length : edit.before.length) };
}
