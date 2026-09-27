// 「この利用者が今回、観客参加ボタンを明示的に押した」という意図（メモリ上のみ、期限付き）の
// 純粋な状態遷移。同意画面・匿名認証を挟んでも、意図が成立した場合だけ1回だけ自動で観客登録する。
//
// idle      意図なし（/liveを開いただけ・Xログイン・キャンセル・失敗・消費済み・破棄）。
// starting  ボタンを押し、同意/匿名認証の完了を待っている。
// armed     匿名認証が成功した（userIdを固定）。ライブが参加可能になるのを待つ。
// joining   join_liveを実行中（このtokenだけが完了を報告できる）。
export const AUDIENCE_INTENT_TTL_MS = 120_000;

export type IntentState =
  | { status: "idle"; seq: number }
  // liveId：ボタンを押した時点のライブID（取得できなければnull＝自動参加意図は成立させない）。
  | { status: "starting"; seq: number; token: number; liveId: string | null }
  | { status: "armed" | "joining"; seq: number; token: number; userId: string | null; armedAt: number; liveId: string };

export const initialIntentState: IntentState = { status: "idle", seq: 0 };

export type GuestSettled = { status: "started"; userId: string | null } | { status: "cancelled" } | { status: "failed" };

// 意図を開始する。すでに進行中（連打）なら開始しない（token=null）。
export function beginIntent(s: IntentState): { state: IntentState; token: number | null } {
  if (s.status !== "idle") return { state: s, token: null };
  const token = s.seq + 1;
  return { state: { status: "starting", seq: token, token, liveId: null }, token };
}

// 押した時点で取得したライブIDを意図に固定する（tokenが現在の意図と違えば無視）。
export function bindIntentLive(s: IntentState, token: number, liveId: string | null): IntentState {
  if (s.status !== "starting" || s.token !== token) return s;
  return { ...s, liveId };
}

// 同意/匿名認証の結果を反映する。tokenが現在の意図と違えば（破棄済み・別の押下）無視する。
export function settleIntent(s: IntentState, token: number, r: GuestSettled, nowMs: number): IntentState {
  if (s.status !== "starting" || s.token !== token) return s;
  if (r.status !== "started") return { status: "idle", seq: s.seq };
  // 押した時点のライブIDを取得できていなければ、自動参加意図は成立させない（匿名認証だけ完了）。
  if (s.liveId === null) return { status: "idle", seq: s.seq };
  return { status: "armed", seq: s.seq, token, userId: r.userId, armedAt: nowMs, liveId: s.liveId };
}

export function discardIntent(s: IntentState): IntentState {
  return s.status === "idle" ? s : { status: "idle", seq: s.seq };
}

// 自動登録を実行してよい（参加可能な）フェーズ。scheduled/interludeは受付前なので待つ。
const JOINABLE_PHASES = new Set(["opening", "topic_reveal", "answering", "group_result", "final_result"]);

export interface IntentContext {
  authUserId: string | null;
  authIsAnonymous: boolean;
  liveLoading: boolean;
  live: { id: string; phase: string } | null;
  alreadyParticipant: boolean;
  kicked: boolean;
}

export type IntentAction = { kind: "none" } | { kind: "join"; token: number };

// 現在の状況で意図を実行/待機/破棄する。join判定と同時にjoiningへ遷移するため、同じ状況で
// 何度呼ばれても（連打・Strict Mode・再描画）joinは1回しか返らない。
export function evaluateIntent(s: IntentState, ctx: IntentContext, nowMs: number): { state: IntentState; action: IntentAction } {
  const none = (state: IntentState = s) => ({ state, action: { kind: "none" } as IntentAction });
  if (s.status !== "armed") return none();
  const drop = () => none(discardIntent(s));

  if (nowMs - s.armedAt > AUDIENCE_INTENT_TTL_MS) return drop();
  // 認証反映の遅れ（まだ未確定）は待つ。確定した利用者が別人・非ゲスト（Xログイン等）なら破棄。
  if (ctx.authUserId === null) return none();
  if (!ctx.authIsAnonymous) return drop();
  if (s.userId !== null && s.userId !== ctx.authUserId) return drop();

  if (ctx.liveLoading) return none();
  // 押した時点のライブが終了・切り替わった（現在のライブが無い／別ID）場合は破棄し、別ライブへは参加しない。
  if (!ctx.live || ctx.live.id !== s.liveId) return none(discardIntent(s));

  if (ctx.live.phase === "closed") return none(discardIntent(s));
  if (ctx.kicked || ctx.alreadyParticipant) return none(discardIntent(s)); // join_liveを呼ばない
  if (!JOINABLE_PHASES.has(ctx.live.phase)) return none(); // scheduled/interlude：TTLの間待つ

  const joining: IntentState = { ...s, status: "joining" };
  return { state: joining, action: { kind: "join", token: s.token } };
}

// join_live完了（成功・失敗とも）。以後は意図を持たない（失敗時は中央の再試行ボタンで手動再試行）。
export function finishJoinIntent(s: IntentState, token: number): IntentState {
  return s.status === "joining" && s.token === token ? { status: "idle", seq: s.seq } : s;
}
