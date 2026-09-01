"use client";

import { CalendarAddGlyph } from "@/components/home/icons";
import LiveCalendar, { type CalendarMark } from "@/components/home/LiveCalendar";
import { CurrentLiveCard, PreviousLiveCard, UpcomingLiveCard } from "@/components/home/LiveScheduleCard";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import { formatScheduleReception, toScheduleEntryDate } from "@/lib/liveDateFormat";
import { useLiveSchedulePlan } from "@/lib/useLiveSchedulePlan";

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
// 2026-08-30（さらに追記）：「前回/今回/次回」の自動判定をやめ、運営が/admin/scheduleで
// 手動割り当てるlive_schedule_entries（表示専用データ）から取得するように変更した。
export default function LiveSchedulePage() {
  const { previous, current, upcoming, loading } = useLiveSchedulePlan();

  const currentReception = current ? formatScheduleReception(current.reception_time) : null;

  const handleAddToCalendar = () => {
    if (!current || !currentReception) return;
    const scheduledAtIso = new Date(`${current.event_date}T${current.start_time}+09:00`).toISOString();
    const ics = buildIcsContent(scheduledAtIso, current.ticket_no, currentReception);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ogiri-live-${current.event_date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const calendarMarks: CalendarMark[] = [];
  if (current) {
    const d = toScheduleEntryDate(current.event_date, current.start_time);
    calendarMarks.push({ year: Number(d.year), month: Number(d.month), day: Number(d.day), kind: "current", label: "今回" });
  }
  if (previous) {
    const d = toScheduleEntryDate(previous.event_date, previous.start_time);
    calendarMarks.push({ year: Number(d.year), month: Number(d.month), day: Number(d.day), kind: "previous", label: "前回" });
  }
  if (upcoming) {
    const d = toScheduleEntryDate(upcoming.event_date, upcoming.start_time);
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
          <PreviousLiveCard
            date={previous ? toScheduleEntryDate(previous.event_date, previous.start_time) : null}
          />

          <CurrentLiveCard
            live={
              current
                ? { ...toScheduleEntryDate(current.event_date, current.start_time), ticketNo: current.ticket_no }
                : null
            }
            reception={currentReception ?? undefined}
          />

          <UpcomingLiveCard
            live={
              upcoming
                ? { ...toScheduleEntryDate(upcoming.event_date, upcoming.start_time), ticketNo: upcoming.ticket_no }
                : null
            }
          />
        </>
      )}

      <div className="rounded-2xl bg-[var(--paper)]/70 p-4">
        <LiveCalendar marks={calendarMarks} />
      </div>

      {/* 2026-09-01: 「開催通知」トグルは見た目のON/OFFのみで実際の通知配信と
          連携していないダミー機能だったため撤去した（QA部指摘）。開催通知の
          実装（ベル通知への配信）は開催後の対応予定。カレンダー追加は実際に
          .icsファイルを生成する本物の機能なのでそのまま残す。 */}
      <button
        type="button"
        onClick={handleAddToCalendar}
        disabled={!current}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--ink)]/30 px-3 py-2.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CalendarAddGlyph />
        カレンダーに追加
      </button>
    </StadiumPageShell>
  );
}
