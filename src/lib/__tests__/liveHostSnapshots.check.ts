// src/lib/liveHostSnapshots.ts の純粋関数＋非同期並行制御の検証スクリプト。
// 実行方法は src/lib/__tests__/run.sh 参照。
// 遅延Promiseで「古い取得R1が新しい取得R2の後に完了する」「取得を開始した時点で
// 未確認になる」「復旧途中でstopされる」等の非同期順序を再現する。
import assert from "node:assert/strict";

import {
  answersSnapshotMatches,
  childrenSnapshotReady,
  createSliceGate,
  hydrateAfterLive,
  loadSnapshotSlice,
  scoresSnapshotMatches,
  shouldReleaseInitInFlight,
  shouldReleaseRetryFlag,
  shouldRetryNow,
  type HostHydrationDeps,
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

  // ========== childrenSnapshotReady / answersSnapshotMatches / scoresSnapshotMatches ==========
  {
    assert.equal(childrenSnapshotReady("L1", "L1"), true);
    assert.equal(childrenSnapshotReady("L1", "L2"), false);
    assert.equal(childrenSnapshotReady(null, "L1"), false);
    assert.equal(childrenSnapshotReady("L1", null), false);

    assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T1"), true);
    assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T2"), false);
    assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L2", "T1"), false);
    assert.equal(answersSnapshotMatches(null, "L1", "T1"), false);

    const sk = { liveId: "L1", turnId: "T1", answerId: "A1" };
    assert.equal(scoresSnapshotMatches(sk, "L1", "T1", "A1"), true);
    assert.equal(scoresSnapshotMatches(sk, "L1", "T1", "A2"), false, "表示中の回答が変われば不一致");
    assert.equal(scoresSnapshotMatches(sk, "L1", "T2", "A1"), false);
    assert.equal(scoresSnapshotMatches(sk, "L2", "T1", "A1"), false);
    assert.equal(scoresSnapshotMatches(null, "L1", "T1", "A1"), false);
    assert.equal(scoresSnapshotMatches(sk, "L1", "T1", null), false);
    console.log("PASS: childrenSnapshotReady / answersSnapshotMatches / scoresSnapshotMatches");
  }

  // ========== shouldRetryNow ==========
  {
    assert.equal(shouldRetryNow(false, 0, 5000, 2000), true, "非in-flightかつ間隔経過→再試行OK");
    assert.equal(shouldRetryNow(true, 0, 5000, 2000), false, "in-flight中は再試行しない");
    assert.equal(shouldRetryNow(false, 4000, 5000, 2000), false, "前回から2秒未満は再試行しない");
    assert.equal(shouldRetryNow(false, 3000, 5000, 2000), true, "前回からちょうど2秒で再試行OK");
    console.log("PASS: shouldRetryNow（single-flight＋最小間隔）");
  }

  // ========== shouldReleaseRetryFlag（P2-2：retry所有権）==========
  {
    // retry A は世代0で開始 → stopHostProgress で世代1へ → stop後 retry B が世代1で開始。
    assert.equal(
      shouldReleaseRetryFlag(1, 0),
      false,
      "stop前の古いretry(世代0)のfinallyは、現行世代(1)のretryフラグを解除しない",
    );
    assert.equal(shouldReleaseRetryFlag(1, 1), true, "現行世代のretryは自分のフラグを解除してよい");
    assert.equal(shouldReleaseRetryFlag(0, 0), true);
    console.log("PASS: shouldReleaseRetryFlag（stop前の古いretryが新しいretryの所有権を解除しない）");
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

  // ========== loadSnapshotSlice：非同期順序の再現 ==========

  // 必須テスト7（＋既存の安全側期待値）：同じターンの再取得失敗時、表示データは
  // 維持されるが確認状態は未確認になる。
  {
    const gate = createSliceGate();
    let displayed = ["existing-answer"];
    let snapshot: { liveId: string; turnId: string } | null = { liveId: "L1", turnId: "T1" };
    const outcome = await loadSnapshotSlice<string[]>({
      gate,
      fetch: async () => {
        await delay(5);
        return { ok: false, data: [] };
      },
      stillCurrent: () => true,
      markPending: () => {
        snapshot = null;
      },
      applyFresh: (d) => {
        displayed = d;
      },
      markUnconfirmed: () => {
        snapshot = null;
      },
    });
    assert.equal(outcome, "unconfirmed");
    assert.deepEqual(displayed, ["existing-answer"], "取得失敗時、表示データは維持される（空配列で消さない）");
    assert.equal(snapshot, null, "取得失敗時、確認状態は未確認へ戻る");
    console.log("PASS: async-1/7（取得失敗：表示は維持、確認状態は未確認）");
  }

  // 必須テスト8：Realtime変更検知で「取得を開始した」時点で、対象スライスは同期中
  // （未確認）になる。fetchの完了を待たずに確認状態が落ちる。
  {
    const gate = createSliceGate();
    let confirmed = true;
    const p = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(30);
        return { ok: true, data: "fresh" };
      },
      stillCurrent: () => true,
      markPending: () => {
        confirmed = false;
      },
      applyFresh: () => {
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    await delay(5);
    assert.equal(confirmed, false, "取得開始(markPending)時点で、fetch完了前でも確認状態は未確認");
    await p;
    assert.equal(confirmed, true, "取得成功で確認済みへ戻る");
    console.log("PASS: async-8（再取得の開始時点で同期中／未確認になる）");
  }

  // 必須テスト9：同期中（markPendingで未確認の間）は advanceIfDue 相当のDB書き込みを
  // 行わない。取得完了後は通常進行へ戻る。
  {
    const gate = createSliceGate();
    let confirmed = true;
    let dbWrites = 0;
    const tryAdvance = () => {
      if (!confirmed) return; // autoProgressFrozen 相当のガード
      dbWrites += 1;
    };
    const p = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(25);
        return { ok: true, data: "x" };
      },
      stillCurrent: () => true,
      markPending: () => {
        confirmed = false;
      },
      applyFresh: () => {
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    tryAdvance();
    await delay(5);
    tryAdvance();
    await delay(5);
    tryAdvance();
    assert.equal(dbWrites, 0, "同期中はDB書き込み（自動進行）を一切行わない");
    await p;
    tryAdvance();
    assert.equal(dbWrites, 1, "同期完了後は通常進行へ戻る（デッドロックしない）");
    console.log("PASS: async-9（同期中は自動DB書き込みをしない／完了後に復帰）");
  }

  // 必須テスト5：古い取得R1が、新しい取得R2より後に完了してもR2を上書きしない
  // （scores/live/children/answers 共通の仕組み）。
  {
    const gate = createSliceGate();
    let state = "initial";
    const r1 = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(50);
        return { ok: true, data: "R1-scores" };
      },
      stillCurrent: () => true,
      applyFresh: (d) => {
        state = d;
      },
      markUnconfirmed: () => {},
    });
    await delay(5);
    const r2 = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(10);
        return { ok: true, data: "R2-scores" };
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
    assert.equal(state, "R2-scores", "古いR1の完了結果が新しいR2を巻き戻さない");
    console.log("PASS: async-5（古い取得R1が新しいR2を上書きしない）");
  }

  // 必須テスト10：markPend中の古いR1が失敗しても、成功したR2の確認済み状態を
  // 未確認へ戻さない（古い処理が新しい確認済み状態を壊さない）。
  {
    const gate = createSliceGate();
    let confirmed = true;
    let displayed = "old";
    const r1 = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(50);
        return { ok: false, data: "" };
      },
      stillCurrent: () => true,
      markPending: () => {
        confirmed = false;
      },
      applyFresh: (d) => {
        displayed = d;
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    await delay(5);
    const r2 = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(10);
        return { ok: true, data: "new" };
      },
      stillCurrent: () => true,
      markPending: () => {
        confirmed = false;
      },
      applyFresh: (d) => {
        displayed = d;
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    const [o1, o2] = await Promise.all([r1, r2]);
    assert.equal(o2, "applied");
    assert.equal(o1, "superseded");
    assert.equal(confirmed, true, "遅れて失敗したR1が、成功したR2の確認済みを未確認へ戻さない");
    assert.equal(displayed, "new");
    console.log("PASS: async-10（古い取得の完了が新しい確認済み状態を未確認へ戻さない）");
  }

  // 必須テスト6：回答Aのscores取得中に回答Bへ切り替わったら、Aの結果をBへ反映しない。
  {
    const gate = createSliceGate();
    let currentAnswerId = "A";
    let applied: string | null = null;
    const outcome = await loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(10);
        currentAnswerId = "B"; // 取得中に表示中の回答が変わった
        return { ok: true, data: "A-scores" };
      },
      stillCurrent: () => currentAnswerId === "A",
      applyFresh: (d) => {
        applied = d;
      },
      markUnconfirmed: () => {},
    });
    assert.equal(outcome, "target-changed");
    assert.equal(applied, null, "回答Aのscores取得中に回答Bへ切り替わったら、Aの結果を反映しない");
    console.log("PASS: async-6（回答切り替え中の古いscores結果を適用しない）");
  }

  // 既存の必須：stop相当（gate.begin()）の後に古い取得が完了しても state を復活させない。
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
    console.log("PASS: async-stop（stop後の古い取得完了は state を復活させない）");
  }

  // 必須テスト12：通信回復後はデッドロックせず反映される。
  {
    const gate = createSliceGate();
    let state = "stale";
    await loadSnapshotSlice<string>({
      gate,
      fetch: async () => ({ ok: false, data: "" }),
      stillCurrent: () => true,
      markPending: () => {
        state = "unconfirmed";
      },
      applyFresh: (d) => {
        state = d;
      },
      markUnconfirmed: () => {
        state = "unconfirmed";
      },
    });
    assert.equal(state, "unconfirmed");
    const outcome = await loadSnapshotSlice<string>({
      gate,
      fetch: async () => ({ ok: true, data: "recovered" }),
      stillCurrent: () => true,
      markPending: () => {
        state = "unconfirmed";
      },
      applyFresh: (d) => {
        state = d;
      },
      markUnconfirmed: () => {},
    });
    assert.equal(outcome, "applied");
    assert.equal(state, "recovered", "通信回復後は正常に反映される（デッドロックしない）");
    console.log("PASS: async-12（通信回復後はデッドロックせず反映）");
  }

  // ========== hydrateAfterLive：復旧オーケストレーションの副作用注入テスト ==========

  type Recorded = { calls: string[]; setGen: (g: number) => void };
  const buildDeps = (
    over: Partial<HostHydrationDeps>,
    rec: Recorded,
    genRef: { g: number },
  ): HostHydrationDeps => ({
    startGeneration: 0,
    currentGeneration: () => genRef.g,
    loadChildren: async () => {
      rec.calls.push("children");
      return { ok: true };
    },
    loadAnswers: async () => {
      rec.calls.push("answers");
      return { ok: true };
    },
    loadResolved: async () => {
      rec.calls.push("resolved");
      return { ok: true };
    },
    loadScores: async () => {
      rec.calls.push("scores");
      return { ok: true };
    },
    restoreAnsweringTimer: () => {
      rec.calls.push("restoreTimer");
    },
    finishLoading: (u: boolean) => {
      rec.calls.push(`finishLoading:${u}`);
    },
    subscribe: () => {
      rec.calls.push("subscribe");
    },
    ...over,
  });

  // 必須テスト1/2/3：live確定後、children→answers→resolved→scoresを全て取得し、
  // ローカルタイマー復元→購読まで完了する（＝完全な初期化処理へ復帰）。
  {
    const genRef = { g: 0 };
    const rec: Recorded = { calls: [], setGen: (g) => (genRef.g = g) };
    const r = await hydrateAfterLive(buildDeps({}, rec, genRef));
    assert.equal(r, "ready");
    assert.deepEqual(
      rec.calls,
      ["children", "answers", "resolved", "scores", "restoreTimer", "finishLoading:false", "subscribe"],
      "children/answers/resolved/scores → タイマー復元 → loading確定 → 購読 の順で完全復旧",
    );
    assert.ok(
      rec.calls.indexOf("restoreTimer") < rec.calls.indexOf("subscribe"),
      "answeringローカル残り時間の復元は購読より前（0秒停止しない）",
    );
    assert.equal(rec.calls.filter((c) => c === "subscribe").length, 1, "購読は1回だけ作成される");
    console.log("PASS: hydrate-1/2/3（live確定後に完全な初期化処理へ復帰し、購読・タイマー復元まで行う）");
  }

  // 必須テスト（一部失敗でも表示は維持しつつ購読は張る／注意文言を出す）
  {
    const genRef = { g: 0 };
    const rec: Recorded = { calls: [], setGen: (g) => (genRef.g = g) };
    const r = await hydrateAfterLive(
      buildDeps({ loadAnswers: async () => ({ ok: false }) }, rec, genRef),
    );
    assert.equal(r, "ready");
    assert.ok(rec.calls.includes("finishLoading:true"), "一部取得失敗なら注意文言（anyUnconfirmed=true）");
    assert.ok(rec.calls.includes("subscribe"), "一部失敗でも購読は張る（後続のRealtime/再試行で追いつく）");
    console.log("PASS: hydrate-partial（一部取得失敗でも購読は張り、注意文言を出す）");
  }

  // 必須テスト4：復旧途中で stopHostProgress された（generationが変わった）場合、
  // 以降のタイマー復元・loading確定・購読を一切行わず "stopped" で戻る。
  {
    const genRef = { g: 0 };
    const rec: Recorded = { calls: [], setGen: (g) => (genRef.g = g) };
    const r = await hydrateAfterLive(
      buildDeps(
        {
          loadChildren: async () => {
            await delay(5);
            genRef.g = 1; // 復旧途中で stopHostProgress 相当
            rec.calls.push("children");
            return { ok: true };
          },
        },
        rec,
        genRef,
      ),
    );
    assert.equal(r, "stopped");
    assert.ok(!rec.calls.includes("subscribe"), "stop後はRealtime購読(channel)を作らない");
    assert.ok(!rec.calls.includes("restoreTimer"), "stop後はローカルタイマーを復元しない");
    assert.ok(!rec.calls.some((c) => c.startsWith("finishLoading")), "stop後はloading/stateを確定しない");
    console.log("PASS: hydrate-4（復旧途中のstop後にtimer・channel・stateが復活しない）");
  }

  // 必須テスト4補：最後のawait（scores）の後にstopされても購読しない。
  {
    const genRef = { g: 0 };
    const rec: Recorded = { calls: [], setGen: (g) => (genRef.g = g) };
    const r = await hydrateAfterLive(
      buildDeps(
        {
          loadScores: async () => {
            await delay(5);
            genRef.g = 1;
            rec.calls.push("scores");
            return { ok: true };
          },
        },
        rec,
        genRef,
      ),
    );
    assert.equal(r, "stopped");
    assert.ok(!rec.calls.includes("subscribe"));
    assert.ok(!rec.calls.includes("restoreTimer"));
    console.log("PASS: hydrate-4補（最後の取得完了後のstopでも購読しない）");
  }

  // 必須テスト1/12：initのlive取得が失敗 → 再試行で成功 → hydrateAfterLiveで完全復帰、
  // という一連の流れをデッドロックなく通す（liveスライスの loadSnapshotSlice と
  // hydrateAfterLive の合成）。
  {
    const liveGate = createSliceGate();
    let liveConfirmed = false;
    let liveRow: string | null = null;
    let attempt = 0;

    const loadLive = () =>
      loadSnapshotSlice<string | null>({
        gate: liveGate,
        fetch: async () => {
          attempt += 1;
          await delay(5);
          return attempt === 1 ? { ok: false, data: null } : { ok: true, data: "LIVE-1" };
        },
        stillCurrent: () => true,
        markPending: () => {
          liveConfirmed = false;
        },
        applyFresh: (row) => {
          liveRow = row;
          liveConfirmed = true;
        },
        markUnconfirmed: () => {
          liveConfirmed = false;
        },
      });

    const o1 = await loadLive();
    assert.equal(o1, "unconfirmed");
    assert.equal(liveConfirmed, false, "初回init：live取得失敗で未確認、自動進行は凍結");

    const o2 = await loadLive();
    assert.equal(o2, "applied");
    assert.equal(liveConfirmed, true);
    assert.equal(liveRow, "LIVE-1");

    const genRef = { g: 0 };
    const rec: Recorded = { calls: [], setGen: (g) => (genRef.g = g) };
    const r = await hydrateAfterLive(buildDeps({}, rec, genRef));
    assert.equal(r, "ready");
    assert.ok(rec.calls.includes("subscribe"), "復旧後に正しいliveについて購読が作成される");
    assert.ok(rec.calls.includes("restoreTimer"));
    console.log("PASS: recovery-flow（init失敗→再試行成功→完全復帰、デッドロックなし）");
  }

  console.log("ALL LIVE_HOST_SNAPSHOTS CHECKS PASSED");
}

void main();
