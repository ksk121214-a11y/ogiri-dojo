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

const WEEKDAY_ONLY_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  weekday: "short",
});

// 運営者専用管理画面の追加：ライブ予定(live_schedule_entries)のevent_date("YYYY-MM-DD")・
// start_time("HH:MM"or"HH:MM:SS")の分離カラムから、表示用の{year,month,day,weekday,time}を
// 組み立てる。既にJSTの壁時計値として保存されているためタイムゾーン変換は不要で、
// 曜日の算出にだけ日付を組み立てて使う。
export function toScheduleEntryDate(eventDate: string, startTime: string): LiveScheduleDate {
  const [year, month, day] = eventDate.split("-");
  const [hour, minute] = startTime.split(":");
  const weekday = WEEKDAY_ONLY_FORMATTER.format(
    new Date(`${eventDate}T00:00:00+09:00`),
  ).replace("曜日", "");
  return {
    year,
    month: String(Number(month)),
    day: String(Number(day)),
    weekday,
    time: `${hour}:${minute}`,
  };
}

// ライブ予定の受付時間帯表示（例：「20:55〜」）。終了時刻は運用上持たないため開始時刻のみ。
export function formatScheduleReception(receptionTime: string): string {
  const [hour, minute] = receptionTime.split(":");
  return `${hour}:${minute}〜`;
}
