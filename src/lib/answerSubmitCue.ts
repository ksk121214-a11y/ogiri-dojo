// 回答busyサイクル（answering_cues.busyのfalse/null→true→false）の「立ち上がり」だけを
// cueIdの変化として扱うための純粋なステートマシン。
//
// 背景（実機で確認済みの不具合）：answering_cues.revisionは、回答送信時だけでなく
// フリップ表示（answers.revealed_atの更新）・採点確定（answers.resolvedの更新）のたびにも
// DB側で増える（supabase/migrations/0063_p1_topic_and_answer_reveal_scope.sqlの
// recompute_answering_cue_for_turn参照）。busyがtrueのまま変わるrevisionをそのままcueIdへ
// 使うと、フリップ表示時にもcueIdが変わってしまい、共通Presentation側のsfxCueTracker.once()
// （src/lib/cuePlayback.ts）がこれを「新しい合図」と見なして、同じanswerSubmit音を二重に鳴らす。
//
// 立ち上がり（false/null→true）の瞬間だけ新しいcueIdを発行し、busyがtrueの間は同じcueIdを
// 使い続けることで、1回の回答busyサイクル全体に対して正しく「1回だけ再生」を保証する。
export interface AnswerCueState {
  wasBusy: boolean;
  cueId: string | null;
}

// 途中リロードで、すでにbusy=trueの状態からマウントした場合は「立ち上がり」と誤検知しない
// （cueIdを発行しない＝そのサイクルの残りでは回答音を鳴らさない）よう、マウント時点のbusyを
// そのままwasBusyの初期値として引き継ぐ。
export function initialAnswerCueState(busyNow: boolean): AnswerCueState {
  return { wasBusy: busyNow, cueId: null };
}

export function nextAnswerCueState(
  prev: AnswerCueState,
  busyNow: boolean,
  cueTurnId: string | null,
  cueRevision: number | null,
): AnswerCueState {
  if (busyNow && !prev.wasBusy && cueTurnId) {
    return { wasBusy: true, cueId: `${cueTurnId}:${cueRevision ?? 0}` };
  }
  if (!busyNow) {
    return { wasBusy: false, cueId: null };
  }
  // busyがtrueのまま（フリップ表示・採点確定待ち等でrevisionだけ変わった）：
  // cueIdは変えず、同じサイクルであることを保つ。
  return { wasBusy: true, cueId: prev.cueId };
}
