"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import Icon from "@/components/site-icon";
import { annotationColors, matchingReadingMark, maxReadingMarks, maxReadingNote, parseReadingMarks, readingMarkRange, readingMarkRects, readingRegionText, selectedReadingText, type AnnotationColor, type MarkRect, type ReadingMark, type ReadingSelection } from "@/lib/reading-annotations";
import styles from "./reading-annotations.module.css";

type Tool = "read" | ReadingMark["kind"];
type Snapshot = { marks: ReadingMark[]; past: ReadingMark[][]; future: ReadingMark[][] };
type Editor = ReadingMark;
const colorLabels = { yellow: "Vàng", green: "Xanh lá", blue: "Xanh dương", pink: "Hồng" };
const kindLabels = { highlight: "Tô sáng", underline: "Gạch chân", note: "Ghi chú" };
type AnnotationContext = { marks: ReadingMark[]; tool: Tool; register: (region: string, node: HTMLElement | null) => void; beginSelection: () => void; capture: (auto?: boolean) => void; openNote: (mark: ReadingMark) => void };
const Context = createContext<AnnotationContext | null>(null);
type Controls = { tool: Tool; color: AnnotationColor; ready: boolean; status: string; count: number; canUndo: boolean; canRedo: boolean; choose: (tool: Tool) => void; setColor: (color: AnnotationColor) => void; undo: () => void; redo: () => void; notebook: () => void };
const ControlsContext = createContext<Controls | null>(null);

export function ReadingAnnotations({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ marks: [], past: [], future: [] });
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Đang mở sổ tay…");
  const [tool, setTool] = useState<Tool>("read");
  const [color, setColor] = useState<AnnotationColor>("yellow");
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notebook, setNotebook] = useState(false);
  const regions = useRef(new Map<string, HTMLElement>());
  const noteDialog = useRef<HTMLDialogElement>(null);
  const bookDialog = useRef<HTMLDialogElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const editing = editor !== null;
  const register = useCallback((region: string, node: HTMLElement | null) => { if (node) regions.current.set(region, node); else regions.current.delete(region); }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try { setSnapshot({ marks: parseReadingMarks(localStorage.getItem(storageKey)), past: [], future: [] }); setStatus("Tự lưu trên trình duyệt này"); }
      catch { setStatus("Không thể lưu trên trình duyệt. Ghi chú chỉ được giữ khi trang đang mở."); }
      setReady(true);
    });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    const onSelection = () => {
      if (editing || notebook) return;
      const native = window.getSelection();
      let found: ReadingSelection | null = null;
      for (const [name, root] of regions.current) {
        found = selectedReadingText(root, name, native);
        if (found) break;
      }
      setSelection(current => JSON.stringify(current) === JSON.stringify(found) ? current : found);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [editing, notebook]);

  useEffect(() => {
    const finish = () => setSelecting(false);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    return () => { document.removeEventListener("pointerup", finish); document.removeEventListener("pointercancel", finish); };
  }, []);

  useEffect(() => {
    if (editing) { if (!noteDialog.current?.open) noteDialog.current?.showModal(); noteField.current?.focus(); }
    else noteDialog.current?.close();
  }, [editing]);
  useEffect(() => { if (notebook) bookDialog.current?.showModal(); else bookDialog.current?.close(); }, [notebook]);

  function persist(next: Snapshot) {
    setSnapshot(next);
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, marks: next.marks })); setStatus("Đã lưu trên trình duyệt này"); }
    catch { setStatus("Chưa lưu được. Ghi chú chỉ được giữ khi trang đang mở."); }
  }
  function commit(marks: ReadingMark[]) {
    persist({ marks, past: [...snapshot.past.slice(-29), snapshot.marks], future: [] });
  }
  function dismissSelection() { setSelection(null); window.getSelection()?.removeAllRanges(); }
  function apply(kind: ReadingMark["kind"], target = selection) {
    if (!target || !ready) return;
    const root = regions.current.get(target.region);
    if (!root || !matchingReadingMark(target, target.region, readingRegionText(root))) { dismissSelection(); return; }
    const old = snapshot.marks.find(mark => mark.region === target.region && mark.start === target.start && mark.end === target.end && mark.kind === kind);
    if (!old && snapshot.marks.length >= maxReadingMarks) { setStatus(`Sổ tay đã có ${maxReadingMarks} đánh dấu. Hãy xóa bớt để thêm mới.`); return; }
    const mark: ReadingMark = old ? { ...old, color } : { ...target, id: crypto.randomUUID(), kind, color, note: "" };
    if (kind === "note") setEditor(mark);
    else commit([...snapshot.marks.filter(item => item.id !== mark.id), mark]);
    dismissSelection();
  }
  function capture(auto = false) {
    // Wait until the browser has completed a mouse or pen text selection.
    requestAnimationFrame(() => {
      for (const [region, root] of regions.current) {
        const found = selectedReadingText(root, region, window.getSelection());
        if (!found) continue;
        setSelection(found);
        if (auto && tool !== "read") apply(tool, found);
        break;
      }
    });
  }
  function choose(next: Tool) {
    setTool(next);
    if (next !== "read" && selection) apply(next);
    if (next === "read") dismissSelection();
  }
  function openNote(mark: ReadingMark) { bookDialog.current?.close(); setNotebook(false); setEditor({ ...mark }); dismissSelection(); }
  function jump(mark: ReadingMark) {
    bookDialog.current?.close(); setNotebook(false); dismissSelection();
    const root = regions.current.get(mark.region), range = root && readingMarkRange(root, mark);
    if (!root || !range) { setStatus("Đoạn văn đã thay đổi. Đánh dấu này không còn khớp nội dung."); return; }
    const node = range.startContainer.parentElement;
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    root.focus({ preventScroll: true });
    window.getSelection()?.addRange(range);
  }
  function undo() {
    const marks = snapshot.past.at(-1);
    if (marks) { persist({ marks, past: snapshot.past.slice(0, -1), future: [snapshot.marks, ...snapshot.future] }); dismissSelection(); }
  }
  function redo() {
    const marks = snapshot.future[0];
    if (marks) { persist({ marks, past: [...snapshot.past, snapshot.marks], future: snapshot.future.slice(1) }); dismissSelection(); }
  }
  return <Context.Provider value={{ marks: snapshot.marks, tool, register, beginSelection: () => setSelecting(true), capture, openNote }}><ControlsContext.Provider value={{ tool, color, ready, status, count: snapshot.marks.length, canUndo: !!snapshot.past.length, canRedo: !!snapshot.future.length, choose, setColor, undo, redo, notebook: () => { dismissSelection(); setNotebook(true); } }}>
    {children}
    {ready && selection && !selecting && !editing && !notebook && <div className={styles.selectionBar} role="region" aria-label="Đánh dấu đoạn đã chọn" data-annotation-ignore onPointerDown={event => event.preventDefault()}><span><b>Đã chọn</b><q>{selection.quote}</q></span><div><button type="button" onClick={() => apply("highlight")}><Highlighter />Tô sáng</button><button type="button" onClick={() => apply("underline")}><Underline />Gạch chân</button><button type="button" onClick={() => apply("note")}><Icon name="writing" />Ghi chú</button><button type="button" aria-label="Bỏ chọn đoạn văn" onClick={dismissSelection}><Icon name="close" /></button></div></div>}
    <dialog ref={noteDialog} className={styles.dialog} aria-labelledby="reading-note-title" onClose={() => setEditor(null)} onCancel={() => setEditor(null)}>
      <header><div><small>SỔ TAY READING</small><h2 id="reading-note-title">Ghi chú cho đoạn đã chọn</h2></div><button type="button" aria-label="Đóng ghi chú" onClick={() => setEditor(null)}><Icon name="close" /></button></header>
      {editor && <><blockquote lang="en">{editor.quote}</blockquote><label className={styles.noteLabel}>Ghi chú của bạn<textarea ref={noteField} value={editor.note} rows={5} maxLength={maxReadingNote} placeholder="Ý chính, từ mới hoặc điều bạn cần nhớ…" onChange={event => setEditor({ ...editor, note: event.target.value })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editor.note.trim()) { event.preventDefault(); commit([...snapshot.marks.filter(mark => mark.id !== editor.id), { ...editor, note: editor.note.trim() }]); setEditor(null); } }} /></label><p className={styles.noteLimit}>{editor.note.length}/{maxReadingNote} ký tự · Chỉ lưu trên trình duyệt này</p><footer><button type="button" onClick={() => setEditor(null)}>Hủy</button><button type="button" className={styles.save} disabled={!editor.note.trim()} onClick={() => { commit([...snapshot.marks.filter(mark => mark.id !== editor.id), { ...editor, note: editor.note.trim() }]); setEditor(null); }}><Icon name="save" />Lưu ghi chú</button></footer></>}
    </dialog>
    <dialog ref={bookDialog} className={`${styles.dialog} ${styles.notebook}`} aria-labelledby="reading-notebook-title" onClose={() => setNotebook(false)} onCancel={() => setNotebook(false)}>
      <header><div><small>RIÊNG CHO BÀI ĐỌC NÀY</small><h2 id="reading-notebook-title">Ghi chú & đánh dấu <span>{snapshot.marks.length}</span></h2></div><button type="button" aria-label="Đóng sổ tay" onClick={() => setNotebook(false)}><Icon name="close" /></button></header>
      <p className={styles.bookHint}>Chọn đoạn trích để quay lại vị trí trong đề. Ghi chú được giữ riêng theo tài khoản trên trình duyệt này.</p>
      {!snapshot.marks.length && <div className={styles.empty}><Icon name="writing" /><p>Sổ tay của bạn đang trống.</p><span>Bôi đen đoạn tiếng Anh rồi chọn Tô sáng, Gạch chân hoặc Ghi chú.</span></div>}
      <div className={styles.entries}>{snapshot.marks.map(mark => <article key={mark.id} data-color={mark.color}><div className={styles.entryMeta}><span>{kindLabels[mark.kind]}{mark.note && mark.kind !== "note" ? " · Có ghi chú" : ""}</span><div><button type="button" aria-label={`Sửa ghi chú: ${mark.quote.slice(0, 50)}`} onClick={() => openNote(mark)}><Icon name="writing" /></button><button type="button" aria-label={`Xóa đánh dấu: ${mark.quote.slice(0, 50)}`} onClick={() => commit(snapshot.marks.filter(item => item.id !== mark.id))}><Icon name="trash" /></button></div></div><button type="button" className={styles.quoteLink} lang="en" onClick={() => jump(mark)}>{mark.quote}</button>{mark.note && <p className={styles.savedNote}>{mark.note}</p>}</article>)}</div>
      <footer><span>{status}</span><button type="button" disabled={!snapshot.past.length} onClick={undo}><Icon name="replay" />Hoàn tác</button></footer>
    </dialog>
  </ControlsContext.Provider></Context.Provider>;
}

function Highlighter() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 15 8-11 5 4-9 10-4-3ZM9 15l-3 4 4 1 3-2M3 22h18" /></svg>; }
function Underline() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 3v9a6 6 0 0 0 12 0V3M4 22h16" /></svg>; }
export function ReadingAnnotationToolbar() {
  const controls = useContext(ControlsContext);
  if (!controls) return null;
  const { tool, color, ready, choose } = controls;
  const help = tool === "read" ? "Bôi đen đoạn tiếng Anh để đánh dấu hoặc ghi chú." : tool === "note" ? "Bôi đen đoạn tiếng Anh để thêm ghi chú." : `Kéo chọn đoạn tiếng Anh để ${kindLabels[tool].toLowerCase()}. Chọn Đọc để tra từ bình thường.`;
  return <div className={styles.toolbar} aria-label="Công cụ ghi chú bài đọc"><div className={styles.toolRow}><div className={styles.pens} role="group" aria-label="Chọn bút đánh dấu"><button type="button" disabled={!ready} aria-pressed={tool === "read"} onClick={() => choose("read")}><Icon name="book" />Đọc</button><button type="button" disabled={!ready} aria-pressed={tool === "highlight"} onClick={() => choose("highlight")}><Highlighter />Tô sáng</button><button type="button" disabled={!ready} aria-pressed={tool === "underline"} onClick={() => choose("underline")}><Underline />Gạch chân</button><button type="button" disabled={!ready} aria-pressed={tool === "note"} onClick={() => choose("note")}><Icon name="writing" />Ghi chú</button></div><div className={styles.colors} role="group" aria-label="Màu bút">{annotationColors.map(value => <button type="button" key={value} disabled={!ready} data-color={value} aria-label={`Màu ${colorLabels[value].toLowerCase()}`} aria-pressed={color === value} onClick={() => controls.setColor(value)}>{color === value && <Icon name="check" />}</button>)}</div><div className={styles.history}><button type="button" aria-label="Hoàn tác đánh dấu" disabled={!controls.canUndo} onClick={controls.undo}><Icon name="replay" /></button><button type="button" className={styles.redo} aria-label="Làm lại đánh dấu" disabled={!controls.canRedo} onClick={controls.redo}><Icon name="replay" /></button></div><button className={styles.openBook} type="button" disabled={!ready} onClick={controls.notebook}><Icon name="clipboard" />Sổ tay <span>{controls.count}</span></button></div><div className={styles.help}><span>{help}</span><small role="status">{controls.status}</small></div></div>;
}

export function AnnotatedReadingText({ region, children, className, textClassName, style, lang = "en", onActivate }: { region: string; children: ReactNode; className?: string; textClassName?: string; style?: CSSProperties; lang?: string; onActivate?: () => void }) {
  const context = useContext(Context);
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const [shapes, setShapes] = useState<{ mark: ReadingMark; rects: MarkRect[] }[]>([]);
  const register = context?.register;
  const marks = context?.marks;
  useEffect(() => {
    const node = root.current;
    if (!node || !register) return;
    register(region, node);
    return () => register(region, null);
  }, [region, register]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let frame = 0, active = true;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active) return;
        setShapes((marks ?? []).filter(mark => mark.region === region).flatMap(mark => {
          const rects = readingMarkRects(node, mark);
          return [{ mark, rects }];
        }));
      });
    };
    const observer = new ResizeObserver(measure); observer.observe(node);
    const mutation = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest("[data-annotation-ignore]"))) measure(); });
    // Observe only the text layer; annotation rectangles never become selectable text.
    if (node.firstElementChild) mutation.observe(node.firstElementChild, { subtree: true, childList: true, characterData: true });
    void document.fonts.ready.then(measure); measure();
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect(); };
  }, [marks, region, children, style]);
  function guardClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-annotation-ignore]")) return;
    // A label forwards its activation to the native radio. Let that click and
    // keyboard input reach onChange, even while an annotation tool is selected.
    if (gesture.current.moved) { event.preventDefault(); event.stopPropagation(); return; }
    if (target.closest("input,select,textarea")) return;
    if (onActivate) {
      event.preventDefault(); event.stopPropagation();
      onActivate();
      return;
    }
    const selection = root.current && selectedReadingText(root.current, region, window.getSelection());
    if (context && (context.tool !== "read" || selection)) { event.preventDefault(); event.stopPropagation(); }
  }
  return <div ref={root} className={`${styles.region} ${className ?? ""}`} style={style} lang={lang} tabIndex={-1} data-reading-region={region} data-tool={context?.tool}
    onPointerDown={event => { gesture.current = { x: event.clientX, y: event.clientY, moved: false }; context?.beginSelection(); }}
    onPointerMove={event => { if (event.buttons && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 5) gesture.current.moved = true; }}
    onPointerCancel={() => { gesture.current.moved = true; }}
    onPointerUp={event => {
      if (root.current && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 0 && selectedReadingText(root.current, region, window.getSelection())) gesture.current.moved = true;
      context?.capture(true);
    }}
    onKeyDown={() => { gesture.current.moved = false; }} onKeyUp={() => context?.capture()} onClickCapture={guardClick}>
    <div className={`${styles.text} ${textClassName ?? ""}`}>{children}</div><div className={styles.overlay} data-annotation-ignore aria-hidden="true">{shapes.flatMap(({ mark, rects }) => rects.map((rect, index) => <span key={`${mark.id}:${index}`} data-kind={mark.kind} data-color={mark.color} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />))}</div>
    {shapes.filter(({ mark, rects }) => mark.note && rects.length).map(({ mark, rects }) => <button type="button" className={styles.notePin} key={mark.id} data-annotation-ignore style={{ top: rects[0].top }} aria-label={`Mở ghi chú: ${mark.quote.slice(0, 70)}`} title={mark.note} onClick={() => context?.openNote(mark)}><Icon name="writing" /></button>)}
  </div>;
}
