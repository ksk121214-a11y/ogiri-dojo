// src/lib/liveHostSnapshots.ts の純粋関数＋非同期並行制御の検証スクリプト。
// 実行方法は src/lib/__tests__/run.sh 参照。
// 遅延Promiseで「古い取得R1が新しい取得R2の後に完了する」等の非同期順序を再現する。
import assert from "node:assert/strict";

import {
  answersSnapshotMatches,
  childrenSnapshotReady,
  createSliceGate,
  loadSnapshotSlice,
  shouldReleaseInitInFlight,
  shouldRetryNow,
} from "../liveHostSnapshots";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {

// ========== createSliceGate ==========
{
  const gate = createSliceGate();
  const t1 = gate.begin();
  const t2 = gate.begin();
  assert.equal(gate.isCurrent(t1), false, "後から begin された t2 がある以上 t1 は最新でない");
  assert.equal(gate.isCurrent(t2), true);
  assert.equal(gate.current(), 2);
  const t3 = gate.begin();
  assert.equal(gate.isCurrent(t2), false);
  assert.equal(gate.isCurrent(t3), true);
  console.log("PASS: gate（後から begin されたら古いトークンは isCurrent=false）");
}

// ========== childrenSnapshotReady / answersSnapshotMatches ==========
{
  assert.equal(childrenSnapshotReady("L1", "L1"), true);
  assert.equal(childrenSnapshotReady("L1", "L2"), false);
  assert.equal(childrenSnapshotReady(null, "L1"), false);
  assert.equal(childrenSnapshotReady("L1", null), false);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T1"), true);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T2"), false);
  assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L2", "T1"), false);
  assert.equal(answersSnapshotMatches(null, "L1", "T1"), false);
  console.log("PASS: childrenSnapshotReady / answersSnapshotMatches");
}

// ========== shouldRetryNow ==========
{
  assert.equal(shouldRetryNow(false, 0, 5000, 2000), true, "非in-flightかつ間隔経過→再試行OK");
  assert.equal(shouldRetryNow(true, 0, 5000, 2000), false, "in-flight中は再試行しない");
  assert.equal(shouldRetryNow(false, 4000, 5000, 2000), false, "前回から2秒未満は再試行しない");
  assert.equal(shouldRetryNow(false, 3000, 5000, 2000), true, "前回からちょうど2秒で再試行OK");
  console.log("PASS: shouldRetryNow（single-flight＋最小間隔）");
}

// ========== loadSnapshotSlice：非同期順序の再現 ==========

// 必須テスト1：同じターンのanswers再取得失敗時、表示データは維持されるが確認状態は未確認になる。
{
  const gate = createSliceGate();
  let displayed = ["existing-answer"]; // 画面表示用（空にしてはいけない）
  let snapshot: { liveId: string; turnId: string } | null = { liveId: "L1", turnId: "T1" };
  const outcome = await loadSnapshotSlice<string[]>({
    gate,
    fetch: async () => {
      await delay(5);
      return { ok: false, data: [] }; // 取得失敗
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      displayed = d;
    },
    markUnconfirmed: () => {
      snapshot = null;
    },
  });
  assert.equal(outcome, "unconfirmed");
  assert.deepEqual(displayed, ["existing-answer"], "取得失敗時、表示データは維持される");
  assert.equal(snapshot, null, "取得失敗時、確認状態は未確認へ戻る");
  console.log("PASS: async-1（同じターンの取得失敗：表示は維持、確認状態は未確認）");
}

// 必須テスト6：古いanswers取得R1が、新しい取得R2より後に完了してもR2を上書きしない。
{
  const gate = createSliceGate();
  let state = "initial";
  // R1（遅い・50ms）
  const r1 = loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(50);
      return { ok: true, data: "R1-value" };
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      state = d;
    },
    markUnconfirmed: () => {},
  });
  await delay(5);
  // R2（速い・10ms、R1の後に開始）
  const r2 = loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(10);
      return { ok: true, data: "R2-value" };
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      state = d;
    },
    markUnconfirmed: () => {},
  });
  const [o1, o2] = await Promise.all([r1, r2]);
  assert.equal(o2, "applied");
  assert.equal(o1, "superseded", "後から開始したR2がある以上、R1は superseded");
  assert.equal(state, "R2-value", "古いR1の完了結果が新しいR2を巻き戻さない");
  console.log("PASS: async-6（古い取得R1が新しいR2を上書きしない）");
}

// 必須テスト6b：R1が失敗、R2が成功。R1完了時に markUnconfirmed してはいけない（superseded）。
{
  const gate = createSliceGate();
  let snapshot: string | null = "confirmed";
  const r1 = loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(50);
      return { ok: false, data: "" };
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      snapshot = d;
    },
    markUnconfirmed: () => {
      snapshot = null;
    },
  });
  await delay(5);
  const r2 = loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(10);
      return { ok: true, data: "R2-confirmed" };
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      snapshot = d;
    },
    markUnconfirmed: () => {
      snapshot = null;
    },
  });
  await Promise.all([r1, r2]);
  assert.equal(snapshot, "R2-confirmed", "遅れて失敗したR1が、成功したR2の確認済み状態を未確認へ戻さない");
  console.log("PASS: async-6b（遅れて失敗した古い取得は、新しい成功結果を未確認化しない）");
}

// 必須テスト9：取得中に対象（ターン）が切り替わったら、その結果は今の対象に適用しない。
{
  const gate = createSliceGate();
  let currentTurn = "T1";
  let applied: string | null = null;
  const outcome = await loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(10);
      currentTurn = "T2"; // 取得中にターンが進んだ
      return { ok: true, data: "T1-answers" };
    },
    stillCurrent: () => currentTurn === "T1",
    applyFresh: (d) => {
      applied = d;
    },
    markUnconfirmed: () => {},
  });
  assert.equal(outcome, "target-changed");
  assert.equal(applied, null, "取得中にターンが変わったら、その結果を今のターンへ適用しない");
  console.log("PASS: async-9（取得中の対象切り替え：古い対象の結果を適用しない）");
}

// 必須テスト10：stop相当（gate.begin()）の後に古い取得が完了しても state を復活させない。
{
  const gate = createSliceGate();
  let state = "before-stop";
  const inFlight = loadSnapshotSlice<string>({
    gate,
    fetch: async () => {
      await delay(30);
      return { ok: true, data: "old-result" };
    },
    stillCurrent: () => true,
    applyFresh: (d) => {
      state = d;
    },
    markUnconfirmed: () => {
      state = "unconfirmed";
    },
  });
  await delay(5);
  gate.begin(); // stopHostProgress 相当：進行中トークンを無効化
  const outcome = await inFlight;
  assert.equal(outcome, "superseded");
  assert.equal(state, "before-stop", "stop後に古い取得が完了しても state を書き換えない");
  console.log("PASS: async-10（stop後の古い取得完了は state を復活させない）");
}

// 必須テスト11：通信回復後はデッドロックせず反映される（超えていないトークンなら applied）。
{
  const gate = createSliceGate();
  let state = "stale";
  // 1回目：失敗
  await loadSnapshotSlice<string>({
    gate,
    fetch: async () => ({ ok: false, data: "" }),
    stillCurrent: () => true,
    applyFresh: (d) => {
      state = d;
    },
    markUnconfirmed: () => {
      state = "unconfirmed";
    },
  });
  assert.equal(state, "unconfirmed");
  // 2回目：回復
  const outcome = await loadSnapshotSlice<string>({
    gate,
    fetch: async () => ({ ok: true, data: "recovered" }),
    stillCurrent: () => true,
    applyFresh: (d) => {
      state = d;
    },
    markUnconfirmed: () => {},
  });
  assert.equal(outcome, "applied");
  assert.equal(state, "recovered", "通信回復後は正常に反映される（デッドロックしない）");
  console.log("PASS: async-11（通信回復後はデッドロックせず反映）");
}

// ========== shouldReleaseInitInFlight ==========
{
  const a = Symbol("A");
  const b = Symbol("B");
  assert.equal(shouldReleaseInitInFlight<symbol | null>(b, a), false, "旧initのfinallyは新init(B)を消さない");
  assert.equal(shouldReleaseInitInFlight<symbol | null>(a, a), true, "自分が現行なら解放してよい");
  assert.equal(shouldReleaseInitInFlight<symbol | null>(null, a), false);
  console.log("PASS: shouldReleaseInitInFlight");
}

  console.log("ALL LIVE_HOST_SNAPSHOTS CHECKS PASSED");
}

void main();
