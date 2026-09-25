// 回答終了(answering→group_result)の進行RPC呼び出し判断（4回目レビュー対応）。
// ローカルの残り時間・端末時計・DB締切の推測を一切許可条件にせず、
// 「answeringフェーズにいる間は、single-flight＋最小間隔で進行RPCを試みる」だけにする。
// 締切前か・一時停止中か・未処理回答があるか・演出中か、の判断は全てRPC(DBのnow()と
// 行ロック後のDB状態)が行い、条件を満たさなければ安全にupdated=falseが返る。
// perfNowは注入できる（本番はperformance.now()＝端末時計の変更に影響されない）。
import type { LiveRow } from "./liveRoomTypes";

export interface AnsweringAdvancer {
  inFlight: boolean;
  lastAttemptPerf: number;
}

export function createAnsweringAdvancer(): AnsweringAdvancer {
  return { inFlight: false, lastAttemptPerf: -Infinity };
}

export type AnsweringAdvanceOutcome = "skipped" | "error" | "noop" | "advanced";

export async function tryAdvanceAnswering(p: {
  advancer: AnsweringAdvancer;
  perfNow: () => number;
  minIntervalMs: number;
  live: Pick<LiveRow, "id" | "current_phase" | "current_turn_id"> | null;
  isFrozen: () => boolean;
  callRpc: (live: { id: string; current_turn_id: string | null }) => Promise<{
    data: { updated: boolean; live: LiveRow | null } | null;
    error: unknown;
  }>;
  applyLive: (live: LiveRow) => void;
  afterAdvanced: (live: LiveRow) => Promise<void>;
}): Promise<AnsweringAdvanceOutcome> {
  const { advancer, live } = p;
  if (!live || live.current_phase !== "answering") return "skipped";
  if (advancer.inFlight) return "skipped";
  const perf = p.perfNow();
  if (perf - advancer.lastAttemptPerf < p.minIntervalMs) return "skipped";
  if (p.isFrozen()) return "skipped";

  advancer.inFlight = true;
  advancer.lastAttemptPerf = perf;
  try {
    const { data, error } = await p.callRpc({ id: live.id, current_turn_id: live.current_turn_id });
    if (error || !data) return "error";
    if (data.live) p.applyLive(data.live);
    if (data.updated && data.live) {
      await p.afterAdvanced(data.live);
      return "advanced";
    }
    return "noop"; // 締切前等：全件再取得はしない
  } finally {
    advancer.inFlight = false;
  }
}
