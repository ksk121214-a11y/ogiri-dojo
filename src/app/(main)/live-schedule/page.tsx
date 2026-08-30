"use client";

import { useState } from "react";

import { BellGlyph, CalendarAddGlyph } from "@/components/home/icons";
import LiveCalendar, { type CalendarMark } from "@/components/home/LiveCalendar";
import { CurrentLiveCard, PreviousLiveCard, UpcomingLiveCard } from "@/components/home/LiveScheduleCard";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import { formatReceptionRange, toLiveScheduleDate } from "@/lib/liveDateFormat";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import { useLiveSchedule } from "@/lib/useLiveSchedule";

// 「今回のライブ」の日時からiCalendar(.ics)ファイルを組み立ててダウンロードする。
// 所要時間は未告知のため、暫定でおおよその目安（2時間）をブロックしている。
function buildIcsContent(scheduledAtIso: string, ticketNo: string, reception: string): string {
  const d = new Date(scheduledAtIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const endDate = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  const end = `${endDate.getUTCFullYear()}${pad(endDate.getUTCMonth() + 1)}${pad(endDate.getUTCDate())}T${pad(endDate.getUTCHours())}${pad(endDate.getUTCMinutes())}00Z`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bakusho Stadium//Live Schedule//JA",
    "BEGIN:VEVENT",
    `UID:ogiri-live-${scheduledAtIso}@bakusho-stadium`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:爆笑スタジアム 大喜利ライブ ${ticketNo}`,
    `DESCRIPTION:受付${reception}`,
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
// 2026-08-30（追記）：運営者専用管理画面の追加（第2段階）。日付・番号のハードコード
// 定数(src/data/liveScheduleData.ts)をやめ、useLiveSchedule()経由でlivesテーブルの
// 実データを表示するようにした。管理画面でライブ予定を変更すると、ここも
// （画面フォーカス復帰時などに）自動で新しい内容へ切り替わる。
export default function LiveSchedulePage() {
  const [notifyOn, setNotifyOn] = useState(true);
  const { previous, current, upcoming, loading } = useLiveSchedule();

  const currentTicketNo = current ? formatLiveTicketNo(current.sequence_number) : null;
  const currentReception = current
    ? formatReceptionRange(current.reception_starts_at, current.reception_ends_at)
    : null;

  const handleAddToCalendar = () => {
    if (!current || !currentTicketNo || !currentReception) return;
    const ics = buildIcsContent(current.scheduled_at, currentTicketNo, currentReception);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ogiri-live-${current.scheduled_at.slice(0, 10)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const calendarMarks: CalendarMark[] = [];
  if (current) {
    const d = toLiveScheduleDate(current.scheduled_at);
    calendarMarks.push({ year: Number(d.year), month: Number(d.month), day: Number(d.day), kind: "current", label: "今回" });
  }
  if (previous) {
    const d = toLiveScheduleDate(previous.scheduled_at);
    calendarMarks.push({ year: Number(d.year), month: Number(d.month), day: Number(d.day), kind: "previous", label: "前回" });
  }
  if (upcoming) {
    const d = toLiveScheduleDate(upcoming.scheduled_at);
    calendarMarks.push({ year: Number(d.year), month: Number(d.month), day: Number(d.day), kind: "upcoming", label: "次回" });
  }

  return (
    <StadiumPageShell contentTheme="concrete">
      <div>
        <h1 className="font-sans text-4xl font-black text-[var(--ink)]">ライブ予定</h1>
        <div className="mt-2 h-[3px] w-full bg-[var(--ink)]" aria-hidden />
      </div>

      {!loading && (
        <>
          {previous && <PreviousLiveCard date={toLiveScheduleDate(previous.scheduled_at)} />}

          <CurrentLiveCard
            live={
              current && currentTicketNo
                ? { ...toLiveScheduleDate(current.scheduled_at), ticketNo: currentTicketNo }
                : null
            }
            reception={currentReception ?? undefined}
          />

          <UpcomingLiveCard
            live={
              upcoming
                ? { ...toLiveScheduleDate(upcoming.scheduled_at), ticketNo: formatLiveTicketNo(upcoming.sequence_number) }
                : null
            }
          />
        </>
      )}

      <div className="rounded-2xl bg-[var(--paper)]/70 p-4">
        <LiveCalendar marks={calendarMarks} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAddToCalendar}
          disabled={!current}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--ink)]/30 px-3 py-2.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/5 disabled:cursor-not-allowed disabled:opacity-50"
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
