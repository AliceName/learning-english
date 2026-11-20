export const annotationColors = ["yellow", "green", "blue", "pink"] as const;
export type AnnotationColor = typeof annotationColors[number];
export type ReadingMark = { id: string; region: string; start: number; end: number; quote: string; kind: "highlight" | "underline" | "note"; color: AnnotationColor; note: string };
export type ReadingSelection = Pick<ReadingMark, "region" | "start" | "end" | "quote">;
export const maxReadingMarks = 200;
export const maxReadingNote = 2000;

export function readingAnnotationKey(userId: number, courseId: number, lessonId: number, contentVersion: string) {
  return `lewa:reading-notes:v1:${userId}:${courseId}:${lessonId}:${encodeURIComponent(contentVersion)}`;
}

// Treat browser storage as untrusted input. Never render notes or quotes as HTML.
export function parseReadingMarks(value: string | null): ReadingMark[] {
  if (!value || value.length > 3_000_000) return [];
  try {
    const data = JSON.parse(value);
    if (data?.version !== 1 || !Array.isArray(data.marks)) return [];
    const ids = new Set<string>();
    return data.marks.slice(0, maxReadingMarks).filter((mark: ReadingMark) => {
      const valid = mark && typeof mark.id === "string" && mark.id.length <= 80 && !ids.has(mark.id)
        && typeof mark.region === "string" && /^(passage|title|instructions|question-\d+|option-\d+-\d+)$/.test(mark.region)
        && Number.isSafeInteger(mark.start) && Number.isSafeInteger(mark.end) && mark.start >= 0 && mark.end > mark.start && mark.end <= 500_000
        && typeof mark.quote === "string" && mark.quote.length === mark.end - mark.start && mark.quote.length <= 8000
        && ["highlight", "underline", "note"].includes(mark.kind) && annotationColors.includes(mark.color)
        && typeof mark.note === "string" && mark.note.length <= maxReadingNote;
      if (valid) ids.add(mark.id);
      return valid;
    }).map(({ id, region, start, end, quote, kind, color, note }: ReadingMark) => ({ id, region, start, end, quote, kind, color, note }));
  } catch { return []; }
}

export function matchingReadingMark(mark: ReadingSelection, region: string, text: string) {
  return mark.region === region && mark.start >= 0 && mark.end <= text.length && text.slice(mark.start, mark.end) === mark.quote;
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest("[data-annotation-ignore]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}
export function readingRegionText(root: Node) { return textNodes(root).map(node => node.data).join(""); }

export function selectedReadingText(root: HTMLElement, region: string, selection: Selection | null): ReadingSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
  const start = readingRegionText(prefix.cloneContents());
  prefix.setEnd(range.endContainer, range.endOffset);
  const end = readingRegionText(prefix.cloneContents()).length;
  const text = readingRegionText(root), quote = text.slice(start.length, end);
  return quote.trim() && quote.length <= 8000 ? { region, start: start.length, end, quote } : null;
}

export function readingMarkRange(root: HTMLElement, mark: ReadingSelection): Range | null {
  if (!matchingReadingMark(mark, mark.region, readingRegionText(root))) return null;
  let offset = 0, start: Text | undefined, end: Text | undefined, from = 0, to = 0;
  for (const node of textNodes(root)) {
    const next = offset + node.length;
    if (!start && mark.start < next) { start = node; from = mark.start - offset; }
    if (mark.end <= next) { end = node; to = mark.end - offset; break; }
    offset = next;
  }
  if (!start || !end) return null;
  const range = document.createRange(); range.setStart(start, from); range.setEnd(end, to);
  return range;
}

export type MarkRect = { left: number; top: number; width: number; height: number };
export function readingMarkRects(root: HTMLElement, mark: ReadingSelection): MarkRect[] {
  if (!matchingReadingMark(mark, mark.region, readingRegionText(root))) return [];
  const bounds = root.getBoundingClientRect(), rects: MarkRect[] = [];
  let offset = 0;
  for (const node of textNodes(root)) {
    const next = offset + node.length;
    if (next > mark.start && offset < mark.end) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, mark.start - offset)); range.setEnd(node, Math.min(node.length, mark.end - offset));
      rects.push(...Array.from(range.getClientRects()).map(rect => ({ left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height })));
    }
    offset = next;
    if (offset >= mark.end) break;
  }
  return mergeReadingRects(rects);
}
// Formatting and glossary buttons can produce duplicate rectangles on a line.
export function mergeReadingRects(rects: MarkRect[]): MarkRect[] {
  const result: MarkRect[] = [];
  for (const rect of rects.filter(rect => rect.width > 0 && rect.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)) {
    const previous = result.at(-1);
    if (previous && Math.abs(previous.top - rect.top) < 2 && Math.abs(previous.height - rect.height) < 3 && rect.left <= previous.left + previous.width + 1) {
      previous.width = Math.max(previous.left + previous.width, rect.left + rect.width) - previous.left;
    } else result.push({ ...rect });
  }
  return result;
}
