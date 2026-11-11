"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isWritingTaskCatalogue, taskWordGuidance, type WritingTaskCatalogue } from "@/lib/writing";
import styles from "./writing.module.css";

export const taskLevels = { Beginner: "Beginner · A1–A2", Intermediate: "Intermediate · B1–B2", Advanced: "Advanced · C1–C2" };
export default function WritingTaskLibrary() {
  const [catalogue, setCatalogue] = useState<WritingTaskCatalogue | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [level, setLevel] = useState("");
  const [genre, setGenre] = useState("");
  const [topic, setTopic] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/writing/tasks", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) })
      .then(async r => { const c: unknown = await r.json(); if (!r.ok || !isWritingTaskCatalogue(c)) throw new Error();
        if (!controller.signal.aborted) { setCatalogue(c); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("Chưa tải được thư viện đề. Bạn có thể thử lại; nháp và bài đã lưu vẫn được giữ."); });
    return () => controller.abort();
  }, [retry]);
  const items = catalogue?.items ?? [];
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");
  const filtered = items.filter(t => (!level || t.level === level) && (!genre || t.genre === genre) && (!topic || t.topic === topic)
    && fold(`${t.title} ${t.topic}`).includes(fold(search.trim())));
  return <section className={styles.taskLibrary} aria-labelledby="task-library-heading">
    <h2 id="task-library-heading">Chọn một bài luyện viết</h2>
    <p>Chọn đề có sẵn theo nhóm trình độ, dạng bài và chủ đề. Bạn không cần tự nghĩ đề.</p>
    <p className={styles.hint}>Chưa rõ trình độ? Hãy xem nhóm Beginner và chọn nhiệm vụ bạn hiểu. Nhóm đề gợi ý độ khó; CEFR vẫn đang thử nghiệm, đặc biệt chưa đáng tin cậy ở A1/C2.</p>
    <div className={styles.taskFilters}>
      <label>Nhóm trình độ<select value={level} onChange={e => setLevel(e.target.value)}><option value="">Tất cả trình độ</option>{Object.entries(taskLevels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label>Dạng bài<select value={genre} onChange={e => setGenre(e.target.value)}><option value="">Tất cả dạng bài</option>{[...new Set(items.map(t => t.genre))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Chủ đề<select value={topic} onChange={e => setTopic(e.target.value)}><option value="">Tất cả chủ đề</option>{[...new Set(items.map(t => t.topic))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Tìm đề<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên đề hoặc chủ đề…" /></label>
    </div>
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => setRetry(n => n + 1)}>Thử tải lại</button></p>}
    {!catalogue && !error && <p role="status">Đang tải thư viện đề…</p>}
    {catalogue && <><p role="status">{filtered.length} đề phù hợp · {items.length}/{catalogue.sourceCount} đề khả dụng</p>
      <div className={styles.taskCards}>{filtered.map(t => <article key={t.id} className={styles.taskCard}>
        <small>{taskLevels[t.level]} · {t.genre}</small><h3>{t.title}</h3><p>{t.topic}</p>
        <p>{taskWordGuidance(t)}</p><p className={styles.hint}>{t.requirements[0]}</p>
        <Link href={`/writing?taskId=${t.id}`} prefetch={false}>Xem đề & viết bài</Link>
      </article>)}</div>{filtered.length === 0 && <p>Không có đề phù hợp. Hãy đổi hoặc xóa bộ lọc.</p>}</>}
    <p className={styles.hint}>Nội dung W&I dùng cục bộ cho nghiên cứu. Checklist do agent diễn giải từ đề, chưa được chuyên gia kiểm định.</p>
    <Link href="/writing?custom=1" prefetch={false}>Dùng đề riêng hoặc tiếp tục nháp đề riêng</Link>
  </section>;
}
