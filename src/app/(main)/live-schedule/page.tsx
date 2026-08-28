"use client";

import { useState } from "react";

import { BellGlyph, CalendarAddGlyph } from "@/components/home/icons";
import LiveCalendar, { type CalendarMark } from "@/components/home/LiveCalendar";
import { CurrentLiveCard, PreviousLiveCard, UpcomingLiveCard } from "@/components/home/LiveScheduleCard";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import {
  CURRENT_LIVE,
  CURRENT_LIVE_RECEPTION,
  PREVIOUS_LIVE,
  UPCOMING_LIVE,
} from "@/data/liveScheduleData";

const CALENDAR_MARKS: CalendarMark[] = [
  {
    year: Number(CURRENT_LIVE.year),
    month: Number(CURRENT_LIVE.month),
    day: Number(CURRENT_LIVE.day),
    kind: "current",
    label: "今回",
  },
  {
    year: Number(PREVIOUS_LIVE.year),
    month: Number(PREVIOUS_LIVE.month),
    day: Number(PREVIOUS_LIVE.day),
    kind: "previous",
    label: "前回",
  },
  {
    year: Number(UPCOMING_LIVE.year),
    month: Number(UPCOMING_LIVE.month),
    day: Number(UPCOMING_LIVE.day),
    kind: "upcoming",
    label: "次回",
  },
];

// 「今回のライブ」の日時からiCalendar(.ics)ファイルを組み立ててダウンロードする。
// 所要時間は未告知のため、暫定でおおよその目安（2時間）をブロックしている。
function buildIcsContent(): string {
  const y = CURRENT_LIVE.year;
  const m = CURRENT_LIVE.month.padStart(2, "0");
  const d = CURRENT_LIVE.day.padStart(2, "0");
  const [hh, mm] = CURRENT_LIVE.time.split(":");
  const start = `${y}${m}${d}T${hh}${mm}00`;
  const endHour = String((Number(hh) + 2) % 24).padStart(2, "0");
  const end = `${y}${m}${d}T${endHour}${mm}00`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bakusho Stadium//Live Schedule//JA",
    "BEGIN:VEVENT",
    `UID:ogiri-live-${y}${m}${d}@bakusho-stadium`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:爆笑スタジアム 大喜利ライブ ${CURRENT_LIVE.ticketNo}`,
    `DESCRIPTION:受付${CURRENT_LIVE_RECEPTION}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ライブ予定ページ。下部ナビ「次回ライブ」から遷移する専用ページ（従来のホーム内
// ページ内スクロールから変更）。前回・今回・次回のライブをチケット風カードで並べ、
// 月表示カレンダーとあわせて予定を一覧できるようにした。
// 「結果を見る」「詳細を見る」は先の画面がまだ無いため、押せる体裁のリンクにはしていない
// （LiveScheduleCard.tsx側で対応）。「開催通知」トグルは見た目のON/OFFのみで、
// 実際のプッシュ通知の仕組みとはまだ連携していないダミー機能。
export default function LiveSchedulePage() {
  const [notifyOn, setNotifyOn] = useState(true);

  const handleAddToCalendar = () => {
    const ics = buildIcsContent();
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ogiri-live-${CURRENT_LIVE.year}${CURRENT_LIVE.month.padStart(2, "0")}${CURRENT_LIVE.day.padStart(2, "0")}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <StadiumPageShell contentTheme="concrete">
      <div>
        <h1 className="font-sans text-4xl font-black text-[var(--ink)]">ライブ予定</h1>
        <div className="mt-2 h-[3px] w-full bg-[var(--ink)]" aria-hidden />
      </div>

      <PreviousLiveCard date={PREVIOUS_LIVE} />
      <CurrentLiveCard live={CURRENT_LIVE} reception={CURRENT_LIVE_RECEPTION} />
      <UpcomingLiveCard live={UPCOMING_LIVE} />

      <div className="rounded-2xl bg-[var(--paper)]/70 p-4">
        <LiveCalendar marks={CALENDAR_MARKS} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAddToCalendar}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--ink)]/30 px-3 py-2.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/5"
        >
          <CalendarAddGlyph />
          カレンダーに追加
        </button>
        <button
          type="button"
          onClick={() => setNotifyOn((v) => !v)}
          aria-pressed={notifyOn}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 font-sans text-xs font-bold transition ${
            notifyOn
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--ink)]/30 text-[var(--ink)]/60 hover:bg-[var(--ink)]/5"
          }`}
        >
          <BellGlyph />
          開催通知 {notifyOn ? "ON" : "OFF"}
        </button>
      </div>
    </StadiumPageShell>
  );
}
