// 運営者専用管理画面：「ライブ予定」の手動管理化。
// 実際にゲームが進行するlivesテーブルとは完全に切り離した、表示専用の予定データ
// (live_schedule_entries)の型と純粋関数群。
//
// 1件の予定を「準備中/前回/今回/次回/ホームの次回ライブ」のどこに表示するかを
// display_roleで管理する。'preparing'以外の各ロールは、DB側のunique indexにより
// 同時に1件しか割り当てられない（切り替えはset_live_schedule_role RPCで行う）。

export type LiveScheduleDisplayRole =
  | "preparing"
  | "previous"
  | "current"
  | "upcoming"
  | "home_upcoming";

export interface LiveScheduleEntry {
  id: string;
  event_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:MM:SS" or "HH:MM"
  reception_time: string; // "HH:MM:SS" or "HH:MM"
  ticket_no: string; // "#0001"形式（自由入力）
  display_role: LiveScheduleDisplayRole;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export const DISPLAY_ROLE_LABEL: Record<LiveScheduleDisplayRole, string> = {
  preparing: "準備中（未割当）",
  previous: "前回のライブ",
  current: "今回のライブ",
  upcoming: "次回のライブ",
  home_upcoming: "ホーム画面の次回ライブ",
};

// 管理画面の「表示先」セレクトで選べる4枠（'preparing'は初期値・待避先であり
// 明示的に選ぶ操作ではないため、切り替え候補としては別に定数化する）。
export const ASSIGNABLE_DISPLAY_ROLES: LiveScheduleDisplayRole[] = [
  "previous",
  "current",
  "upcoming",
  "home_upcoming",
];

// 開始時刻の選択肢：17:00〜24:00を30分刻みで列挙する（"HH:MM"形式）。
export function buildStartTimeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 17 * 60; minutes <= 24 * 60; minutes += 30) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return options;
}

// "HH:MM" または "HH:MM:SS" → 分単位の整数（日跨ぎは考慮しない、23:xx台までの運用のため）。
function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeString(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 開始時刻の5分前を受付時刻の初期値として返す。
export function defaultReceptionTime(startTime: string): string {
  return minutesToTimeString(timeStringToMinutes(startTime) - 5);
}

// 既存エントリのticket_noから数値部分を拾い、最大値+1を"#0001"形式で返す
// （1件も無ければ"#0001"）。手動編集を妨げないよう、あくまで初期候補の計算にのみ使う。
export function nextTicketNoCandidate(entries: LiveScheduleEntry[]): string {
  let max = 0;
  for (const entry of entries) {
    const match = entry.ticket_no.match(/(\d+)/);
    if (match) {
      const n = Number(match[1]);
      if (n > max) max = n;
    }
  }
  return `#${String(max + 1).padStart(4, "0")}`;
}

// 開催日を1週間後にずらす（"YYYY-MM-DD"文字列を受け取り同形式で返す）。
export function addOneWeek(eventDate: string): string {
  const d = new Date(`${eventDate}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + 7);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
