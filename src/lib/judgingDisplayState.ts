// useJudgingDisplay（src/lib/useJudgingDisplay.ts）が「今どの回答idを表示し続けて
// いるか」を管理する純粋な状態遷移。answerSubmitCue.tsと同じ「レンダー中にstateを
// 直接更新して即座に再レンダーさせる」パターンで使うため、副作用を一切含まない。
export interface JudgingDisplayState {
  answerId: string | null;
  expired: boolean;
  // backfillで採用した場合だけ設定される、expiryタイマーに使うべき時間(ms)。
  // 通常のactiveAnswer観測による採用ではnull（従来どおりgraceMsだけで期限を決める）。
  // src/lib/judgingDisplayBackfill.tsのJudgingDisplayBackfillCandidateが持つ
  // reveal_sequence_untilまでの残り時間と、呼び出し元のgraceMsのmin()。
  expireAfterMs: number | null;
}

export const initialJudgingDisplayState: JudgingDisplayState = {
  answerId: null,
  expired: false,
  expireAfterMs: null,
};

export interface JudgingDisplayBackfillInput {
  id: string;
  remainingUntilRevealSequenceMs: number;
}

export interface NextJudgingDisplayStateParams {
  activeAnswerId: string | null;
  // 現在のターンに属する回答idの集合（呼び出し元のturnAnswersから作る）。
  // turnAnswersは常にcurrent_turn_idへ絞り込み済みのため、前のターンのidは
  // 新しいターンのこの集合には決して含まれない＝ターン切り替えの検知に使える。
  turnAnswerIds: ReadonlySet<string>;
  // このターンで今追跡しているものが無い（初期状態）か、既に猶予切れの場合だけ
  // 採用してよい補完候補（src/lib/judgingDisplayBackfill.ts参照）。無ければnull。
  backfillCandidate: JudgingDisplayBackfillInput | null;
  // 通常のactiveAnswer観測（本当にrevealed→resolvedを観測できた場合）の
  // 表示猶予(ms)。補完採用時の表示時間はこれとreveal_sequence_untilの残り時間の
  // 小さい方になる。
  graceMs: number;
}

export function nextJudgingDisplayState(
  prev: JudgingDisplayState,
  params: NextJudgingDisplayStateParams,
): JudgingDisplayState {
  // 1) activeAnswer（revealedかつ未resolved）を新規観測したら、常に最優先でそれを
  //    採用する（従来どおり。補完表示より実際の観測を常に優先する）。この経路は
  //    reveal_sequence_untilによる上限を持たない従来どおりのgraceMs猶予を使う
  //    （expireAfterMs: null）。
  if (params.activeAnswerId) {
    if (params.activeAnswerId !== prev.answerId) {
      return { answerId: params.activeAnswerId, expired: false, expireAfterMs: null };
    }
    return prev;
  }

  // 2) 追跡中のidが現在のターンのturnAnswersにもう存在しないなら、ターンが
  //    切り替わった（または最初からターン不明）とみなし、追跡状態を一度リセットする。
  //    これにより、前の組・前のターンの回答を新しいターンへ持ち越さない。
  const stillInScope = prev.answerId !== null && params.turnAnswerIds.has(prev.answerId);
  const scoped: JudgingDisplayState = stillInScope ? prev : { answerId: null, expired: false, expireAfterMs: null };

  // 3) 「今このターンで何も追跡していない(answerId===null)」または「既に猶予切れ
  //    (expired===true)」の場合だけ、新しいbackfillCandidateへ切り替えてよい。
  //    表示中(expired===false)のものを割り込んで差し替えることは絶対にしない。
  //    かつ、同じ候補idへは（一度expiredにした後は）絶対に復活させない
  //    （candidate.id !== scoped.answerIdの場合だけ採用する）。
  const canAdoptNewBackfill = scoped.answerId === null || scoped.expired;
  const candidate = params.backfillCandidate;
  if (
    canAdoptNewBackfill &&
    candidate &&
    candidate.id !== scoped.answerId &&
    params.turnAnswerIds.has(candidate.id)
  ) {
    // reveal_sequence_untilを超えて表示が残ってはならないため、通常の猶予(graceMs)と
    // 権威時刻までの残り時間の小さい方を表示期限にする。
    const expireAfterMs = Math.max(0, Math.min(params.graceMs, candidate.remainingUntilRevealSequenceMs));
    return { answerId: candidate.id, expired: false, expireAfterMs };
  }
  return scoped;
}
