// lives.scheduled_at等のtimestamptz(ISO文字列、DBはUTCで保持)を、
// 画面表示用に日本時間(Asia/Tokyo)の年月日・曜日・時刻へ変換するヘルパー。
// 新規の日付ライブラリは導入せず、Intl.DateTimeFormatのみで組み立てる。
import type { LiveScheduleDate } from "@/data/liveScheduleData";

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  weekday: "short",
});
const PART_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// LiveScheduleCard.tsx等が使う{year,month,day,weekday,time}の形に変換する。
export function toLiveScheduleDate(iso: string): LiveScheduleDate {
  const date = new Date(iso);
  const parts = PART_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_FORMATTER.format(date).replace("曜日", "");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday,
    time: `${get("hour")}:${get("minute")}`,
  };
}

// 受付時間帯の表示文字列（例：「20:55〜21:05」）。終了時刻が無ければ開始時刻のみ。
export function formatReceptionRange(startsAtIso: string | null, endsAtIso: string | null): string {
  if (!startsAtIso) return "未定";
  const start = toLiveScheduleDate(startsAtIso).time;
  if (!endsAtIso) return `${start}〜`;
  const end = toLiveScheduleDate(endsAtIso).time;
  return `${start}〜${end}`;
}
