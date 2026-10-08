// ボット回答の送信方針（司会画面のボット処理専用）。
//
// 背景：ボットの回答→審査→次のボット回答、と連鎖すると、人間の回答者は「審査中…」で
// 送信できない時間が続き、回答時間内に1件も送れないことがあった（本番通し確認）。
// また同一tickで複数ボットが同時にINSERTすると、answers_one_unresolved_per_turn
// （1ターンに未確定回答は1件）や(turn_id,participant_id,seq)のUNIQUEに衝突していた。
//
// このモジュールは次を担う（DBの制約・RLS・締切チェックは一切弱めない）：
// 1) 人間の未送信回答者がいる間、審査が終わって送信可能になってから一定時間
//    （猶予）はボットに新しい回答を送らせない。猶予はサーバー同期時計基準。
//    人間が初回回答を送るまでは、すべての送信可能時間帯で猶予を与える（回数上限なし）。
//    猶予中も回答の持ち時間は消費されるため、人間が離席していても期限には必ず到達する。
// 2) ボットの回答INSERTを全ボット合わせて同時に1件だけにし、同じ
//    (turn, participant, seq)を二度送らない（single-flight＋冪等キー）。
// 3) 締切直前（RLSで拒否される時間帯）には送らない。

export type BotAnswerTimingProfile = "standard" | "short_test";

// 猶予の理由：回答の持ち時間(answering_remaining_ms)は審査中は止まり、送信可能に
// なった時間だけ進む。人間が「審査中に書きためた回答」を送信ボタンで送る、または
// 短い回答を打ち始めるのに必要な余裕として、standardは6秒、short_testは2秒
// （short_testは回答時間20秒・審査6秒と全体が短いため、猶予も比例して短くする）。
export const BOT_HUMAN_GRACE_MS: Record<BotAnswerTimingProfile, number> = {
  standard: 6_000,
  short_test: 2_000,
};

// 締切のこの時間前からはボットに新しい回答を送らせない（送信〜DB反映の間に
// 締切を跨いでRLSで拒否されるのを避けるための余裕）。
export const BOT_ANSWER_DEADLINE_MARGIN_MS = 1_500;

// 本番のボット回答は、1組・1周（ターン）あたり最大2件（ボット全員の合計）。
// 人間の回答数には影響させない。撮影用の体験版（ローカル）の既定はボット回答0件で、ここは本番のみ。
export const BOT_ANSWER_MAX_PER_TURN = 2;

export function botAnswersAllowedForTurn(botAnswersSentThisTurn: number): boolean {
  return botAnswersSentThisTurn < BOT_ANSWER_MAX_PER_TURN;
}

export function botHumanGraceMs(timingProfile: string | null | undefined): number {
  return timingProfile === "short_test"
    ? BOT_HUMAN_GRACE_MS.short_test
    : BOT_HUMAN_GRACE_MS.standard;
}

// ---- 送信可能な時間帯（idle window）の追跡 ----
// busy（審査サイクル中）でなくなった瞬間から次にbusyになるまでを1つの窓とし、
// ターンごとに数える。時刻はサーバー同期時計（nowMs）だけを使う。
export interface BotIdleTracker {
  turnId: string | null;
  idleSinceMs: number | null;
  windowsStarted: number;
}

export function createBotIdleTracker(): BotIdleTracker {
  return { turnId: null, idleSinceMs: null, windowsStarted: 0 };
}

export function resetBotIdleTracker(t: BotIdleTracker): void {
  t.turnId = null;
  t.idleSinceMs = null;
  t.windowsStarted = 0;
}

// tickごとに呼ぶ。nowMs===nullは「同期時計がfreshでない」ことを表し、その間は
// 状態を変えない（誤った時刻で窓を開始・終了させない）。
export function observeBotIdleWindow(
  t: BotIdleTracker,
  p: { turnId: string; busy: boolean; nowMs: number | null },
): void {
  if (t.turnId !== p.turnId) {
    t.turnId = p.turnId;
    t.idleSinceMs = null;
    t.windowsStarted = 0;
  }
  if (p.busy) {
    t.idleSinceMs = null;
    return;
  }
  if (p.nowMs === null) return;
  if (t.idleSinceMs === null) {
    t.idleSinceMs = p.nowMs;
    t.windowsStarted += 1;
  }
}

export type BotAnswerGateReason =
  | "clock-not-fresh"
  | "busy"
  | "paused"
  | "no-deadline"
  | "near-deadline"
  | "human-priority";

export type BotAnswerGate = { allow: true } | { allow: false; reason: BotAnswerGateReason };

export function decideBotAnswerGate(p: {
  nowMs: number | null;
  busy: boolean;
  paused: boolean;
  phaseDeadlineMs: number | null;
  // 現在のターンの舞台にいる、ボットではない(=人間)回答者のうち、このターンでまだ
  // 1件も送信していない人数（退場済みは含めない）。
  humanUnsentCount: number;
  tracker: BotIdleTracker;
  graceMs: number;
  deadlineMarginMs?: number;
}): BotAnswerGate {
  if (p.nowMs === null) return { allow: false, reason: "clock-not-fresh" };
  if (p.busy) return { allow: false, reason: "busy" };
  if (p.paused) return { allow: false, reason: "paused" };
  if (p.phaseDeadlineMs === null) return { allow: false, reason: "no-deadline" };
  const margin = p.deadlineMarginMs ?? BOT_ANSWER_DEADLINE_MARGIN_MS;
  if (p.nowMs >= p.phaseDeadlineMs - margin) return { allow: false, reason: "near-deadline" };
  // 人間の未送信回答者がいる間は、回数に関わらず毎回の送信可能時間帯で猶予を与える。
  if (p.humanUnsentCount > 0) {
    const since = p.tracker.idleSinceMs;
    if (since === null || p.nowMs - since < p.graceMs) {
      return { allow: false, reason: "human-priority" };
    }
  }
  return { allow: true };
}

// ---- ボット回答INSERTのsingle-flight＋冪等＋バックオフ ----
// INSERTエラーの意味（再送してよいか）を制約名まで見て分類する。
//  ok                 成功。
//  already-exists     answers_turn_id_participant_id_seq_key：同じボット・同じ回答順が既に存在
//                     （複数司会タブ・遅延処理の重複）。成功相当のno-op（再送しない）。
//  busy-conflict      answers_one_unresolved_per_turn：別の回答が審査中という競合。現在の回答が
//                     解決した後にバックオフを置いて再試行する。
//  forbidden          42501（RLS拒否）：answering_paused・演出中などの一時的な状態ずれでも起きる。
//                     同じターンの回答時間内ならバックオフ後に再試行する。締切到達・ターン変更・
//                     退場等は呼び出し側のゲートが確認して以後送らない。
//  unknown-conflict   上記以外の23505：意味が分からないため成功扱いにせず、バックオフして再試行する。
//  transient          通信断など：バックオフして再試行する。
export type BotAnswerInsertOutcome =
  | "ok"
  | "already-exists"
  | "busy-conflict"
  | "forbidden"
  | "unknown-conflict"
  | "transient";

export const BOT_SEQ_CONSTRAINT = "answers_turn_id_participant_id_seq_key";
export const BOT_UNRESOLVED_CONSTRAINT = "answers_one_unresolved_per_turn";

export function classifyBotAnswerInsertError(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
): BotAnswerInsertOutcome {
  if (!error) return "ok";
  if (error.code === "23505") {
    const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
    if (text.includes(BOT_SEQ_CONSTRAINT)) return "already-exists";
    if (text.includes(BOT_UNRESOLVED_CONSTRAINT)) return "busy-conflict";
    return "unknown-conflict";
  }
  if (error.code === "42501") return "forbidden";
  return "transient";
}

// 失敗後の再試行までの最小間隔（500ms tickごとの連打にならないためのクールダウン）。
// 試行回数ごとに倍にして上限で頭打ちにする。
export const BOT_RETRY_BACKOFF_MS = { busyConflict: 1_500, forbidden: 3_000, unknown: 3_000, transient: 2_000 } as const;
export const BOT_RETRY_BACKOFF_CAP_MS = 12_000;
// 意味の分からない23505は、無限には再試行しない。
export const BOT_UNKNOWN_CONFLICT_MAX_ATTEMPTS = 3;

export function botRetryBackoffMs(outcome: BotAnswerInsertOutcome, attempts: number): number {
  const base =
    outcome === "busy-conflict"
      ? BOT_RETRY_BACKOFF_MS.busyConflict
      : outcome === "forbidden"
        ? BOT_RETRY_BACKOFF_MS.forbidden
        : outcome === "unknown-conflict"
          ? BOT_RETRY_BACKOFF_MS.unknown
          : BOT_RETRY_BACKOFF_MS.transient;
  return Math.min(BOT_RETRY_BACKOFF_CAP_MS, base * 2 ** Math.max(0, attempts - 1));
}

interface BotAnswerRecord {
  done: boolean;
  attempts: number;
  retryAtMs: number;
}

export interface BotAnswerGuard {
  inFlight: boolean;
  records: Map<string, BotAnswerRecord>;
}

export function createBotAnswerGuard(): BotAnswerGuard {
  return { inFlight: false, records: new Map() };
}

export function resetBotAnswerGuard(g: BotAnswerGuard): void {
  g.inFlight = false;
  g.records.clear();
}

export function botAnswerKey(turnId: string, participantId: string, seq: number): string {
  return `${turnId}:${participantId}:${seq}`;
}

// 全ボット共通で同時に1件だけ。完了済み（成功・既存）、バックオフ中のキーはfalse。
// nowMsはサーバー同期時計の時刻（fresh時のみ呼ばれる）。
export function tryBeginBotAnswer(g: BotAnswerGuard, key: string, nowMs: number): boolean {
  if (g.inFlight) return false;
  const rec = g.records.get(key);
  if (rec && (rec.done || rec.retryAtMs > nowMs)) return false;
  g.inFlight = true;
  return true;
}

export function finishBotAnswer(g: BotAnswerGuard, key: string, outcome: BotAnswerInsertOutcome, nowMs: number): void {
  g.inFlight = false;
  const prev = g.records.get(key);
  const attempts = (prev?.attempts ?? 0) + 1;
  if (outcome === "ok" || outcome === "already-exists") {
    g.records.set(key, { done: true, attempts, retryAtMs: 0 });
    return;
  }
  if (outcome === "unknown-conflict" && attempts >= BOT_UNKNOWN_CONFLICT_MAX_ATTEMPTS) {
    g.records.set(key, { done: true, attempts, retryAtMs: 0 });
    return;
  }
  g.records.set(key, { done: false, attempts, retryAtMs: nowMs + botRetryBackoffMs(outcome, attempts) });
}
