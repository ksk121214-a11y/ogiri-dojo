"use client";

import { useEffect, useMemo, useState } from "react";

import {
  initialJudgingDisplayState,
  nextJudgingDisplayState,
  type JudgingDisplayBackfillInput,
} from "@/lib/judgingDisplayState";

// activeAnswerが確定した瞬間、ストア上はすぐnullになる（次の回答のreveal待ちに入るため）。
// しかし回答カード・採点ボタン・採点ボードはそのままだと表示する間もなく消えてしまうので、
// 確定後もこの猶予ぶんだけ直前の回答を表示し続ける。
const RESOLVE_POP_GRACE_MS = 3600;

// T（回答1件を表す型）はidさえ持っていれば本番のAnswerRow(snake_case)でも
// live-demoのDemoAnswer(camelCase)でも同じロジックを使い回せるよう総称化してある
// （既存の呼び出し元は全員AnswerRowを渡すため、型推論の結果もAnswerRowのままで
// 動作は一切変わらない）。
export function useJudgingDisplay<T extends { id: string }>(
  activeAnswer: T | null,
  turnAnswers: T[],
  // 呼び出し側で演出フローの間隔を細かく制御したい場合（design-previewなど）に
  // 猶予時間を上書きできるようにする。省略時は本番と同じ既定値。
  graceMs: number = RESOLVE_POP_GRACE_MS,
  // 2026-10-09追加：activeAnswer（revealedかつ未resolved）の状態を一度も観測
  // できなかった回答（クライアントの初回取得・購読確立が遅れ、短いrevealed→
  // resolvedの遷移を丸ごと逃した場合）を、安全な条件下でのみ一度だけ表示補完する
  // ための候補。省略時（既存の呼び出し元すべて）は従来どおり補完を一切行わない。
  // 候補の選定はsrc/lib/judgingDisplayBackfill.ts（reveal_sequence_until等の
  // サーバー権威時刻による安全確認）を呼び出し元で行う。
  backfillCandidate?: JudgingDisplayBackfillInput | null,
): T | null {
  const [state, setState] = useState(initialJudgingDisplayState);
  const turnAnswerIds = useMemo(() => new Set(turnAnswers.map((a) => a.id)), [turnAnswers]);

  // レンダー中にstateを更新する（Reactが公式に認めている「前回のpropsから派生した
  // stateを持つ」パターン）。以前はこの更新をuseEffect内でだけ行っていたため、
  // activeAnswerがnullになった「まさにその回のレンダー」ではまだ古いIDしか
  // 参照できず、一瞬だけdisplayedAnswerがnullになって（＝採点ボードのroundKeyも
  // 一瞬nullに変わって）ボールが弾ける演出を再生する前に消えてしまうバグがあった。
  const computed = nextJudgingDisplayState(state, {
    activeAnswerId: activeAnswer?.id ?? null,
    turnAnswerIds,
    backfillCandidate: backfillCandidate ?? null,
    graceMs,
  });
  if (
    computed.answerId !== state.answerId ||
    computed.expired !== state.expired ||
    computed.expireAfterMs !== state.expireAfterMs
  ) {
    setState(computed);
  }

  useEffect(() => {
    if (activeAnswer || !state.answerId || state.expired) return;
    // 補完採用時はexpireAfterMs（reveal_sequence_untilを超えないよう上限を
    // かけた時間）を使い、通常観測時（expireAfterMs===null）は従来どおりgraceMsを使う。
    const duration = state.expireAfterMs ?? graceMs;
    const t = setTimeout(() => setState((s) => (s.expired ? s : { ...s, expired: true })), duration);
    return () => clearTimeout(t);
  }, [activeAnswer, state.answerId, state.expired, state.expireAfterMs, graceMs]);

  if (activeAnswer) return activeAnswer;
  if (state.expired || !state.answerId) return null;
  return turnAnswers.find((a) => a.id === state.answerId) ?? null;
}
