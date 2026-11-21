"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiJson, aiRequest } from "@/lib/ai-courses";
import { SESSION_CHANGED } from "@/lib/session-events";
import styles from "./usage.module.css";

type Policy = { version: number; enabled: boolean; requestsPerMinute: number; callsPerDay: number; callsPerUserPerDay: number; tokensPerDay: number; cooldownUntil: string | null };
type Call = { id: string; startedAt: string; finishedAt: string | null; userId: number | null; feature: string; operation: string; model: string; attemptNo: number; outcome: string; contentOutcome: string; httpStatus: number | null; totalTokens: number | null; audioSeconds: number | null };
type Overview = {
  asOfUtc: string; counts: { requests: number; calls: number; retries: number; errors: number; ttsCalls: number; finishedCourses: number };
  tokens: { reportedTotal: number; knownCalls: number; unknownCalls: number; audioSeconds: number };
  policy: Policy; usage: { callsToday: number; tokensToday: number; resetAtUtc: string };
  series: { at: string; calls: number; errors: number }[]; calls: Call[];
  users: { userId: number | null; calls: number; tokens: number; fullName?: string | null; email?: string | null }[];
  policyChanges: { at: string; actor: number; reason: string; next: Policy }[];
};
const number = (value: number) => value.toLocaleString("vi-VN");
const date = (value: string) => new Date(value).toLocaleString("vi-VN");

export default function AiUsageDashboard() {
  const [days, setDays] = useState(1);
  const [data, setData] = useState<Overview | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [feature, setFeature] = useState("");
  const sessionValid = useRef(true);
  useEffect(() => {
    sessionValid.current = true;
    const invalidate = () => {
      sessionValid.current = false; setData(null); setPolicy(null); setNotice("");
      setError("Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại để xem thống kê.");
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANGED);
    if (channel) channel.onmessage = invalidate;
    window.addEventListener(SESSION_CHANGED, invalidate);
    return () => { sessionValid.current = false; channel?.close(); window.removeEventListener(SESSION_CHANGED, invalidate); };
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await aiRequest<Overview>(`/api/admin/ai/overview?days=${days}`, { signal });
    if (!signal?.aborted && sessionValid.current) { setData(value); setPolicy(value.policy); }
  }, [days]);
  useEffect(() => {
    const abort = new AbortController();
    aiRequest<Overview>(`/api/admin/ai/overview?days=${days}`, { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted && sessionValid.current) { setData(value); setPolicy(value.policy); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [days]);
  async function refresh() { setPending(true); setError(""); try { await load(); } catch (failure) { setError((failure as Error).message); } finally { setPending(false); } }
  async function save() {
    if (!policy) return;
    setError(""); setNotice(""); setPending(true);
    try {
      await aiRequest<Policy>("/api/admin/ai/limits", aiJson("PUT", { ...policy, reason }));
      setReason(""); await load(); setNotice("Đã lưu hạn mức. Các lượt gọi tiếp theo áp dụng cấu hình mới.");
    } catch (failure) { setError((failure as Error).message); }
    finally { setPending(false); }
  }
  return <main id="main-content" tabIndex={-1} className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>QUẢN TRỊ · AI API</span><h1>Lượt gọi &amp; hạn mức</h1><p>Theo dõi Gemini và TTS trong luồng tạo khóa học.</p></div><div className={styles.controls}><label>Khoảng thời gian<select value={days} onChange={event => { setError(""); setDays(Number(event.target.value)); }}><option value={1}>24 giờ qua</option><option value={7}>7 ngày qua</option><option value={30}>30 ngày qua</option></select></label><button disabled={pending} onClick={() => void refresh()}>Làm mới</button></div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data && !error && <p role="status">Đang tải thống kê…</p>}
    {data && <>
      <div className={styles.metrics}>{[
        ["Lượt gọi thực tế", data.counts.calls, `${data.counts.retries} lượt gọi lại`],
        ["Yêu cầu tạo khóa", data.counts.requests, `${data.counts.finishedCourses} khóa đã lưu`],
        ["Lượt TTS", data.counts.ttsCalls, `${number(data.tokens.audioSeconds)} giây audio hợp lệ`],
        ["Token được báo cáo", data.tokens.reportedTotal, `${data.tokens.unknownCalls} lượt chưa có số token`],
        ["Lượt lỗi / chưa xong", data.counts.errors, "Gồm lỗi HTTP, mạng và lượt đang xử lý"],
      ].map(([label, value, hint]) => <article key={label}><span>{label}</span><strong>{number(Number(value))}</strong><small>{hint}</small></article>)}</div>
      <p className={styles.caption}>Cập nhật lúc {date(data.asOfUtc)}. Số token chỉ cộng dữ liệu nhà cung cấp trả về. Hạn mức tính thêm phần dự phòng của lượt chưa có usage; chưa quy đổi thành chi phí.</p>
      <div className={styles.grid}>
        <section className={styles.panel}><h2>Tần suất lượt gọi</h2><p className={styles.caption}>{days === 1 ? "Theo giờ (nhãn giờ Việt Nam)" : "Theo ngày UTC"} · Lỗi và gọi lại đều được tính vào hạn mức.</p><div className={styles.chart}>{data.series.length === 0 ? <p>Chưa có lượt gọi trong khoảng thời gian này.</p> : data.series.map(row => <div key={row.at}><span>{days === 1 ? new Date(row.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : row.at}</span><div className={styles.track}><i style={{ width: `${row.calls / Math.max(...data.series.map(item => item.calls), 1) * 100}%` }} /></div><b>{row.calls}</b><small>{row.errors} lỗi</small></div>)}</div><h3>Theo người dùng</h3><div className={styles.users}>{data.users.map(row => <span key={row.userId ?? "system"}><strong>{row.userId ? <a href={`/admin/users/${row.userId}`} title={row.email ?? undefined}>{row.fullName ?? `Người dùng #${row.userId}`}</a> : "Hệ thống"}</strong>{row.calls} lượt · {number(row.tokens)} token</span>)}</div></section>
        <section className={styles.panel}><h2>Hạn mức đang áp dụng</h2><p className={styles.caption}>Reset ngày lúc 00:00 Việt Nam · tiếp theo {date(data.usage.resetAtUtc)}.</p><p>Hôm nay: <b>{data.usage.callsToday}/{data.policy.callsPerDay}</b> lượt · <b>{number(data.usage.tokensToday)}/{number(data.policy.tokensPerDay)}</b> token đã dùng hoặc dự phòng.</p>
          {data.policy.cooldownUntil && new Date(data.policy.cooldownUntil) > new Date(data.asOfUtc) && <p className={styles.notice}>Nhà cung cấp yêu cầu chờ đến {date(data.policy.cooldownUntil)}.</p>}
          {policy && <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending} className={styles.fields}>
            <label className={styles.checkbox}><input type="checkbox" checked={policy.enabled} onChange={event => setPolicy({ ...policy, enabled: event.target.checked })} />Cho phép gọi AI để tạo khóa học</label>
            <div className={styles.formGrid}>{([
              ["requestsPerMinute", "Lượt / phút", 1, 100], ["callsPerDay", "Lượt / ngày", 1, 10000],
              ["callsPerUserPerDay", "Lượt / người / ngày", 1, 1000], ["tokensPerDay", "Token / ngày", 1000, 10000000],
            ] as const).map(([field, label, min, max]) => <label key={field}>{label}<input type="number" min={min} max={max} step={1} required value={policy[field]} onChange={event => setPolicy({ ...policy, [field]: Number(event.target.value) })} /></label>)}</div>
            <label>Lý do thay đổi<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: tăng hạn mức để thử nghiệm nội bộ" /></label>
            <button className={styles.primary} type="submit">Lưu hạn mức</button>
          </fieldset></form>}
        </section>
      </div>
      <section className={styles.panel}><div className={styles.tableHeading}><div><h2>Nhật ký lượt gọi</h2><p className={styles.caption}>150 lượt mới nhất trong khoảng đã chọn. Bộ lọc áp dụng cho bảng này.</p></div><label>Tính năng<select value={feature} onChange={event => setFeature(event.target.value)}><option value="">Tất cả</option>{Array.from(new Set(data.calls.map(call => call.feature))).map(value => <option key={value}>{value}</option>)}</select></label></div>
        <div className={styles.tableScroll}><table><thead><tr>{["Thời điểm", "Người dùng", "Tác vụ / Model", "Lần gọi", "HTTP", "Kết quả / nội dung", "Token", "Audio"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.calls.filter(call => !feature || call.feature === feature).map(call => <tr key={call.id}><td>{date(call.startedAt)}</td><td>{call.userId ?? "Hệ thống"}</td><td>{call.operation}<small>{call.model}</small></td><td>{call.attemptNo}</td><td>{call.httpStatus ?? "—"}</td><td>{call.outcome}<small>{call.contentOutcome}</small></td><td>{call.totalTokens === null ? "Chưa báo cáo" : number(call.totalTokens)}</td><td>{call.audioSeconds === null ? "—" : `${call.audioSeconds}s`}</td></tr>)}</tbody></table></div>
      </section>
      <section className={styles.panel}><h2>Lịch sử thay đổi hạn mức</h2>{data.policyChanges.length === 0 ? <p className={styles.caption}>Chưa có thay đổi.</p> : <ul>{data.policyChanges.map((change, index) => <li key={index}>{date(change.at)} · Admin #{change.actor} · phiên bản {change.next.version}<p>{change.reason}</p></li>)}</ul>}</section>
      <p className={styles.caption}>Bản thử trên một máy: tác vụ và nhật ký lưu tại backend. Thống kê này ghi nhận các lượt gọi đi qua gateway tạo khóa học, không phải toàn bộ usage của tài khoản Google.</p>
    </>}
  </main>;
}
