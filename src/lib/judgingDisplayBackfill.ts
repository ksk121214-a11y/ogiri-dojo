// useJudgingDisplay（src/lib/useJudgingDisplay.ts）の「activeAnswer（revealed_atが
// 付いていて未resolvedの行）を一度も観測できなかった回答は、永久に表示されない」
// という欠陥への対策。クライアントの初回取得・Realtime購読確立が遅れ、revealed→
// resolvedの短い遷移を一度も観測できなかった場合でも、安全な条件を満たす間だけ
// 「最後に確定した回答」を一度だけ表示補完してよい候補を選ぶ純粋関数。
//
// 安全条件（呼び出し元のStageAnsweringView.tsx/AudienceAnsweringView.tsxどちらでも
// 共通）：
// - 候補はresolved=trueかつrevealed_atが付いている行だけ（未確定の行は対象外）。
// - 複数件あれば、revealed_atが最も新しい1件だけを候補にする（古い回答を選ばない）。
// - lives.reveal_sequence_until（採点確定の瞬間にDB側のresolveIfDue()が
//   now()+REVEAL_SEQUENCE_MSで設定する、全クライアント共通の演出ロック締切。
//   supabase/migrations/0079参照）より前の時刻である間だけ候補にする。
//   answers.resolved_at列は存在しないため、判定の根拠はこのサーバー権威時刻のみとし、
//   judging_ends_at（採点の締切であって確定時刻ではなく、早期確定もあり得る）は
//   根拠にしない。
// - サーバー時計(clock.fresh)が同期済みでない間は、何も安全に判定できないため
//   候補を出さない（楽観的に補完しない）。
//
// 設計判断（2026-10-09、レビュー対応）：reveal_sequence_untilは採点確定後の演出
// シーケンス全体（フリップが消える→玉が弾ける→得点表示→次の人が送信できるように
// なるまで、REVEAL_SEQUENCE_MS=7820ms）の締切であり、フリップ単体の表示時間
// （revealGraceMs=2200ms）の締切ではない。確定時刻をここから逆算してフリップ本来の
// 期間だけに限定する方式（観測がわずかに遅れただけで何も表示されなくなるケースが
// 増える）ではなく、「候補選定時点でreveal_sequence_untilまでに残っている時間」を
// ここで算出して呼び出し元へ返し、useJudgingDisplay側でgraceMsとのmin()を取って
// 表示期限に反映する方式を採る（judgingDisplayState.ts参照）。採点ボード・送信音は
// 補完表示と無関係に未発火のままなので、演出後半まで表示を引っ張っても他の演出と
// 衝突しない。これにより、表示は必ずreveal_sequence_until以内（＝次の回答が
// 開始し得る時点より前）に収まる。
export interface ResolvableAnswerLike {
  id: string;
  resolved: boolean;
  revealed_at: string | null;
}

export interface ClockLike {
  now: number;
  fresh: boolean;
}

export interface JudgingDisplayBackfillCandidate {
  id: string;
  // reveal_sequence_untilまでの残り時間(ms)。候補選定した瞬間のclock.nowを基準に
  // 算出する（正の値のみ。負・0はこの関数自体がnullを返すため発生しない）。
  remainingUntilRevealSequenceMs: number;
}

export function selectJudgingDisplayBackfillCandidate<T extends ResolvableAnswerLike>(
  turnAnswers: readonly T[],
  revealSequenceUntil: string | null,
  clock: ClockLike,
): JudgingDisplayBackfillCandidate | null {
  if (!clock.fresh) return null;
  if (!revealSequenceUntil) return null;
  const untilMs = new Date(revealSequenceUntil).getTime();
  const remainingUntilRevealSequenceMs = untilMs - clock.now;
  if (!(remainingUntilRevealSequenceMs > 0)) return null;

  let bestId: string | null = null;
  let bestMs = -Infinity;
  for (const a of turnAnswers) {
    if (!a.resolved || !a.revealed_at) continue;
    const ms = new Date(a.revealed_at).getTime();
    if (ms > bestMs) {
      bestId = a.id;
      bestMs = ms;
    }
  }
  if (bestId === null) return null;
  return { id: bestId, remainingUntilRevealSequenceMs };
}
