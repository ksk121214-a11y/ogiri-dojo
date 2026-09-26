export interface CalendarMonthMark {
  year: number;
  month: number; // 1-12
  day: number;
}

// カレンダーの初期表示月：今日以降で最も近い開催日の月 → 無ければ最も新しい過去の開催日の月
// → マークが無ければ今日の月。
export function pickInitialCalendarMonth(
  marks: CalendarMonthMark[],
  today: { year: number; month: number; day: number },
): { year: number; month: number } {
  const key = (m: CalendarMonthMark) => m.year * 10000 + m.month * 100 + m.day;
  const todayKey = key(today);
  const upcoming = marks.filter((m) => key(m) >= todayKey).sort((a, b) => key(a) - key(b))[0];
  if (upcoming) return { year: upcoming.year, month: upcoming.month };
  const past = marks.filter((m) => key(m) < todayKey).sort((a, b) => key(b) - key(a))[0];
  if (past) return { year: past.year, month: past.month };
  return { year: today.year, month: today.month };
}
