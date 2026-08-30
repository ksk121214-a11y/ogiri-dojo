// ライブ開催予定の型定義。
// 2026-08-30までは、ここにホーム・/live-scheduleが共有するハードコードの日付定数
// （PREVIOUS_LIVE/CURRENT_LIVE/UPCOMING_LIVE）を置いていたが、運営者専用管理画面の
// 追加（第2段階）でlivesテーブルの実データ（src/lib/useLiveSchedule.ts）に置き換えた。
// 型定義自体は既存コンポーネント（LiveScheduleCard.tsx等）が参照し続けるため残す。

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
