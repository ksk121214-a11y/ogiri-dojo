// resolveAnsweringCue()（src/lib/answeringCue.ts）の新旧revision判定を検証する
// スクリプト。このリポジトリには自動テストランナー(vitest/jest等)が導入されて
// いないため、supabase/tests/run.sh（psqlだけで完結する代替手段）と同じ考え方で、
// tscでコンパイルしてnodeで直接実行できる形にしてある。
//
// 実行方法：src/lib/__tests__/run.sh 参照（npm scriptは追加していない）。
import assert from "node:assert/strict";

import { resolveAnsweringCue, type AnsweringCueSnapshot } from "../answeringCue";

const LIVE_A = "11111111-1111-1111-1111-111111111111";
const LIVE_B = "22222222-2222-2222-2222-222222222222";

function cue(overrides: Partial<AnsweringCueSnapshot>): AnsweringCueSnapshot {
  return {
    liveId: LIVE_A,
    turnId: "turn-1",
    pendingParticipantId: null,
    busy: false,
    revision: 1,
    ...overrides,
  };
}

// シナリオ1：revision1の取得開始 → revision2のRealtime受信（先に反映） →
// 遅れてrevision1の取得完了 → 最終stateはrevision2のまま。
{
  let state: AnsweringCueSnapshot | null = null;
  // revision2のRealtimeイベントが先に届いて反映される。
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 2, busy: true, pendingParticipantId: "p1" }));
  assert.equal(state?.revision, 2);
  // 遅れてrevision1の再取得結果が届く（本来はrevision2より前に開始したリクエスト）。
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 1, busy: false, pendingParticipantId: null }));
  assert.equal(state?.revision, 2, "古いrevision1で上書きされてはいけない");
  assert.equal(state?.busy, true, "revision2のbusy状態が保たれるべき");
  console.log("PASS: シナリオ1（新→旧の順で届いても新しい方が残る＝古い取得結果が新しいRealtimeを上書きしない）");
}

// シナリオ2（逆順）：revision2の再取得完了 → 遅れてrevision1のRealtime受信 →
// revision1を無視する。
{
  let state: AnsweringCueSnapshot | null = null;
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 2 }));
  assert.equal(state?.revision, 2);
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 1 }));
  assert.equal(state?.revision, 2, "遅れて届いたrevision1のRealtimeイベントは無視されるべき");
  console.log("PASS: シナリオ2（取得→Realtimeの順でも、遅延した古いRealtimeイベントは無視される）");
}

// シナリオ3：別ライブへ切り替わった場合、前ライブの大きなrevisionに邪魔されず
// 新ライブの値を採用できる。
{
  let state: AnsweringCueSnapshot | null = cue({ liveId: LIVE_A, revision: 999 });
  state = resolveAnsweringCue(state, LIVE_B, cue({ liveId: LIVE_B, revision: 1 }));
  assert.equal(state?.liveId, LIVE_B);
  assert.equal(state?.revision, 1, "別ライブへの切り替えはrevisionの大小に関係なく採用されるべき");
  console.log("PASS: シナリオ3（別ライブへの切り替えは、前ライブの大きなrevisionに邪魔されない）");
}

// シナリオ4：同じライブでcueがnull（該当行が無い）と分かった場合はクリアする。
{
  let state: AnsweringCueSnapshot | null = cue({ revision: 10 });
  state = resolveAnsweringCue(state, LIVE_A, null);
  assert.equal(state, null, "同じライブでcueが無いと分かればクリアされるべき");
  console.log("PASS: シナリオ4（同じライブでcueが無いと分かればクリアされる）");
}

// シナリオ5：同一ライブ内でターンが変わってもrevisionが単調増加していれば
// 正しく最新側が採用される（0063のrecompute_answering_cue_for_turnは、
// ターンが変わっても同じ行(PK=live_id)のrevisionを+1し続ける設計）。
{
  let state: AnsweringCueSnapshot | null = cue({ turnId: "turn-1", revision: 5 });
  state = resolveAnsweringCue(state, LIVE_A, cue({ turnId: "turn-2", revision: 6 }));
  assert.equal(state?.turnId, "turn-2");
  assert.equal(state?.revision, 6);
  console.log("PASS: シナリオ5（同一ライブ内でターンが変わってもrevisionの新しい方が採用される）");
}

// シナリオ6：currentが無い（初回取得・初回Realtime受信）場合は常に採用する。
{
  const state = resolveAnsweringCue(null, LIVE_A, cue({ revision: 1 }));
  assert.equal(state?.revision, 1);
  console.log("PASS: シナリオ6（初回は常に採用される）");
}

// シナリオ7：回答送信音の誤判定防止（要件7）の裏付け。「busy:false→true」の
// 遷移を音の再生トリガーとして使う場合でも、遅延した古いRealtimeイベントが
// busy=falseの状態を運んできても、resolveAnsweringCueの時点で無視されるため
// busy自体が見かけ上falseへ戻ることが無い（＝誤ってもう一度trueへ遷移したと
// 誤判定されない）ことを確認する。
{
  let state: AnsweringCueSnapshot | null = null;
  // 回答A送信：busy false→true（revision2）。ここで送信音が鳴る想定。
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 2, busy: true, pendingParticipantId: "p1" }));
  assert.equal(state?.busy, true);
  // 遅延した「送信直前(busy=false, revision1)」のRealtimeイベントが今頃届く。
  state = resolveAnsweringCue(state, LIVE_A, cue({ revision: 1, busy: false, pendingParticipantId: null }));
  assert.equal(state?.busy, true, "古いrevisionのbusy=falseで見かけ上falseへ戻ってはいけない");
  console.log("PASS: シナリオ7（遅延した古いRealtimeイベントでbusyが見かけ上falseへ戻らない＝送信音の誤再生を防げる）");
}

console.log("ALL ANSWERING_CUE ORDERING CHECKS PASSED");
