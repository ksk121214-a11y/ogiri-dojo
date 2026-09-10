// src/lib/liveHostSnapshots.ts の純粋関数の検証スクリプト。
// 実行方法は src/lib/__tests__/run.sh 参照。
import assert from "node:assert/strict";

import {
  answersSnapshotMatches,
  childrenSnapshotReady,
  resolveAnswersSnapshot,
  resolveChildrenSnapshot,
  shouldReleaseInitInFlight,
} from "../liveHostSnapshots";

interface Children {
  turns: string[];
  groups: string[];
}
const EMPTY: Children = { turns: [], groups: [] };

// ========== resolveChildrenSnapshot ==========

// 1: 取得成功 → 新データを採用し、そのliveIdについてready。
{
  const r = resolveChildrenSnapshot<Children>({
    fetchOk: true,
    freshChildren: { turns: ["t1"], groups: ["g1"] },
    targetLiveId: "L1",
    prevChildren: { turns: ["old"], groups: [] },
    prevSnapshotLiveId: "L1",
    emptyChildren: EMPTY,
  });
  assert.deepEqual(r.children, { turns: ["t1"], groups: ["g1"] });
  assert.equal(r.snapshotLiveId, "L1");
  console.log("PASS: children-1（取得成功で新データ採用・ready）");
}

// 2（必須テスト1相当）: 同じライブで取得失敗 → 既存turns/groupsを空にしない。
{
  const r = resolveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: EMPTY,
    targetLiveId: "L1",
    prevChildren: { turns: ["t1", "t2"], groups: ["g1"] },
    prevSnapshotLiveId: "L1",
    emptyChildren: EMPTY,
  });
  assert.deepEqual(r.children, { turns: ["t1", "t2"], groups: ["g1"] });
  assert.equal(r.snapshotLiveId, "L1");
  console.log("PASS: children-2（同じライブの取得失敗は既存turns/groupsを維持）");
}

// 3（必須テスト8・9相当）: 別ライブで取得失敗 → 前ライブのデータを流用せず空・未確認。
{
  const r = resolveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: EMPTY,
    targetLiveId: "L2",
    prevChildren: { turns: ["from-L1"], groups: ["g-L1"] },
    prevSnapshotLiveId: "L1",
    emptyChildren: EMPTY,
  });
  assert.deepEqual(r.children, EMPTY);
  assert.equal(r.snapshotLiveId, null);
  console.log("PASS: children-3（別ライブの取得失敗は前ライブのデータを流用しない）");
}

// 4: 一度も確認できていない（prevSnapshotLiveId=null）まま取得失敗 → 未確認のまま。
{
  const r = resolveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: EMPTY,
    targetLiveId: "L1",
    prevChildren: EMPTY,
    prevSnapshotLiveId: null,
    emptyChildren: EMPTY,
  });
  assert.equal(r.snapshotLiveId, null);
  console.log("PASS: children-4（初回取得失敗中は未確認のまま＝自動進行しない）");
}

// childrenSnapshotReady
{
  assert.equal(childrenSnapshotReady("L1", "L1"), true);
  assert.equal(childrenSnapshotReady("L1", "L2"), false);
  assert.equal(childrenSnapshotReady(null, "L1"), false);
  assert.equal(childrenSnapshotReady("L1", null), false);
  assert.equal(childrenSnapshotReady("L1", undefined), false);
  console.log("PASS: childrenSnapshotReady（liveId一致時のみtrue）");
}

// ========== resolveAnswersSnapshot ==========
type Answers = string[];

// 5: 取得成功 → 新データを書き込み、(liveId,turnId)について確認済み。
{
  const r = resolveAnswersSnapshot<Answers>({
    fetchOk: true,
    freshAnswers: ["a1", "a2"],
    targetLiveId: "L1",
    targetTurnId: "T1",
    prevAnswers: ["old"],
    prevSnapshot: null,
    emptyAnswers: [],
  });
  assert.equal(r.writeAnswers, true);
  assert.deepEqual(r.answers, ["a1", "a2"]);
  assert.deepEqual(r.snapshot, { liveId: "L1", turnId: "T1" });
  console.log("PASS: answers-5（取得成功で新データ書き込み・確認済み）");
}

// 6（必須テスト1の核心）: 同じ(liveId,turnId)で取得失敗 → answersを書き込まない
// （＝既存の未確定回答を空で潰さない）、確認済みは維持。
{
  const r = resolveAnswersSnapshot<Answers>({
    fetchOk: false,
    freshAnswers: [],
    targetLiveId: "L1",
    targetTurnId: "T1",
    prevAnswers: ["unresolved-answer"],
    prevSnapshot: { liveId: "L1", turnId: "T1" },
    emptyAnswers: [],
  });
  assert.equal(r.writeAnswers, false);
  assert.deepEqual(r.snapshot, { liveId: "L1", turnId: "T1" });
  console.log("PASS: answers-6（同じターンの取得失敗はanswersを書き込まない・確認済み維持）");
}

// 7（必須テスト4の核心）: 別ターンで取得失敗 → answersを書き込まず、未確認に戻す。
{
  const r = resolveAnswersSnapshot<Answers>({
    fetchOk: false,
    freshAnswers: [],
    targetLiveId: "L1",
    targetTurnId: "T2",
    prevAnswers: ["answers-of-T1"],
    prevSnapshot: { liveId: "L1", turnId: "T1" },
    emptyAnswers: [],
  });
  assert.equal(r.writeAnswers, false);
  assert.equal(r.snapshot, null);
  console.log("PASS: answers-7（別ターンの取得失敗は未確認に戻す＝古いターンで進行しない）");
}

// 8: 別ライブで取得失敗 → 未確認に戻す。
{
  const r = resolveAnswersSnapshot<Answers>({
    fetchOk: false,
    freshAnswers: [],
    targetLiveId: "L2",
    targetTurnId: "T1",
    prevAnswers: ["answers-of-L1"],
    prevSnapshot: { liveId: "L1", turnId: "T1" },
    emptyAnswers: [],
  });
  assert.equal(r.writeAnswers, false);
  assert.equal(r.snapshot, null);
  console.log("PASS: answers-8（別ライブの取得失敗は未確認に戻す）");
}

// answersSnapshotMatches
{
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T1"), true);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T2"), false);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L2", "T1"), false);
  assert.equal(answersSnapshotMatches(null, "L1", "T1"), false);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", null), false);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, null, "T1"), false);
  console.log("PASS: answersSnapshotMatches（liveId・turnId両方一致時のみtrue）");
}

// ========== shouldReleaseInitInFlight ==========
// 必須テスト10: stop中の旧init Aが終了しても、新init BのinitInFlightをnullにしない。
{
  const promiseA = Symbol("A");
  const promiseB = Symbol("B");
  // Aが実行中→stopでinitInFlight=null→Bが開始しinitInFlight=B、の後にAのfinallyが走る想定。
  assert.equal(shouldReleaseInitInFlight<symbol | null>(promiseB, promiseA), false);
  console.log("PASS: initInFlight-10（旧initのfinallyは新initのinitInFlightを消さない）");
}
// 自分が今もinitInFlightなら片付けてよい。
{
  const promiseA = Symbol("A");
  assert.equal(shouldReleaseInitInFlight<symbol | null>(promiseA, promiseA), true);
  assert.equal(shouldReleaseInitInFlight<symbol | null>(null, promiseA), false);
  console.log("PASS: initInFlight（自分が現行のときだけ解放）");
}

console.log("ALL LIVE_HOST_SNAPSHOTS CHECKS PASSED");
