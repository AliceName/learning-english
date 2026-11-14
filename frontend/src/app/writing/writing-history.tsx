"use client";
import { useEffect, useRef, useState } from "react";
import { isWritingHistory, isWritingPractices, type WritingHistory, type WritingPractices } from "@/lib/writing-capabilities";
import styles from "./writing.module.css";

export default function WritingHistoryPanel({ authenticated, submissionId, practiceRootId, onCompare, onNavigate }: {
  authenticated: boolean; submissionId: number | null; practiceRootId?: number; onCompare: (id: number) => void; onNavigate: () => void;
}) {
  const [practices, setPractices] = useState<WritingPractices>({ items: [], nextBeforeId: null });
  const [history, setHistory] = useState<WritingHistory>({ items: [], nextBeforeId: null });
  const [selectedRoot, setSelectedRoot] = useState<number | null | undefined>();
  const root = selectedRoot === undefined ? practiceRootId : selectedRoot;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const paging = useRef<AbortController | null>(null);
  const url = root ? "/api/writing/submissions?limit=10&practiceRootId=" + root : "/api/writing/practices?limit=10";
  useEffect(() => {
    if (!authenticated) return;
    const version = ++generation.current;
    paging.current?.abort();
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value: unknown = await response.json();
      if (!response.ok || !(root ? isWritingHistory(value) : isWritingPractices(value))) throw new Error();
      if (controller.signal.aborted || version !== generation.current) return;
      if (root) setHistory(value as WritingHistory); else setPractices(value as WritingPractices);
      setError(""); setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) setError("Chưa tải được lịch sử. Bài đang soạn vẫn được giữ."); });
    return () => { controller.abort(); paging.current?.abort(); generation.current = version + 1; };
  }, [authenticated, submissionId, refresh, root, url]);
  const cursor = root ? history.nextBeforeId : practices.nextBeforeId;
  async function more() {
    if (!cursor || loading) return;
    const version = generation.current, controller = new AbortController();
    paging.current?.abort(); paging.current = controller; setLoading(true); setError("");
    try {
      const response = await fetch(url + "&beforeId=" + cursor, { cache: "no-store", signal: controller.signal });
      const value: unknown = await response.json();
      if (controller.signal.aborted || version !== generation.current) return;
      if (!response.ok || !(root ? isWritingHistory(value) : isWritingPractices(value))) throw new Error();
      if (root) { const page = value as WritingHistory; setHistory(old => ({ items: [...old.items, ...page.items.filter(i => !old.items.some(o => o.submissionId === i.submissionId))], nextBeforeId: page.nextBeforeId })); }
      else { const page = value as WritingPractices; setPractices(old => ({ items: [...old.items, ...page.items.filter(i => !old.items.some(o => o.practiceRootId === i.practiceRootId))], nextBeforeId: page.nextBeforeId })); }
    } catch { if (!controller.signal.aborted && version === generation.current) setError("Chưa tải được các bài tiếp theo. Hãy thử lại."); }
    finally { if (!controller.signal.aborted && version === generation.current) setLoading(false); }
  }
  if (!authenticated) return null;
  // Reopen from the server even if an earlier URL is still cached in the client router.
  return <section className={styles.history} aria-labelledby="writing-history-heading">
    <h2 id="writing-history-heading">{root ? "Các phiên bản của lượt #" + root : "Lượt luyện đã lưu"}</h2>
    <p className={styles.hint}>Mở một phiên bản rồi chọn “Tiếp tục từ phiên bản này” để soạn bản nháp từ bài đã lưu.</p>
    {root && <button type="button" onClick={() => { setSelectedRoot(null); setError(""); }}>Tất cả lượt luyện</button>}
    {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setRefresh(n => n + 1)}>Tải lại</button></p>}
    <ul>{root ? history.items.map((i, index) => <li key={i.submissionId} aria-current={i.submissionId === submissionId ? "true" : undefined}>
      <div><strong>{i.versionNumber ? `Phiên bản ${i.versionNumber}` : `Bài #${i.submissionId}`}</strong>
        {index === 0 && <span className={styles.pill}>Mới nhất</span>}
        {i.submissionId === submissionId && <span className={styles.pill}>Đang xem</span>}
        <p>{i.topic || "Đề riêng"} · Ước lượng {i.cefrLevel || "chưa có"} · Mục tiêu {i.targetRecorded ? i.targetCefr ?? "chưa đặt" : "chưa được ghi"}</p>
        <small>{new Date(i.createdAt).toLocaleString("vi-VN")}{i.parentSubmissionId
          ? ` · Từ ${i.parentVersionNumber ? `phiên bản ${i.parentVersionNumber}` : `bài #${i.parentSubmissionId}`}` : ""}</small>
        <p lang="en" className={styles.historyPreview}>{i.preview}</p></div>
      <div className={styles.editActions}><a href={"/writing?submissionId=" + i.submissionId} onClick={onNavigate}>{i.versionNumber ? `Mở phiên bản ${i.versionNumber}` : `Mở bài #${i.submissionId}`}</a>
        {submissionId !== null && submissionId !== i.submissionId && <button type="button" onClick={() => onCompare(i.submissionId)}>Đối chiếu</button>}</div>
    </li>) : practices.items.map(i => <li key={i.practiceRootId}><div><strong>Lượt #{i.practiceRootId} · {i.submissionCount} lần nộp</strong><p>{i.topic || "Đề riêng"}</p><small>Mới nhất: {i.cefrLevel} · {new Date(i.createdAt).toLocaleString("vi-VN")}</small></div>
      <div className={styles.editActions}><a href={"/writing?submissionId=" + i.latestSubmissionId} onClick={onNavigate}>Tiếp tục lượt #{i.practiceRootId}</a><button type="button" onClick={() => { setHistory({ items: [], nextBeforeId: null }); setSelectedRoot(i.practiceRootId); setError(""); }}>Xem các phiên bản</button></div></li>)}</ul>
    {!error && (root ? history.items.length : practices.items.length) === 0 && <p className={styles.hint}>Chưa có bài trong danh sách này.</p>}
    {cursor && <button type="button" disabled={loading} onClick={more}>{loading ? "Đang tải…" : "Xem thêm"}</button>}
  </section>;
}
