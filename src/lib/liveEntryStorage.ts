// ホーム画面の「次回ライブ」チケットにおける「入場済み状態」の永続化。
//
// 「入場」は、実際のプレイヤー/観客登録（useLiveFollowerStore.joinLive、participants
// テーブルへのinsert）とは別の、より手前の概念：ホーム画面で赤い半券を切って
// 待機画面（/live）へ進んだ、という事実だけを表す。まだ役割を選んでいない
// （participants行がまだ無い）間もホームに戻れば半券が切れたままである必要があるため、
// participants行の有無だけでは判定できず、この専用の状態を別に保持する。
//
// 既存のバックエンド（lives/participantsテーブル）には「入場したか」に対応する
// 適切な既存カラムが無いため、要件どおり最小実装としてlocalStorageに保存する。
// ユーザーID＋ライブIDに紐づけて保存し、「ライブが切り替わったら古い入場済み状態を
// 引き継がない」「司会者が完全終了(closed)したら削除する」の判定は呼び出し側で行う
// （このファイルは読み書きだけを担当する）。

const STORAGE_KEY = "ogiri-live-entry";

export interface LiveEntryState {
  userId: string;
  liveId: string;
  entered: boolean;
  enteredAt: string; // ISO文字列
}

function isValidEntry(value: unknown): value is LiveEntryState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.liveId === "string" &&
    typeof v.entered === "boolean" &&
    typeof v.enteredAt === "string"
  );
}

export function getLiveEntry(): LiveEntryState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 指定したユーザー・ライブに対応する入場済み状態が保存されていて、かつ
// entered===trueであるかどうかだけを判定する薄いヘルパー（呼び出し側の判定を簡潔にする）。
export function hasEnteredLive(userId: string, liveId: string): boolean {
  const entry = getLiveEntry();
  return !!entry && entry.entered && entry.userId === userId && entry.liveId === liveId;
}

export function setLiveEntry(userId: string, liveId: string): void {
  if (typeof window === "undefined") return;
  const entry: LiveEntryState = {
    userId,
    liveId,
    entered: true,
    enteredAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorageが使えない環境（プライベートブラウズ等）でも致命的にはしない。
    // その場合、リロードすると入場済み状態は失われる（半券が戻ってしまう）が、
    // 参加処理自体（joinLive）には影響しない。
  }
}

export function clearLiveEntry(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無視してよい（削除できなくても、次回の判定でuserId/liveIdの不一致により
    // 古い状態は自然に無効化される）。
  }
}
