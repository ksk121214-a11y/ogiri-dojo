// お題発表の拍手音（歓声）の再生計画（4回目レビュー対応）。
// phase_deadline(DB時刻)から逆算した「本来の再生開始時刻」に対し、サーバー同期時計の
// 現在時刻(serverNowMs)がどこにあるかだけで決める純粋関数。端末のDate.now()は使わない。
export type TopicRevealSfxPlan =
  | { kind: "wait"; delayMs: number } // まだ開始時刻前：その時間待って先頭から再生
  | { kind: "offset"; offsetSec: number } // 開始時刻を過ぎている：経過分だけ途中から今すぐ再生
  | { kind: "skip" }; // 音源の尺以上に遅れている：再生しない

export function planTopicRevealSfx(p: {
  deadlineMs: number;
  serverNowMs: number;
  seMs: number;
  overlapMs: number;
}): TopicRevealSfxPlan {
  const idealStartAt = p.deadlineMs - p.seMs + p.overlapMs;
  const overdueMs = p.serverNowMs - idealStartAt;
  if (overdueMs <= 0) return { kind: "wait", delayMs: -overdueMs };
  if (overdueMs >= p.seMs) return { kind: "skip" };
  return { kind: "offset", offsetSec: overdueMs / 1000 };
}
