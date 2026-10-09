// ステージング実機テストで見つかった不具合（回答音がフリップ表示時にも重複して鳴る）の修正検証。
// answering_cues.revisionはフリップ表示・採点確定のたびにも増えるため、busyがtrueのまま
// 変わるrevisionをそのままcueIdにすると、フリップ表示時に同じanswerSubmit音が二重に鳴って
// しまう。立ち上がり（false/null→true）の瞬間だけ新しいcueIdを発行する純粋ステートマシン
// （src/lib/answerSubmitCue.ts）が、要求された状態遷移どおりに動くことを検証する。
import assert from "node:assert/strict";

import { initialAnswerCueState, nextAnswerCueState, type AnswerCueState } from "../answerSubmitCue";

const TURN_A = "turn-aaa";

function main() {
  // ---- 必須テスト（タスク本文で明示された状態遷移）----
  // false revision1 → true revision2(1回目) → true revision3(フリップ、増えず1回) →
  // false revision4 → true revision5(2回目、合計2回)
  {
    const playedCueIds: string[] = [];
    let state: AnswerCueState = initialAnswerCueState(false);

    const step = (busy: boolean, revision: number) => {
      const prevCueId = state.cueId;
      state = nextAnswerCueState(state, busy, TURN_A, revision);
      const effectiveCueId = busy && state.cueId ? state.cueId : null;
      // sfxCueTrackerと同じ「cueIdが変われば1回だけ鳴らす」をここで模擬する。
      if (effectiveCueId && effectiveCueId !== prevCueId && !playedCueIds.includes(effectiveCueId)) {
        playedCueIds.push(effectiveCueId);
      }
    };

    step(false, 1);
    assert.equal(playedCueIds.length, 0, "false revision1で鳴ってしまっている");

    step(true, 2);
    assert.equal(playedCueIds.length, 1, "true revision2(回答到着)で1回鳴っていない");
    const firstCueId = playedCueIds[0];

    step(true, 3);
    assert.equal(playedCueIds.length, 1, "true revision3(フリップ表示)で増えてしまっている（二重再生）");
    assert.equal(state.cueId, firstCueId, "busyがtrueのままrevisionだけ変わったのにcueIdが変わっている");

    step(false, 4);
    assert.equal(playedCueIds.length, 1, "false revision4(busy終了)で鳴ってしまっている");
    assert.equal(state.cueId, null, "busy=falseになってもcueIdが残っている");

    step(true, 5);
    assert.equal(playedCueIds.length, 2, "true revision5(次の回答)で2回目が鳴っていない");
    assert.notEqual(playedCueIds[1], firstCueId, "次の回答のcueIdが前回と同じになっている");

    console.log(
      "PASS: 必須テストの状態遷移（false rev1 / true rev2:1回 / true rev3:フリップで増えず / false rev4 / true rev5:2回目）どおりに動く",
    );
  }

  // ---- 途中リロード：すでにbusy=trueの状態からマウントした場合は鳴らさない ----
  {
    let state: AnswerCueState = initialAnswerCueState(true); // マウント時点で既にbusy=true（フリップ表示済みかもしれない）
    state = nextAnswerCueState(state, true, TURN_A, 7); // 同じサイクル内でrevisionだけ変わる
    assert.equal(state.cueId, null, "途中リロードでbusy=trueの状態からマウントしたのに回答音を鳴らすcueIdが発行されている");

    // そのサイクルが終わり、次の新しい回答では正しく鳴る。
    state = nextAnswerCueState(state, false, TURN_A, 8);
    assert.equal(state.cueId, null);
    state = nextAnswerCueState(state, true, TURN_A, 9);
    assert.ok(state.cueId, "途中リロード後の次の新しい回答で、回答音のcueIdが発行されていない");
    console.log("PASS: 途中リロードで既にbusy=trueの状態からマウントした場合は回答音を再生せず、次の新しい回答からは正しく鳴る");
  }

  // ---- 同じプレイヤーが次の周で回答しても、新しいサイクルとして1回鳴る（turnIdが変わるケース） ----
  {
    const TURN_B = "turn-bbb";
    let state: AnswerCueState = initialAnswerCueState(false);
    state = nextAnswerCueState(state, true, TURN_A, 2);
    const firstCueId = state.cueId;
    state = nextAnswerCueState(state, false, TURN_A, 3);
    state = nextAnswerCueState(state, true, TURN_B, 2); // 次の周：turn_idが変わり、revisionはターン内で振り直されている想定
    assert.ok(state.cueId && state.cueId !== firstCueId, "次の周の回答で新しいcueIdが発行されていない");
    console.log("PASS: 次の周の回答（turn_idが変わる）でも、新しいサイクルとして正しく新しいcueIdが発行される");
  }

  // ---- turnIdが無い（currentTurnがまだ無い）場合はcueIdを発行しない ----
  {
    let state: AnswerCueState = initialAnswerCueState(false);
    state = nextAnswerCueState(state, true, null, 2);
    assert.equal(state.cueId, null, "currentTurnが無いのにcueIdが発行されている");
    console.log("PASS: turnIdが無い場合はcueIdを発行しない");
  }

  console.log("ALL ANSWER_SUBMIT_CUE CHECKS PASSED");
}

main();
