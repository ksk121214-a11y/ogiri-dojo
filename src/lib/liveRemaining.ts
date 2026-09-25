// ライブ進行の残り時間計算（5回目レビュー対応）。
// 絶対締切(phase_deadline/judging_ends_at)から残り時間を出す場合、サーバー時計が
// 新鮮(fresh)でなければ端末時刻由来の誤った秒数を出さず、syncing=trueを返す。
// 一時停止中のanswering_remaining_msはDBから直接届く値なので、同期前でも使う。
export interface ClockView {
  now: number;
  fresh: boolean;
}
export interface RemainingResult {
  ms: number;
  syncing: boolean;
}

export function answeringRemaining(
  live: {
    answering_paused: boolean;
    answering_remaining_ms: number | null;
    phase_deadline: string | null;
  },
  clock: ClockView,
): RemainingResult {
  if (live.answering_paused && live.answering_remaining_ms != null) {
    return { ms: live.answering_remaining_ms, syncing: false };
  }
  if (!live.phase_deadline) return { ms: 0, syncing: false };
  if (!clock.fresh) return { ms: 0, syncing: true };
  return { ms: Math.max(0, new Date(live.phase_deadline).getTime() - clock.now), syncing: false };
}

export function judgingRemaining(judgingEndsAt: string | null | undefined, clock: ClockView): RemainingResult {
  if (!judgingEndsAt) return { ms: 0, syncing: false };
  if (!clock.fresh) return { ms: 0, syncing: true };
  return { ms: Math.max(0, new Date(judgingEndsAt).getTime() - clock.now), syncing: false };
}

// ページ見出し用の「残り○秒」。表示なし(sec=null)・同期待ち(syncing)・秒数の3通り。
export function phaseRemainingSeconds(
  live: {
    answering_paused: boolean;
    answering_remaining_ms: number | null;
    phase_deadline: string | null;
  },
  clock: ClockView,
): { sec: number | null; syncing: boolean } {
  if (!(live.answering_paused && live.answering_remaining_ms != null) && !live.phase_deadline) {
    return { sec: null, syncing: false };
  }
  const r = answeringRemaining(live, clock);
  if (r.syncing) return { sec: null, syncing: true };
  return { sec: Math.ceil(r.ms / 1000), syncing: false };
}
