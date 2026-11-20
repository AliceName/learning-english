"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import Icon from "@/components/site-icon";
import { activityLabels, DAY_MS, LEARNING_ACTIVITY_CHANGED, type LearningCalendar } from "@/lib/learning-activity";
import styles from "./streak-calendar.module.css";

const narrowQuery = "(max-width: 1000px)";
const weekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeZone: "UTC" });
const dayKey = (date: number) => new Date(date).toISOString().slice(0, 10);
const weekday = (date: number) => (new Date(date).getUTCDay() + 6) % 7;

function subscribeToWidth(update: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

function Calendar({ data, chooseYear }: { data: LearningCalendar; chooseYear: (year: number) => void }) {
  const { year, firstDay, today, streak } = data;
  const first = Date.parse(firstDay);
  const last = Date.parse(today);
  const [picked, setPicked] = useState<number>();
  const selected = picked ?? Math.min(Date.UTC(year, 11, 31), last);
  const selectedKey = dayKey(selected);
  const month = new Date(selected).getUTCMonth();
  const narrow = useSyncExternalStore(subscribeToWidth, () => window.matchMedia(narrowQuery).matches, () => false);
  const map = useRef<HTMLDivElement>(null);
  const byDay = new Map(data.days.map(day => [day.date, day.activities]));
  const activities = byDay.get(selectedKey) ?? [];
  const quarter = Math.floor(month / 3);
  const mapStart = Date.UTC(year, narrow ? quarter * 3 : 0, 1);
  const mapEnd = Date.UTC(year, narrow ? quarter * 3 + 3 : 12, 1);
  const firstWeek = mapStart - weekday(mapStart) * DAY_MS;
  const weekCount = Math.ceil((mapEnd - firstWeek) / (7 * DAY_MS));
  const monthStart = Date.UTC(year, month, 1);
  const monthEnd = Date.UTC(year, month + 1, 1);
  const years = Array.from({ length: Number(today.slice(0, 4)) - Number(firstDay.slice(0, 4)) + 1 },
    (_, index) => Number(today.slice(0, 4)) - index);

  function handleMapKey(event: KeyboardEvent<HTMLButtonElement>, date: number) {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const target = date + delta * DAY_MS;
    const button = map.current?.querySelector<HTMLButtonElement>(`[data-date="${dayKey(target)}"]`);
    if (button) { setPicked(target); button.focus(); }
  }

  return <>
    <header className={styles.header}>
      <div><h2>Chuỗi ngày học</h2><p>Kỷ lục <strong>{streak.longestStreak} ngày</strong> · {streak.studiedToday ? "Đã học hôm nay" : "Hôm nay chưa ghi nhận hoạt động"}</p></div>
      <span className={styles.badge}><Icon name="flame" /><strong>{streak.currentStreak}</strong> ngày</span>
    </header>
    <div className={styles.content}>
      <section aria-label="Bản đồ hoạt động" className={styles.overview}>
        <div className={styles.mapPanel}>
          <h3>{data.days.length} ngày học trong năm {year}</h3>
          {narrow && <label className={styles.quarter}>Giai đoạn <select value={quarter} onChange={event =>
            setPicked(Math.max(first, Date.UTC(year, Number(event.target.value) * 3, 1)))}>
            {[0, 1, 2, 3].map(index => <option key={index} value={index} disabled={Date.UTC(year, index * 3, 1) > last ||
              Date.UTC(year, index * 3 + 3, 1) <= first}>Tháng {index * 3 + 1}–{index * 3 + 3}</option>)}
          </select></label>}
          <div ref={map} className={styles.map} style={{ gridTemplateColumns: `24px repeat(${weekCount}, minmax(0, 1fr))` }}
            role="group" aria-label="Chọn ngày học. Dùng phím mũi tên để di chuyển theo ngày hoặc tuần.">
            <div className={styles.week} aria-hidden="true"><span />{weekdays.map((label, index) =>
              <span key={label} className={styles.tick}>{index === 0 || index === 2 || index === 4 ? label : ""}</span>)}</div>
            {Array.from({ length: weekCount }, (_, column) => {
              const start = firstWeek + column * 7 * DAY_MS;
              const labelMonth = new Date(Math.max(start, mapStart)).getUTCMonth();
              const showMonth = column === 0 || labelMonth !== new Date(Math.max(start - 7 * DAY_MS, mapStart)).getUTCMonth();
              return <div key={start} className={styles.week}>
                <span className={styles.tick} aria-hidden="true">{showMonth ? `T${labelMonth + 1}` : ""}</span>
                {Array.from({ length: 7 }, (_, row) => {
                  const date = start + row * DAY_MS;
                  if (date < mapStart || date >= mapEnd || date < first || date > last) return <span key={date} aria-hidden="true" />;
                  const key = dayKey(date);
                  const count = byDay.get(key)?.length ?? 0;
                  const label = `${dateFormat.format(date)} · ${count} loại hoạt động`;
                  return <button key={date} type="button" className={styles.tile} data-date={key} data-level={Math.min(3, count)}
                    title={label} aria-label={label} aria-pressed={date === selected} tabIndex={date === selected ? 0 : -1}
                    onClick={() => setPicked(date)} onKeyDown={event => handleMapKey(event, date)} />;
                })}
              </div>;
            })}
          </div>
          <div className={styles.legend} aria-label="Mức hoạt động theo số loại">
            {[0, 1, 2, 3].map(level => <span key={level}><i data-level={level} />{level === 3 ? "3+ loại hoạt động" : level}</span>)}
          </div>
        </div>
        {years.length > 1 && <div className={styles.years} role="group" aria-label="Chọn năm">
          {years.map(option => <button key={option} type="button" aria-pressed={year === option}
            onClick={() => chooseYear(option)}>{option}</button>)}
        </div>}
      </section>
      <div className={styles.lower}>
        <section aria-label="Lịch theo tháng">
          <div className={styles.monthHeader}>
            <button type="button" aria-label="Tháng trước" disabled={month === 0 || monthStart <= first}
              onClick={() => setPicked(Math.max(first, Date.UTC(year, month - 1, 1)))}>‹</button>
            <h3>Tháng {month + 1}, {year}</h3>
            <button type="button" aria-label="Tháng sau" disabled={month === 11 || monthEnd > last}
              onClick={() => setPicked(monthEnd)}>›</button>
          </div>
          <div className={styles.monthGrid}>
            {weekdays.map(label => <span className={styles.tick} key={label}>{label}</span>)}
            {Array.from({ length: weekday(monthStart) }, (_, index) => <span key={index} aria-hidden="true" />)}
            {Array.from({ length: (monthEnd - monthStart) / DAY_MS }, (_, index) => {
              const date = monthStart + index * DAY_MS;
              const key = dayKey(date);
              const learned = byDay.has(key);
              return <button key={date} type="button" className={styles.monthDay} disabled={date < first || date > last}
                data-learned={learned} aria-label={`${dateFormat.format(date)}${learned ? ", đã học" : ""}`}
                aria-current={key === today ? "date" : undefined} aria-pressed={date === selected} onClick={() => setPicked(date)}>
                {index + 1}{learned && <span aria-hidden="true"> ✓</span>}
              </button>;
            })}
          </div>
        </section>
        <section className={styles.details} aria-label="Chi tiết ngày học" aria-live="polite">
          <h3>{dateFormat.format(selected)}</h3>
          {activities.length
            ? <ul>{activities.map(activity => <li key={activity}>{activityLabels[activity]}</li>)}</ul>
            : <p>Chưa có hoạt động được ghi nhận.</p>}
        </section>
      </div>
    </div>
  </>;
}

export default function StreakCalendar() {
  const [year, setYear] = useState<number>();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ viewedYear: number | undefined; data: LearningCalendar | null }>();
  useEffect(() => {
    let controller: AbortController | undefined;
    function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const url = year === undefined ? "/api/learning-activity" : `/api/learning-activity?year=${year}`;
      void fetch(url, { signal: current.signal, cache: "no-store" }).then(response =>
        response.ok ? response.json() as Promise<LearningCalendar> : null
      ).then(data => {
        if (!current.signal.aborted) setResult({ viewedYear: year, data });
      }).catch(() => {
        if (!current.signal.aborted) setResult({ viewedYear: year, data: null });
      });
    }
    load();
    window.addEventListener("focus", load);
    window.addEventListener(LEARNING_ACTIVITY_CHANGED, load);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", load);
      window.removeEventListener(LEARNING_ACTIVITY_CHANGED, load);
    };
  }, [year, retry]);
  const current = result && result.viewedYear === year ? result : undefined;
  const calendar = current?.data;
  return <section id="learning-streak" className={styles.panel} aria-label="Chuỗi ngày học">
    {calendar
      ? <Calendar key={calendar.year} data={calendar} chooseYear={option => { if (option !== calendar.year) setYear(option); }} />
      : <div className={styles.placeholder}><h2>Chuỗi ngày học</h2>
        {current ? <><p role="status">Chưa tải được lịch học.</p><button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></>
          : <p role="status">Đang tải lịch học…</p>}
      </div>}
  </section>;
}
