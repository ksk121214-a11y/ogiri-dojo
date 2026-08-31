"use client";

import { useMemo, useState } from "react";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export interface CalendarMark {
  year: number;
  month: number; // 1-12
  day: number;
  kind: "previous" | "current" | "upcoming";
  label: string;
}

const MARK_STYLE: Record<CalendarMark["kind"], string> = {
  previous: "bg-[var(--ink)]/25 text-[var(--ink)]",
  current: `bg-[var(--accent)] text-[var(--paper)] font-black`,
  upcoming: "border-2 border-[var(--accent)] text-[var(--accent)] font-black",
};

// ライブ予定ページの月表示カレンダー。ダミーの前回/今回/次回のライブ日だけを
// マーキングする（実際の開催通知・繰り返しスケジュール機能は未実装のダミー表示）。
// 外部の日付ライブラリは使わず、素のDateだけで月グリッドを組み立てている。
export default function LiveCalendar({ marks }: { marks: CalendarMark[] }) {
  // 表示中のダミーライブが実際に見える状態で開くよう、初期表示月は
  // マーク済み日付の最初の月（=今回のライブがある月）にしている。
  const initial = marks[0] ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  const cells = useMemo(() => {
    const startWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const arr: (number | null)[] = Array.from({ length: startWeekday }, () => null);
    for (let d = 1; d <= daysInMonth; d += 1) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [viewYear, viewMonth]);

  const goPrev = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };
  const goToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth() + 1);
  };

  const findMark = (day: number) =>
    marks.find((m) => m.year === viewYear && m.month === viewMonth && m.day === day);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          aria-label="前の月"
          className="rounded-md border border-[var(--ink)]/25 px-3 py-1 font-sans text-lg font-bold text-[var(--ink)]/70 hover:bg-[var(--ink)]/5"
        >
          ‹
        </button>
        <p className="font-sans text-xl font-black text-[var(--ink)]">
          {viewYear}年{viewMonth}月
        </p>
        <button
          type="button"
          onClick={goNext}
          aria-label="次の月"
          className="rounded-md border border-[var(--ink)]/25 px-3 py-1 font-sans text-lg font-bold text-[var(--ink)]/70 hover:bg-[var(--ink)]/5"
        >
          ›
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded-md border border-[var(--ink)]/25 px-3 py-1 font-sans text-xs font-bold text-[var(--ink)]/70 hover:bg-[var(--ink)]/5"
        >
          今日
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((w, i) => (
          <div
            key={w}
            className={`font-sans text-sm font-bold ${
              i === 0 ? "text-[var(--accent)]" : i === 6 ? "text-blue-600" : "text-[var(--ink)]/70"
            }`}
          >
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          const col = i % 7;
          const mark = day == null ? undefined : findMark(day);
          const baseColor = col === 0 ? "text-[var(--accent)]" : col === 6 ? "text-blue-600" : "text-[var(--ink)]";
          // マークの有無・空白セルの有無に関わらず、数字＋ラベルの2段構造を常に同じ形で
          // 描画する（ラベル行はmarkが無い時もinvisibleで場所だけ確保する）ことで、
          // マーク付きの日がある月と無い月とで行の高さがずれないようにする。
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 py-1">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-sans text-sm ${
                  day == null ? "" : mark ? MARK_STYLE[mark.kind] : `${baseColor} font-bold`
                }`}
              >
                {day ?? ""}
              </span>
              <span
                className={`font-sans text-[9px] font-bold text-[var(--ink)]/60 ${mark ? "" : "invisible"}`}
              >
                {mark ? mark.label : " "}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-dashed border-[var(--ink)]/20 pt-2.5 font-sans text-[11px] font-bold text-[var(--ink)]/60">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]/25" aria-hidden />
          前回のライブ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden />
          今回のライブ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--accent)]" aria-hidden />
          次回のライブ
        </span>
      </div>
    </div>
  );
}
