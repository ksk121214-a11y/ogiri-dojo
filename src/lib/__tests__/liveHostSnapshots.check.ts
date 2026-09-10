// src/lib/liveHostSnapshots.ts の純粋関数＋非同期並行制御の検証スクリプト。
// 実行方法は src/lib/__tests__/run.sh 参照。
// 遅延Promise と「DB書き込みモック」（副作用を記録するスパイ）を使って、
// 完全復旧オーケストレーション・所有権・await ごとの凍結再確認を再現する。
import assert from "node:assert/strict";

import {
  answersSnapshotMatches,
  awaitChannelsSubscribed,
  botScoringAllowed,
  buildChannelTopic,
  childrenSnapshotReady,
  createChannelSubscriptionTracker,
  createChannelSwapController,
  createRecoveryCoordinator,
  createSliceGate,
  hydrateAfterLive,
  insertGuardPasses,
  loadSnapshotSlice,
  progressionFrozen,
  runGuardedSteps,
  scoresSnapshotMatches,
  shouldReleaseInitInFlight,
  shouldReleaseRetryFlag,
  shouldRetryNow,
  type ChannelSubscribeOutcome,
  type ChannelSubscriptionTracker,
  type HostHydrationDeps,
  type HostHydrationOutcome,
  type ProgressGuardState,
  type SliceLoadOutcome,
} from "../liveHostSnapshots";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- hydrateAfterLive のデフォルト依存（テストごとに一部を上書きする）----
type Rec = { calls: string[] };
function buildHydrationDeps(
  over: Partial<HostHydrationDeps>,
  rec: Rec,
  refs: { gen: number; liveId: string | null; owns: boolean },
): HostHydrationDeps {
  return {
    startGeneration: 0,
    currentGeneration: () => refs.gen,
    targetLiveId: "L1",
    currentLiveId: () => refs.liveId,
    ownsRecovery: () => refs.owns,
    loadChildren: async () => {
      rec.calls.push("children");
      return "applied" as SliceLoadOutcome;
    },
    loadAnswers: async () => {
      rec.calls.push("answers");
      return "applied" as SliceLoadOutcome;
    },
    loadResolved: async () => {
      rec.calls.push("resolved");
      return "applied" as SliceLoadOutcome;
    },
    loadScores: async () => {
      rec.calls.push("scores");
      return "applied" as SliceLoadOutcome;
    },
    restoreAnsweringTimer: () => {
      rec.calls.push("restoreTimer");
    },
    finishLoading: (u: boolean) => {
      rec.calls.push(`finishLoading:${u}`);
    },
    subscribeAndWait: async () => {
      rec.calls.push("subscribeAndWait");
      return "subscribed" as ChannelSubscribeOutcome;
    },
    markRuntimeReady: () => {
      rec.calls.push("markRuntimeReady");
    },
    ...over,
  };
}

async function main() {
  // ========== 既存の純粋関数 ==========
  {
    const gate = createSliceGate();
    const t1 = gate.begin();
    const t2 = gate.begin();
    assert.equal(gate.isCurrent(t1), false);
    assert.equal(gate.isCurrent(t2), true);
    assert.equal(childrenSnapshotReady("L1", "L1"), true);
    assert.equal(childrenSnapshotReady("L1", "L2"), false);
    assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T1"), true);
    assert.equal(answersSnapshotMatches({ liveId: "L1", turnId: "T1" }, "L1", "T2"), false);
    const sk = { liveId: "L1", turnId: "T1", answerId: "A1" };
    assert.equal(scoresSnapshotMatches(sk, "L1", "T1", "A1"), true);
    assert.equal(scoresSnapshotMatches(sk, "L1", "T1", "A2"), false);
    assert.equal(shouldRetryNow(false, 0, 5000, 2000), true);
    assert.equal(shouldRetryNow(true, 0, 5000, 2000), false);
    assert.equal(shouldReleaseRetryFlag(1, 0), false);
    assert.equal(shouldReleaseRetryFlag(1, 1), true);
    assert.equal(shouldReleaseInitInFlight<symbol | null>(Symbol(), Symbol()), false);
    console.log("PASS: 基本の純粋関数（gate / snapshot matcher / retry 述語）");
  }

  // ========== loadSnapshotSlice：markPending / 新旧逆転 / 取得失敗で表示維持 ==========

  // 必須テスト（表示維持）：scores 取得失敗で既存表示を空にしない。
  {
    const gate = createSliceGate();
    let scores = ["a", "b"];
    let snap: string | null = "confirmed";
    const o = await loadSnapshotSlice<string[]>({
      gate,
      fetch: async () => ({ ok: false, data: [] }),
      stillCurrent: () => true,
      markPending: () => {
        snap = null;
      },
      applyFresh: (d) => {
        scores = d;
        snap = "confirmed";
      },
      markUnconfirmed: () => {
        snap = null;
      },
    });
    assert.equal(o, "unconfirmed");
    assert.deepEqual(scores, ["a", "b"], "取得失敗時、既存表示を空にしない");
    assert.equal(snap, null);
    console.log("PASS: 必須7相当（scores取得失敗で既存表示を空にしない）");
  }

  // 必須テスト（取得開始時点で未確認）＋（古い完了が新しい確認済みを壊さない）
  {
    const gate = createSliceGate();
    let confirmed = true;
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
      applyFresh: () => {
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    await delay(5);
    assert.equal(confirmed, false, "再取得を開始した時点で未確認になる（必須8相当）");
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
      applyFresh: () => {
        confirmed = true;
      },
      markUnconfirmed: () => {
        confirmed = false;
      },
    });
    const [o1, o2] = await Promise.all([r1, r2]);
    assert.equal(o2, "applied");
    assert.equal(o1, "superseded");
    assert.equal(confirmed, true, "遅れて失敗した古いR1が、成功したR2の確認済みを壊さない（必須相当）");
    console.log("PASS: 必須8/10相当（再取得開始で未確認 / 古い完了が新しい確認済みを壊さない）");
  }

  // ========== progressionFrozen（await をまたいだ後の凍結再確認）==========
  {
    const base: ProgressGuardState = {
      tickGeneration: 5,
      currentGeneration: 5,
      liveSnapshotConfirmed: true,
      liveId: "L1",
      tickLiveId: "L1",
      runtimeEstablished: true,
      childrenSnapshotLiveId: "L1",
      answersSnapshot: { liveId: "L1", turnId: "T1" },
      turnId: "T1",
    };
    assert.equal(progressionFrozen(base, true), false, "全て揃っていれば凍結しない");
    assert.equal(progressionFrozen({ ...base, currentGeneration: 6 }, true), true, "stopで凍結");
    assert.equal(progressionFrozen({ ...base, liveSnapshotConfirmed: false }, true), true, "live未確認で凍結");
    assert.equal(progressionFrozen({ ...base, liveId: "L2" }, true), true, "await中にlive.idが変わったら凍結");
    assert.equal(progressionFrozen({ ...base, runtimeEstablished: false }, true), true, "進行環境未確立で凍結");
    assert.equal(progressionFrozen({ ...base, childrenSnapshotLiveId: null }, true), true, "children同期中で凍結");
    assert.equal(progressionFrozen({ ...base, answersSnapshot: null }, true), true, "answers同期中で凍結（requireAnswers）");
    assert.equal(progressionFrozen({ ...base, answersSnapshot: null }, false), false, "requireAnswers=falseならanswersは見ない");
    console.log("PASS: progressionFrozen（世代/live/turn/環境/children/answers の再確認）");
  }

  // ========== botScoringAllowed / insertGuardPasses ==========
  {
    const sk = { liveId: "L1", turnId: "T1", answerId: "A1" };
    assert.equal(botScoringAllowed(false, sk, "L1", "T1", "A1"), true);
    assert.equal(botScoringAllowed(true, sk, "L1", "T1", "A1"), false, "凍結中はボット採点しない（必須9相当）");
    assert.equal(botScoringAllowed(false, null, "L1", "T1", "A1"), false, "scoresSnapshot未確認ならボット採点しない（必須10）");
    assert.equal(botScoringAllowed(false, sk, "L1", "T1", "A2"), false, "表示中の回答が変わっていたらボット採点しない");
    assert.equal(botScoringAllowed(false, sk, "L1", "T1", null), false, "表示中の回答が無ければ採点しない");

    let frozen = false;
    const liveId: string | null = "L1";
    let turnId: string | null = "T1";
    const guard = () =>
      insertGuardPasses({
        frozen: () => frozen,
        currentLiveId: () => liveId,
        currentTurnId: () => turnId,
        expectedLiveId: "L1",
        expectedTurnId: "T1",
      });
    assert.equal(guard(), true);
    frozen = true;
    assert.equal(guard(), false, "insert直前にstop → insertしない（必須11）");
    frozen = false;
    turnId = "T2";
    assert.equal(guard(), false, "insert直前にターン変更 → insertしない（必須11）");
    console.log("PASS: botScoringAllowed / insertGuardPasses（必須9/10/11相当）");
  }

  // ========== runGuardedSteps ＋ DB書き込みモック ==========

  // 必須9：processRevealQueue の await 中に未確認になったら runBotBehavior を呼ばない。
  {
    const dbWrites: string[] = [];
    let frozen = false;
    const res = await runGuardedSteps(
      () => frozen,
      [
        {
          name: "processRevealQueue",
          run: async () => {
            await delay(10);
            frozen = true; // await 中に Realtime 取得が始まって未確認になった相当
            dbWrites.push("reveal");
          },
        },
        {
          name: "runBotBehavior",
          run: async () => {
            dbWrites.push("botInsert"); // ここには到達しないはず
          },
        },
        {
          name: "resolveIfDue",
          run: async () => {
            dbWrites.push("resolve");
          },
        },
        {
          name: "syncAnsweringPause",
          run: async () => {
            dbWrites.push("pause");
          },
        },
      ],
    );
    assert.equal(res.blockedAt, "runBotBehavior", "processRevealQueue の後で凍結を検出して止まる");
    assert.deepEqual(res.ran, ["processRevealQueue"]);
    assert.deepEqual(dbWrites, ["reveal"], "runBotBehavior 以降の DB 書き込みは発生しない（必須9/12/13相当）");
    console.log("PASS: 必須9/12/13相当（await中の未確認化で後続DB書き込みを止める）");
  }

  // 全ステップ成功 → blockedAt は null（そのままフェーズ遷移RPCへ進んでよい）。
  {
    const ran: string[] = [];
    const res = await runGuardedSteps(
      () => false,
      [
        { name: "a", run: async () => void ran.push("a") },
        { name: "b", run: async () => void ran.push("b") },
      ],
    );
    assert.equal(res.blockedAt, null);
    assert.deepEqual(ran, ["a", "b"]);
    console.log("PASS: runGuardedSteps（全ステップ成功時は blockedAt=null）");
  }

  // 最後のステップ後に凍結 → blockedAt="after-last"（遷移RPCへ進まない）。
  {
    let frozen = false;
    const res = await runGuardedSteps(
      () => frozen,
      [
        {
          name: "only",
          run: async () => {
            await delay(5);
            frozen = true;
          },
        },
      ],
    );
    assert.equal(res.blockedAt, "after-last");
    console.log("PASS: runGuardedSteps（最終ステップ後の凍結で after-last）");
  }

  // ========== createRecoveryCoordinator（init/retry/refresh の合流と所有権）==========

  // 必須1/3/8：完全復旧の最中に refresh が呼ばれても、同じ Promise へ合流する
  // （中途半端に superseded で終わらせない）。
  {
    const coord = createRecoveryCoordinator();
    let taskRuns = 0;
    const task = async (): Promise<HostHydrationOutcome> => {
      taskRuns += 1;
      await delay(30);
      return "ready";
    };
    const pInit = coord.run(0, task);
    await delay(5);
    const pRefresh = coord.run(0, task); // 同一世代 → 合流
    assert.equal(pInit, pRefresh, "同一世代の完全復旧が進行中なら同じ Promise へ合流する");
    const [a, b] = await Promise.all([pInit, pRefresh]);
    assert.equal(a, "ready");
    assert.equal(b, "ready");
    assert.equal(taskRuns, 1, "task は二重に走らない（refresh が別処理を並行させない）");
    assert.equal(coord.inFlight(), false, "完了後は inFlight が解除される");
    console.log("PASS: 必須1/3/8相当（refresh が完全復旧へ合流し二重実行しない）");
  }

  // 別世代なら別タスクとして走る。
  {
    const coord = createRecoveryCoordinator();
    let runs = 0;
    const task = async (): Promise<HostHydrationOutcome> => {
      runs += 1;
      return "ready";
    };
    await coord.run(0, task);
    await coord.run(1, task);
    assert.equal(runs, 2, "世代が違えば別タスク");
    console.log("PASS: createRecoveryCoordinator（別世代は別タスク）");
  }

  // 必須14：stop（invalidate）後に、進行中だった完全復旧の owns() が false になり、
  // その完了は新しい状態を触らない。
  {
    const coord = createRecoveryCoordinator();
    let ownedDuringTask = true;
    const p = coord.run(0, async (_gen, token) => {
      await delay(20);
      ownedDuringTask = coord.owns(token);
      return "ready" as HostHydrationOutcome;
    });
    await delay(5);
    coord.invalidate(); // stopHostProgress 相当
    await p;
    assert.equal(ownedDuringTask, false, "invalidate 後、進行中タスクは所有権を失う（timer/channelを復活させない）");
    // invalidate 後に新しい run を開始でき、所有権も持てる。
    let newOwned = false;
    await coord.run(1, async (_g, token) => {
      newOwned = coord.owns(token);
      return "ready" as HostHydrationOutcome;
    });
    assert.equal(newOwned, true);
    console.log("PASS: 必須14相当（stop後は古い完全復旧が所有権を失う）");
  }

  // ========== hydrateAfterLive：4種類の結果を区別する ==========

  // 必須1/2：全スライス applied → タイマー復元 → 購読 → markRuntimeReady、順序も検証。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(buildHydrationDeps({}, rec, refs));
    assert.equal(r, "ready");
    assert.deepEqual(rec.calls, [
      "children",
      "answers",
      "resolved",
      "scores",
      "restoreTimer",
      "finishLoading:false",
      "subscribeAndWait",
      "markRuntimeReady",
    ]);
    assert.ok(rec.calls.indexOf("restoreTimer") < rec.calls.indexOf("subscribeAndWait"), "タイマー復元は購読より前（必須2/0秒停止しない）");
    assert.ok(rec.calls.indexOf("subscribeAndWait") < rec.calls.indexOf("markRuntimeReady"), "ready は購読の後にだけ立つ");
    console.log("PASS: 必須1/2相当（applied で完全復旧：children→answers→resolved→scores→タイマー→購読→ready）");
  }

  // 必須3/4：progression critical スライスが unconfirmed → 購読を張り、構造としては
  // runtime ready にする（＝放置されない）が、戻り値は "not-ready"（データが古いので
  // 呼び出し側は per-tick の軽量再試行で追いつく）。full recovery を毎回やり直さない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps({ loadAnswers: async () => "unconfirmed" as SliceLoadOutcome }, rec, refs),
    );
    assert.equal(r, "not-ready", "データが未確認なので戻り値は not-ready（自動進行は per-tick ガードで止まる）");
    assert.ok(rec.calls.includes("subscribeAndWait"), "unconfirmed でも同じliveIdの購読は張る（再取得待ち）");
    assert.ok(
      rec.calls.includes("markRuntimeReady"),
      "unconfirmed は購読済み＝構造は確立。runtime ready にして放置しない（必須3）",
    );
    assert.ok(rec.calls.includes("finishLoading:true"), "注意文言（anyUnconfirmed）を出す");
    console.log("PASS: 必須3/4相当（未確認は購読＋構造readyだが戻り値 not-ready で軽量再試行に委ねる）");
  }

  // 必須7：superseded（別の取得が責任を持つ）は markRuntimeReady しない＝runtime ready
  // 扱いにせず、完全復旧を再試行させる。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps({ loadChildren: async () => "superseded" as SliceLoadOutcome }, rec, refs),
    );
    assert.equal(r, "not-ready");
    assert.ok(!rec.calls.includes("markRuntimeReady"), "superseded スライスがあれば runtime ready にしない（必須7）");
    console.log("PASS: 必須7相当（supersededスライスは構造readyにしない＝完全復旧を再試行）");
  }

  // 必須6：target-changed（取得中に別ライブへ切り替わった）→ superseded/ready 扱いしない、
  // 購読も markRuntimeReady もしない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        {
          loadChildren: async () => {
            refs.liveId = "L2"; // 取得中に別ライブへ
            rec.calls.push("children");
            return "applied" as SliceLoadOutcome;
          },
        },
        rec,
        refs,
      ),
    );
    assert.equal(r, "target-changed");
    assert.ok(!rec.calls.includes("subscribeAndWait"), "古いliveIdでは購読しない（必須5/6）");
    assert.ok(!rec.calls.includes("restoreTimer"));
    assert.ok(!rec.calls.includes("markRuntimeReady"), "target-changed を ready 扱いしない（必須6）");
    console.log("PASS: 必須5/6相当（target-changed は購読も ready もしない）");
  }

  // 必須7（scores 経路）：loadScores が superseded を返した場合も markRuntimeReady しない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps({ loadScores: async () => "superseded" as SliceLoadOutcome }, rec, refs),
    );
    assert.equal(r, "not-ready");
    assert.ok(!rec.calls.includes("markRuntimeReady"), "superseded を無条件に ready 扱いしない（必須7）");
    console.log("PASS: 必須7相当（loadScores superseded も無条件 ready 扱いしない）");
  }

  // 必須14：復旧途中で generation が変わった（stop）→ 以降のタイマー復元・購読を行わない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        {
          loadChildren: async () => {
            await delay(5);
            refs.gen = 1; // stopHostProgress 相当
            rec.calls.push("children");
            return "applied" as SliceLoadOutcome;
          },
        },
        rec,
        refs,
      ),
    );
    assert.equal(r, "stopped");
    assert.ok(!rec.calls.includes("subscribeAndWait"));
    assert.ok(!rec.calls.includes("restoreTimer"));
    assert.ok(!rec.calls.includes("markRuntimeReady"));
    console.log("PASS: 必須14相当（復旧途中のstopでtimer/channel/stateを復活させない）");
  }

  // 必須14：復旧途中で所有権を失った（invalidate 相当）→ stopped。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        {
          loadAnswers: async () => {
            refs.owns = false; // 新しい完全復旧に所有権を奪われた／stopした相当
            rec.calls.push("answers");
            return "applied" as SliceLoadOutcome;
          },
        },
        rec,
        refs,
      ),
    );
    assert.equal(r, "stopped");
    assert.ok(!rec.calls.includes("subscribeAndWait"));
    console.log("PASS: 必須14相当（所有権喪失後は購読しない）");
  }

  // 必須8/15：target-changed の後、新しい liveId で完全復旧が最後まで進む
  // （hydrateAfterLive を2回：1回目 target-changed → 2回目 ready）＝デッドロックしない。
  {
    // 1回目：L1 対象の途中で L2 へ切り替わる
    const refs1 = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec1: Rec = { calls: [] };
    const r1 = await hydrateAfterLive(
      buildHydrationDeps(
        {
          targetLiveId: "L1",
          loadChildren: async () => {
            refs1.liveId = "L2";
            return "applied" as SliceLoadOutcome;
          },
        },
        rec1,
        refs1,
      ),
    );
    assert.equal(r1, "target-changed");
    // 2回目：新しい liveId L2 で完全復旧
    const refs2 = { gen: 0, liveId: "L2" as string | null, owns: true };
    const rec2: Rec = { calls: [] };
    const r2 = await hydrateAfterLive(buildHydrationDeps({ targetLiveId: "L2" }, rec2, refs2));
    assert.equal(r2, "ready");
    assert.ok(rec2.calls.includes("subscribeAndWait"), "最終的に新しいライブ(L2)だけを購読する（必須8）");
    assert.ok(rec2.calls.includes("markRuntimeReady"));
    console.log("PASS: 必須8/15相当（target-changed→新liveIdで完全復旧、デッドロックしない）");
  }

  // ========== Realtime 購読の接続状態集約（P1-2）==========

  // 追加必須3：一部の必須チャンネルだけ SUBSCRIBED では allSubscribed=false。
  {
    const t = createChannelSubscriptionTracker(["lives", "participants", "turns", "answers", "scores"]);
    t.note("lives", "SUBSCRIBED");
    t.note("participants", "SUBSCRIBED");
    t.note("turns", "SUBSCRIBED");
    assert.equal(t.allSubscribed(), false, "一部だけ SUBSCRIBED では runtime 確立にならない");
    assert.equal(t.hasFailure(), false);
    t.note("answers", "SUBSCRIBED");
    t.note("scores", "SUBSCRIBED");
    // 追加必須4：全必須チャンネル SUBSCRIBED でだけ allSubscribed=true。
    assert.equal(t.allSubscribed(), true, "全必須チャンネル SUBSCRIBED でだけ runtime 確立");
    // 追加必須5：CLOSED で異常＝凍結対象に。
    t.note("answers", "CLOSED");
    assert.equal(t.allSubscribed(), false);
    assert.equal(t.hasFailure(), true, "CLOSED は無視しない");
    console.log("PASS: 追加必須3/4/5（チャンネル接続状態の集約：一部/全/異常）");
  }

  // 追加必須5：CHANNEL_ERROR / TIMED_OUT でも hasFailure。
  {
    for (const bad of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const) {
      const t = createChannelSubscriptionTracker(["lives"]);
      t.note("lives", "SUBSCRIBED");
      t.note("lives", bad);
      assert.equal(t.hasFailure(), true, `${bad} で hasFailure`);
      assert.equal(t.allSubscribed(), false, `${bad} 後は allSubscribed=false`);
    }
    console.log("PASS: 追加必須5（CHANNEL_ERROR / TIMED_OUT / CLOSED を無視しない）");
  }

  // awaitChannelsSubscribed：subscribed / error / timeout / aborted の区別。
  {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // subscribed：遅れて全チャンネルが SUBSCRIBED になる → "subscribed"
    {
      const t = createChannelSubscriptionTracker(["a", "b"]);
      setTimeout(() => t.note("a", "SUBSCRIBED"), 20);
      setTimeout(() => t.note("b", "SUBSCRIBED"), 40);
      const o = await awaitChannelsSubscribed({
        tracker: t,
        aborted: () => false,
        timeoutMs: 1000,
        pollMs: 10,
        now: () => Date.now(),
        sleep,
      });
      assert.equal(o, "subscribed", "全必須チャンネル SUBSCRIBED 後に subscribed");
    }
    // error：途中で CHANNEL_ERROR → "error"
    {
      const t = createChannelSubscriptionTracker(["a", "b"]);
      setTimeout(() => t.note("a", "SUBSCRIBED"), 10);
      setTimeout(() => t.note("b", "CHANNEL_ERROR"), 20);
      const o = await awaitChannelsSubscribed({
        tracker: t,
        aborted: () => false,
        timeoutMs: 1000,
        pollMs: 10,
        now: () => Date.now(),
        sleep,
      });
      assert.equal(o, "error", "必須チャンネル異常で error（自動進行を凍結させる）");
    }
    // timeout：いつまでも SUBSCRIBED にならない → "timeout"
    {
      const t = createChannelSubscriptionTracker(["a"]);
      const o = await awaitChannelsSubscribed({
        tracker: t,
        aborted: () => false,
        timeoutMs: 30,
        pollMs: 10,
        now: () => Date.now(),
        sleep,
      });
      assert.equal(o, "timeout");
    }
    // 追加必須7：stop 中／ライブ切替中は、遅れて allSubscribed になっても "aborted"。
    {
      const t = createChannelSubscriptionTracker(["a"]);
      t.note("a", "SUBSCRIBED"); // 既に全 SUBSCRIBED
      const o = await awaitChannelsSubscribed({
        tracker: t,
        aborted: () => true, // stop / 世代変更 / liveId 変更 相当
        timeoutMs: 1000,
        pollMs: 10,
        now: () => Date.now(),
        sleep,
      });
      assert.equal(o, "aborted", "中断条件が真なら allSubscribed でも aborted（遅延SUBSCRIBEDを無視）");
    }
    console.log("PASS: awaitChannelsSubscribed（subscribed / error / timeout / aborted の区別）");
  }

  // 追加必須3/5：hydrateAfterLive で subscribeAndWait が "error" → markRuntimeReady しない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        { subscribeAndWait: async () => "error" as ChannelSubscribeOutcome },
        rec,
        refs,
      ),
    );
    assert.equal(r, "not-ready", "接続異常なら runtime ready にせず not-ready");
    assert.ok(!rec.calls.includes("markRuntimeReady"), "接続異常で runtime ready にしない（CHANNEL_ERROR等で凍結）");
    console.log("PASS: 追加必須5（subscribeAndWait error → runtime ready にしない）");
  }
  // subscribeAndWait が "timeout" → 同上。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        { subscribeAndWait: async () => "timeout" as ChannelSubscribeOutcome },
        rec,
        refs,
      ),
    );
    assert.equal(r, "not-ready");
    assert.ok(!rec.calls.includes("markRuntimeReady"), "接続タイムアウトで runtime ready にしない");
    console.log("PASS: 追加必須（subscribeAndWait timeout → runtime ready にしない）");
  }
  // 追加必須7：subscribeAndWait が "aborted"（stop/切替）→ stopped、markRuntimeReady しない。
  {
    const refs = { gen: 0, liveId: "L1" as string | null, owns: true };
    const rec: Rec = { calls: [] };
    const r = await hydrateAfterLive(
      buildHydrationDeps(
        { subscribeAndWait: async () => "aborted" as ChannelSubscribeOutcome },
        rec,
        refs,
      ),
    );
    assert.equal(r, "stopped");
    assert.ok(!rec.calls.includes("markRuntimeReady"), "中断時は runtime ready にしない");
    console.log("PASS: 追加必須7（subscribeAndWait aborted → stopped・runtime ready にしない）");
  }

  // 追加必須1/2：古い購読世代の refetch 結果で現在のライブを上書きしない
  // （stillCurrent が「購読世代一致 ＋ 現在の live.id 一致」を確認する）。
  {
    const gate = createSliceGate();
    let channelGen = 1; // 現在の購読世代
    let currentLiveId = "A";
    let state = "A-initial";
    // ライブA向けの refetchLive を開始（購読世代1、対象 A）
    const myGen = channelGen;
    const myLiveId = "A";
    const r = loadSnapshotSlice<string>({
      gate,
      fetch: async () => {
        await delay(30); // A のコールバックが遅延
        return { ok: true, data: "A-late" };
      },
      // `stillCurrent: () => true` は廃止。購読世代と現在の live.id を確認する。
      stillCurrent: () => channelGen === myGen && currentLiveId === myLiveId,
      applyFresh: (d) => {
        state = d;
      },
      markUnconfirmed: () => {},
    });
    await delay(5);
    // ライブBへ切り替え（cleanupChannels 相当で購読世代が進む）
    channelGen = 2;
    currentLiveId = "B";
    state = "B-current";
    const o = await r;
    assert.equal(o, "target-changed", "古い購読世代・別liveIdの refetch は反映しない");
    assert.equal(state, "B-current", "ライブAの遅延結果がライブBを上書きしない（P1-1）");
    console.log("PASS: 追加必須1/2（古い購読世代のコールバックが現在のライブを上書きしない）");
  }

  // 追加必須6：古い購読世代のエラーは、新しい世代の tracker に影響しない
  // （世代ごとに tracker が分かれている）。
  {
    const oldTracker = createChannelSubscriptionTracker(["lives"]);
    const newTracker = createChannelSubscriptionTracker(["lives"]);
    newTracker.note("lives", "SUBSCRIBED");
    // 古い世代のチャンネルから遅れて CHANNEL_ERROR が届いた（古い tracker へ）
    oldTracker.note("lives", "CHANNEL_ERROR");
    assert.equal(oldTracker.hasFailure(), true);
    assert.equal(newTracker.hasFailure(), false, "古い世代のエラーは新しい世代の tracker に影響しない");
    assert.equal(newTracker.allSubscribed(), true, "新しい世代の runtime ready は解除されない（必須6）");
    console.log("PASS: 追加必須6（古い購読世代のエラーが現在の runtime を無効化しない）");
  }

  // ========== createChannelSwapController（購読の入れ替え：P1／観客側）==========

  // 疑似 Supabase チャンネル。topic を記録し、status を後から手動で流せる。
  type FakeChannel = { topic: string; onStatus: (kind: string, s: string) => void; removed: boolean };
  const KINDS = ["lives", "participants", "answers", "scores", "tsukkomi", "answering-cue"];
  const makeSwapEnv = () => {
    const removed: FakeChannel[] = [];
    const removeDeferrals: Array<() => void> = []; // 保留中の removeChannel を後で解決する
    let removeMode: "resolve" | "pending" | "throw" = "resolve";
    const deps = {
      kinds: KINDS,
      topicFor: (kind: string, _liveId: string, gen: number) =>
        buildChannelTopic("follower", kind, gen),
      remove: (ch: FakeChannel) => {
        removed.push(ch);
        ch.removed = true;
        if (removeMode === "throw") throw new Error("removeChannel sync failure");
        if (removeMode === "pending") {
          return new Promise<void>((res) => removeDeferrals.push(() => res()));
        }
        return Promise.resolve();
      },
    };
    // spawn：controller が呼ぶ。isCurrentGen で古い世代のコールバックを弾く FakeChannel を作る。
    const spawn = (args: {
      gen: number;
      tracker: ChannelSubscriptionTracker;
      isCurrentGen: () => boolean;
      topicFor: (kind: string) => string;
    }): FakeChannel[] =>
      KINDS.map((kind) => ({
        topic: args.topicFor(kind),
        removed: false,
        onStatus: (k, s) => {
          if (!args.isCurrentGen()) return; // 古い購読世代は無視
          args.tracker.note(k, s);
        },
      }));
    return {
      deps,
      spawn,
      removed,
      flushRemovals: () => removeDeferrals.splice(0).forEach((f) => f()),
      setRemoveMode: (m: "resolve" | "pending" | "throw") => {
        removeMode = m;
      },
    };
  };

  // 追加必須2：購読世代ごとに一意な topic（固定topic名に依存しない・同名衝突しない）。
  {
    assert.equal(buildChannelTopic("follower", "tsukkomi", 1), "follower-tsukkomi-g1");
    assert.equal(buildChannelTopic("host", "lives", 3, "L1"), "host-lives-L1-g3");
    assert.notEqual(
      buildChannelTopic("follower", "lives", 1),
      buildChannelTopic("follower", "lives", 2),
    );
    console.log("PASS: 追加必須2（buildChannelTopic：世代固有・固定topic名に依存しない）");
  }

  // 追加必須1/2/4：removeChannel 保留中に再 swap しても古い同名を再利用しない
  // （gen固有 topic）。旧世代だけ除去され、新世代は除去されない。
  {
    const e = makeSwapEnv();
    e.setRemoveMode("pending");
    const c = createChannelSwapController(e.deps);
    const s1 = c.swap("", e.spawn);
    const s2 = c.swap("", e.spawn); // removeChannel 保留中に再 swap
    assert.notDeepEqual(
      s1.channels.map((x) => x.topic),
      s2.channels.map((x) => x.topic),
      "removeChannel 保留中でも新しい世代は別 topic のチャンネルを作る（古い同名を再利用しない）",
    );
    assert.equal(c.currentGen(), 2);
    for (const ch of s1.channels) assert.ok(e.removed.includes(ch), "旧世代チャンネルが除去されていない");
    for (const ch of s2.channels) assert.ok(!e.removed.includes(ch), "新世代チャンネルが誤って除去された（必須4）");
    console.log("PASS: 追加必須1/2/4（保留 removeChannel 中でも新世代は別topic・旧世代のみ除去）");
  }

  // 追加必須3/10：入れ替えを2回並行させても、最後の世代だけが有効。
  {
    const e = makeSwapEnv();
    const c = createChannelSwapController(e.deps);
    const s1 = c.swap("", e.spawn);
    const s2 = c.swap("", e.spawn);
    assert.equal(c.currentGen(), s2.gen);
    s1.channels[0].onStatus("lives", "SUBSCRIBED");
    assert.deepEqual(s1.tracker.state().subscribed, [], "古い世代の SUBSCRIBED は反映されない（必須3/10）");
    for (const kind of KINDS) {
      s2.channels[KINDS.indexOf(kind)].onStatus(kind, "SUBSCRIBED");
    }
    assert.equal(s2.tracker.allSubscribed(), true, "最新世代の SUBSCRIBED は集約される（必須13）");
    console.log("PASS: 追加必須3/10/13（並行入れ替え：最後の世代だけが有効・SUBSCRIBEDは通る）");
  }

  // 追加必須11：古い swap 結果の dispose を後から実行しても、新しい世代の
  // チャンネルは消えず、新しい世代は無効化されない（所有権付き cleanup）。
  {
    const e = makeSwapEnv();
    const c = createChannelSwapController(e.deps);
    const s1 = c.swap("", e.spawn);
    const s2 = c.swap("", e.spawn); // s1 に追い越される
    const genBefore = c.currentGen();
    s1.dispose(); // 古い subscribe の cleanup を後から実行
    for (const ch of s1.channels) assert.ok(ch.removed, "自分（s1）の世代のチャンネルは除去される");
    for (const ch of s2.channels) assert.ok(!ch.removed, "古い cleanup が新しい世代のチャンネルを消した（必須11）");
    assert.equal(c.currentGen(), genBefore, "古い cleanup が世代を進めた（新しい世代を無効化した）");
    assert.equal(c.current(), s2, "古い cleanup が current を消した");
    // s2 の status は今も有効。
    s2.channels[0].onStatus("lives", "SUBSCRIBED");
    assert.deepEqual(s2.tracker.state().subscribed, ["lives"], "新しい世代の購読は生きている");
    console.log("PASS: 追加必須11（所有権付き dispose：古い cleanup が最新世代を invalidate しない）");
  }

  // 追加必須12/14：dispose した自分の世代のコールバックは以降無効。再マウント相当で
  // 何度 swap→dispose を繰り返してもチャンネルは増殖せず、最後の1世代だけが有効。
  {
    const e = makeSwapEnv();
    const c = createChannelSwapController(e.deps);
    let last = c.swap("", e.spawn);
    for (let i = 0; i < 5; i++) {
      const prev = last;
      last = c.swap("", e.spawn);
      prev.dispose(); // 直前の subscribe の cleanup（新しい swap の後に走る）
    }
    // 古い世代のコールバックはすべて無効。
    // （5回ぶんの prev は dispose 済みだが、swap 側で既に無効化済みなので二重でも安全）
    assert.equal(c.current(), last, "最後の swap だけが current");
    last.channels[0].onStatus("lives", "SUBSCRIBED");
    assert.deepEqual(last.tracker.state().subscribed, ["lives"], "最新世代だけが state を触れる（必須12/14）");
    console.log("PASS: 追加必須12/14（再マウント相当の swap/dispose 反復でも最新1世代のみ有効）");
  }

  // 追加必須15相当（removeChannel の同期例外でも進行を止めない）。
  {
    const e = makeSwapEnv();
    e.setRemoveMode("throw");
    const c = createChannelSwapController(e.deps);
    c.swap("", e.spawn);
    const s2 = c.swap("", e.spawn); // 例外が伝播せず次の swap が普通にできる
    assert.equal(c.currentGen(), 2);
    assert.equal(s2.channels.length, KINDS.length);
    s2.dispose(); // dispose 内の remove が throw しても例外は漏れない
    console.log("PASS: 追加必須15相当（removeChannel の同期例外でも swap/dispose は継続）");
  }

  // 追加必須11：invalidate（stop 相当）後、遅延 status / 遅延削除がチャンネルを復活させない。
  {
    const e = makeSwapEnv();
    e.setRemoveMode("pending");
    const c = createChannelSwapController(e.deps);
    const s1 = c.swap("", e.spawn);
    c.invalidate();
    assert.equal(c.current(), null, "invalidate 後は current が無い");
    s1.channels[0].onStatus("lives", "SUBSCRIBED");
    assert.deepEqual(s1.tracker.state().subscribed, [], "invalidate 後の遅延 SUBSCRIBED は無視される（必須11）");
    e.flushRemovals();
    assert.equal(c.current(), null);
    const s2 = c.swap("", e.spawn);
    assert.equal(s2.gen, c.currentGen());
    console.log("PASS: 追加必須11（invalidate 後の遅延 status/削除がチャンネルを復活させない）");
  }

  // 追加必須7/8（P2）：loadSnapshotSlice の beginGuard が false のとき、gate を
  // 進めず（gate.begin を呼ばず）、markPending も fetch も実行しない。
  {
    const gate = createSliceGate();
    const before = gate.current();
    let markPendingCalled = false;
    let fetchCalled = false;
    const o = await loadSnapshotSlice<string>({
      gate,
      beginGuard: () => false, // 旧購読世代・別ライブ相当
      markPending: () => {
        markPendingCalled = true;
      },
      fetch: async () => {
        fetchCalled = true;
        return { ok: true, data: "x" };
      },
      stillCurrent: () => true,
      applyFresh: () => {},
      markUnconfirmed: () => {},
    });
    assert.equal(o, "target-changed", "beginGuard=false は target-changed で即戻る");
    assert.equal(gate.current(), before, "beginGuard=false のとき gate.begin() を呼ばない（必須8）");
    assert.equal(markPendingCalled, false, "beginGuard=false のとき markPending を呼ばない（必須7）");
    assert.equal(fetchCalled, false, "beginGuard=false のとき fetch を呼ばない（必須8）");
    console.log("PASS: 追加必須7/8（beginGuard=false は gate/markPending/fetch のどれも実行しない）");
  }
  // beginGuard=true なら通常どおり。
  {
    const gate = createSliceGate();
    let applied = "";
    const o = await loadSnapshotSlice<string>({
      gate,
      beginGuard: () => true,
      fetch: async () => ({ ok: true, data: "ok" }),
      stillCurrent: () => true,
      applyFresh: (d) => {
        applied = d;
      },
      markUnconfirmed: () => {},
    });
    assert.equal(o, "applied");
    assert.equal(applied, "ok");
    console.log("PASS: 追加必須（beginGuard=true なら通常どおり適用される）");
  }

  console.log("ALL LIVE_HOST_SNAPSHOTS CHECKS PASSED");
}

void main();
