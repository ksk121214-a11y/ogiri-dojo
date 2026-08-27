"use client";

import { useEffect, useState } from "react";

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
): T | null {
  const [lastAnswerId, setLastAnswerId] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // レンダー中にstateを更新する（Reactが公式に認めている「前回のpropsから派生した
  // stateを持つ」パターン）。以前はこの更新をuseEffect内でだけ行っていたため、
  // activeAnswerがnullになった「まさにその回のレンダー」ではまだ古いIDしか
  // 参照できず、一瞬だけdisplayedAnswerがnullになって（＝採点ボードのroundKeyも
  // 一瞬nullに変わって）ボールが弾ける演出を再生する前に消えてしまうバグがあった。
  if (activeAnswer && activeAnswer.id !== lastAnswerId) {
    setLastAnswerId(activeAnswer.id);
    setExpired(false);
  }

  useEffect(() => {
    if (activeAnswer || !lastAnswerId || expired) return;
    const t = setTimeout(() => setExpired(true), graceMs);
    return () => clearTimeout(t);
  }, [activeAnswer, lastAnswerId, expired, graceMs]);

  if (activeAnswer) return activeAnswer;
  if (expired || !lastAnswerId) return null;
  return turnAnswers.find((a) => a.id === lastAnswerId) ?? null;
}
