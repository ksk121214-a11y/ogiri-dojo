import type { GuestSettled } from "./audienceJoinIntent";

export const GUEST_START_FAILED_MESSAGE = "ゲスト参加に失敗しました。時間をおいて再度お試しください。";

// ライブID取得に時間制限を付ける。取得が遅い・失敗した場合はnull（自動参加意図だけ成立させない）。
// 通信自体は中断できないが、タイマーは必ず解除し、結果は呼び出し側がtokenで無視する。
export function resolveLiveIdWithTimeout(fetcher: () => Promise<string | null>, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    let p: Promise<string | null>;
    try {
      p = fetcher();
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// 「ログインせず観客として見る」ボタンの処理。
//  1. 意図を開始（連打ならnullで何もしない）
//  2. 押した時点のライブIDを固定（取得できなければnull＝自動参加意図は成立しない。認証だけ進める）
//  3. 同意・匿名認証の結果（成功/キャンセル/失敗）で意図を成立または破棄
// 非同期処理の境界（ライブID取得後・ゲスト開始の直前・結果反映の直前）ごとにtokenが現在も有効か
// 確認し、ページ離脱・Xログイン・キャンセル・別の意図開始で無効になっていたらそこで終了する
// （同意モーダルを開かない・匿名認証を始めない・意図やモーダルの状態を変更しない）。
// どの段階で例外が起きても外へ投げず、日本語の失敗結果を返す。
export async function pressGuestAudienceButton<R extends { ok: boolean }>(deps: {
  begin: () => number | null;
  isCurrent: (token: number) => boolean;
  bindLive: (token: number, liveId: string | null) => void;
  resolveLiveId: () => Promise<string | null>;
  settle: (token: number, result: GuestSettled) => void;
  requestGuestStart: (options: { onSettled: (r: GuestSettled) => void; isCurrent: () => boolean }) => Promise<R>;
}): Promise<{ pressed: false } | { pressed: true; result: R | { ok: false; reason: string } }> {
  const token = deps.begin();
  if (token === null) return { pressed: false };
  const current = () => deps.isCurrent(token);
  try {
    let liveId: string | null = null;
    try {
      liveId = await deps.resolveLiveId();
    } catch {
      liveId = null;
    }
    if (!current()) return { pressed: false }; // 待機中にページ離脱・Xログイン等で無効になった
    deps.bindLive(token, liveId);
    if (!current()) return { pressed: false };
    const result = await deps.requestGuestStart({
      onSettled: (r) => {
        if (current()) deps.settle(token, r);
      },
      isCurrent: current,
    });
    return { pressed: true, result };
  } catch {
    if (current()) deps.settle(token, { status: "failed" });
    return { pressed: true, result: { ok: false, reason: GUEST_START_FAILED_MESSAGE } };
  }
}
