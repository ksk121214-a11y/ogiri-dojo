// ライブ開催予定のダミーデータ。ホーム（次回ライブチケット）と/live-scheduleの両方から
// 参照する単一の情報源にし、日付が食い違わないようにする。
// 「開催通知」はX等での告知が実態（本当にその時間になったらサイトへ来てもらう運用）のため、
// 実際の日時決定・変更は今後この定数を直接書き換える想定（バックエンド未接続のダミー段階）。

export interface LiveScheduleDate {
  year: string;
  month: string;
  day: string;
  weekday: string;
  time: string;
}

export interface LiveTicketInfo extends LiveScheduleDate {
  ticketNo: string;
}

// 前回開催済みのライブ（終了済み、参考表示のみ）。
export const PREVIOUS_LIVE: LiveScheduleDate = {
  year: "2026",
  month: "7",
  day: "13",
  weekday: "月",
  time: "21:00",
};

// 今回（直近で開催予定）のライブ。ホームの「次回ライブ」チケットと同じ情報源。
export const CURRENT_LIVE: LiveTicketInfo = {
  ticketNo: "#0720",
  year: "2026",
  month: "7",
  day: "20",
  weekday: "月",
  time: "21:00",
};
export const CURRENT_LIVE_RECEPTION = "20:55〜（定刻+5分まで）";

// 次回（今回のさらに次）のライブ。まだ受付時間は未告知のためreceptionは持たせない。
export const UPCOMING_LIVE: LiveTicketInfo = {
  ticketNo: "#0727",
  year: "2026",
  month: "7",
  day: "27",
  weekday: "月",
  time: "21:00",
};
