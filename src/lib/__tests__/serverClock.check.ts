// サーバー同期時計・残り時間・拍手音計画・司会単独の回答終了進行の「実際の時刻ずれ」を
// 再現する検証（4回目レビュー対応）。performance.now()と端末時計(Date.now)は
// 全てテスト側から制御し、文字列検査ではなく本番と同じ関数を実行して確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createAnsweringAdvancer, tryAdvanceAnswering } from "../answeringAdvance";
import { answeringRemaining, judgingRemaining, phaseRemainingSeconds } from "../liveRemaining";
import { createBgmSyncPlanner, type BgmSyncAction } from "../bgmSync";
import { decideBgmCorrection, type BgmCorrectionResult } from "../bgmCorrection";
import { createBgmStartIntent } from "../bgmStartIntent";
import { decideBgmRetry, decideBgmStart, resolveBgmOffsetSec, registerMetadataListenerOnce, resolveFallbackSeekSec } from "../bgmStartPlan";
import { createTopicRevealSfxScheduler } from "../topicRevealSfxScheduler";
import { createServerClock } from "../serverClock";
import { startServerClockAutoSync, type AutoSyncEnv } from "../serverClockAutoSync";
import { planTopicRevealSfx } from "../topicRevealSfx";

// ---- 仮想世界：真の時刻(trueMs)と、端末のperformance.now()・端末時計(Date.now)を別々に持つ ----
class World {
  trueMs = 1_800_000_000_000; // 真のサーバー時刻
  perfBase = 5_000; // performance.now()の原点
  deviceOffsetMs = 0; // 端末時計(Date.now)のずれ。performance.now()には影響しない
  advance(ms: number) {
    this.trueMs += ms;
  }
  perfNow = () => this.perfBase + (this.trueMs - 1_800_000_000_000);
  deviceNow = () => this.trueMs + this.deviceOffsetMs;
}

function makeClock(world: World, opts: { latencyMs?: number; fail?: () => boolean } = {}) {
  const latency = opts.latencyMs ?? 0;
  return createServerClock({
    perfNow: world.perfNow,
    fallbackNow: world.deviceNow,
    fetchServerEpochMs: async () => {
      if (opts.fail?.()) throw new Error("network");
      // 行きlatency/2：サーバーが時刻を決める → 帰りlatency/2
      world.advance(latency / 2);
      const serverNow = world.trueMs;
      world.advance(latency / 2);
      return serverNow;
    },
  });
}
const answeringRemainingMs = (live: Parameters<typeof answeringRemaining>[0], nowMs: number) =>
  answeringRemaining(live, { now: nowMs, fresh: true }).ms;
const judgingRemainingMs = (iso: string | null | undefined, nowMs: number) =>
  judgingRemaining(iso, { now: nowMs, fresh: true }).ms;
const near = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got=${a} want=${b}±${tol}`);

(async () => {
  // 1-5: 端末時計が正しい/±30秒/±60秒でも、推定サーバー時刻は真の時刻に一致する。
  for (const offset of [0, 30_000, -30_000, 60_000, -60_000]) {
    const w = new World();
    w.deviceOffsetMs = offset;
    const clock = makeClock(w);
    assert.equal(clock.isFresh(), false);
    near(clock.now(), w.deviceNow(), 0, "同期前は暫定値（端末時計）");
    assert.equal(await clock.sync(), true);
    w.advance(20_000);
    near(clock.now(), w.trueMs, 1, `端末時計${offset}msずれでもサーバー時刻に一致`);
    // 残り時間：DB締切まで20秒のとき、どの端末時計でも約20秒。
    const deadline = new Date(w.trueMs + 20_000).toISOString();
    const live = { answering_paused: false, answering_remaining_ms: null, phase_deadline: deadline };
    near(answeringRemainingMs(live, clock.now()), 20_000, 5, `残り約20秒(端末時計${offset}ms)`);
    // 端末時計だけで計算した場合は大きくずれる（＝この修正が必要だった証拠）。
    if (offset !== 0) {
      assert.ok(Math.abs(answeringRemainingMs(live, w.deviceNow()) - 20_000) >= 10_000);
    }
  }
  console.log("PASS: 端末時計が正しい/±30秒/±60秒でも推定サーバー時刻・残り時間が一致する");

  // 6: 同期後に端末時計を急に変更しても（performance.now()は動かない）残り時間は飛ばない。
  {
    const w = new World();
    const clock = makeClock(w);
    await clock.sync();
    const deadline = new Date(w.trueMs + 20_000).toISOString();
    const live = { answering_paused: false, answering_remaining_ms: null, phase_deadline: deadline };
    w.advance(5_000);
    const before = answeringRemainingMs(live, clock.now());
    w.deviceOffsetMs = 3_600_000; // 端末時計を1時間進める
    const after = answeringRemainingMs(live, clock.now());
    near(after, before, 1, "端末時計を途中変更しても残り時間が飛ばない");
    w.deviceOffsetMs = -3_600_000;
    near(answeringRemainingMs(live, clock.now()), before, 1, "逆方向に変更しても飛ばない");
    console.log("PASS: 同期後に端末時計を急変更しても残り時間が飛ばない");
  }

  // 7: 通信遅延（往復2000ms）があっても中間点補正で誤差が小さい（片道遅延分の丸ごとのずれにならない）。
  {
    const w = new World();
    const clock = makeClock(w, { latencyMs: 2_000 });
    await clock.sync();
    near(clock.now(), w.trueMs, 1, "往復遅延2秒でも中間点補正で誤差はほぼ0（対称遅延）");
    // 単純にserverTime - Date.now()だけを保存する方式なら1000ms遅れる。
    console.log("PASS: 通信遅延は往復の中間点で補正される");
  }

  // 8: 古い同期レスポンスが後から届いても新しい結果を上書きしない。
  {
    const w = new World();
    let call = 0;
    const releases: Array<() => void> = [];
    const values: number[] = [];
    const clock = createServerClock({
      perfNow: w.perfNow,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: () => {
        const my = ++call;
        return new Promise<number>((resolve) => {
          releases[my - 1] = () => resolve(values[my - 1]);
        });
      },
    });
    const first = clock.sync(); // 古い（遅い）同期
    const second = clock.sync({ force: true }); // 新しい同期
    values[0] = w.trueMs - 500_000; // 古い応答：大きく間違った値（後から届く）
    values[1] = w.trueMs;
    releases[1](); // 新しい方が先に届く
    assert.equal(await second, true);
    releases[0](); // 古い方が後から届く
    assert.equal(await first, false, "古い応答は破棄される");
    near(clock.now(), w.trueMs, 1, "古い応答に上書きされていない");
    console.log("PASS: 古い同期レスポンスが後から届いても新しい結果を上書きしない");
  }

  // 9: single-flight（force無しの同時呼び出しは1回の通信に合流）。
  {
    const w = new World();
    let calls = 0;
    const clock = createServerClock({
      perfNow: w.perfNow,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: async () => {
        calls++;
        return w.trueMs;
      },
    });
    await Promise.all([clock.sync(), clock.sync(), clock.sync()]);
    assert.equal(calls, 1);
    console.log("PASS: 同期はsingle-flight");
  }

  // 10: 再同期すると、ずれた分が補正される（performance.nowのドリフトを模擬）。
  {
    const w = new World();
    const clock = makeClock(w);
    await clock.sync();
    // 端末がスリープしperformance.now()が止まっていた状況を模擬：真の時刻だけ10秒進む。
    const stalePerf = w.perfNow;
    let frozen = stalePerf();
    const c2 = createServerClock({
      perfNow: () => frozen,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: async () => w.trueMs,
    });
    await c2.sync();
    w.advance(10_000); // 真の時刻は進むがc2のperfは止まったまま
    assert.ok(Math.abs(c2.now() - w.trueMs) >= 9_000, "再同期前はずれている");
    frozen = stalePerf(); // perfも追いつく前に、再同期
    await c2.sync({ force: true });
    near(c2.now(), w.trueMs, 1, "再同期後は正しい時刻へ追いつく");
    console.log("PASS: 再同期でずれが補正される");
  }

  // 11: 同期失敗時はthrowせず、既存アンカーを保持し、再試行で成功する。
  {
    const w = new World();
    let failing = true;
    const clock = makeClock(w, { fail: () => failing });
    assert.equal(await clock.sync(), false);
    assert.equal(clock.isFresh(), false);
    failing = false;
    assert.equal(await clock.sync(), true);
    failing = true;
    assert.equal(await clock.sync({ force: true }), false);
    assert.equal(clock.hasAnchor(), true, "失敗しても既存のアンカーは保持");
    near(clock.now(), w.trueMs, 1, "失敗後も時刻は進み続ける");
    console.log("PASS: 同期失敗後の再試行で成功し、失敗しても既存アンカーを保持する");
  }

  // 12: 自動再同期：初回・失敗時のバックオフ再試行・定期・online・visible・stop後は動かない。
  {
    const w = new World();
    let failing = true;
    let syncs = 0;
    const clock = makeClock(w, { fail: () => (syncs++, failing) });
    const timers: Array<{ id: number; ms: number; fn: () => void; live: boolean }> = [];
    let onlineFn: () => void = () => {};
    let visibleFn: () => void = () => {};
    const env: AutoSyncEnv = {
      setTimeout: (fn, ms) => {
        const t = { id: timers.length, ms, fn, live: true };
        timers.push(t);
        return t.id;
      },
      clearTimeout: (id) => {
        timers[id as number].live = false;
      },
      onOnline: (fn) => ((onlineFn = fn), () => {}),
      onVisible: (fn) => ((visibleFn = fn), () => {}),
    };
    const flush = () => new Promise((r) => setImmediate(r));
    const stop = startServerClockAutoSync(clock, env, { intervalMs: 300_000, retryDelaysMs: [2_000, 5_000] });
    await flush();
    assert.equal(syncs, 1, "初回に同期する");
    let t = timers.filter((x) => x.live).at(-1)!;
    assert.equal(t.ms, 2_000, "失敗→2秒後に再試行");
    failing = false;
    t.fn();
    await flush();
    assert.equal(clock.isFresh(), true);
    t = timers.filter((x) => x.live).at(-1)!;
    assert.equal(t.ms, 300_000, "成功→定期再同期を予約");
    const before = syncs;
    onlineFn(); // オフライン復帰
    await flush();
    visibleFn(); // タブ再表示
    await flush();
    assert.equal(syncs, before + 2, "online/visibleで再同期する");
    stop();
    const afterStop = syncs;
    timers.filter((x) => x.live).forEach((x) => x.fn());
    await flush();
    assert.equal(syncs, afterStop, "stop後は同期しない");
    assert.equal(timers.filter((x) => x.live).length, 0);
    console.log("PASS: 自動再同期（初回・バックオフ再試行・定期・online・visible・stop）");
  }

  // 13: 一時停止中はDBのanswering_remaining_msを表示する（時計に依存しない）。
  {
    const live = { answering_paused: true, answering_remaining_ms: 12_345, phase_deadline: null };
    assert.equal(answeringRemainingMs(live, 0), 12_345);
    assert.equal(answeringRemainingMs(live, 9e15), 12_345);
    assert.equal(judgingRemainingMs(null, 1), 0);
    console.log("PASS: 一時停止中はanswering_remaining_msが表示される");
  }

  // 14: 拍手音の計画：端末時計±60秒でも同じ位置。最初のお題と2回目以降で同じ計算。途中入場・終了済み。
  {
    const seMs = 4100;
    const overlap = 2000;
    for (const offset of [0, 60_000, -60_000]) {
      const w = new World();
      w.deviceOffsetMs = offset;
      const clock = makeClock(w);
      await clock.sync();
      for (const round of [1, 2]) {
        const deadlineMs = w.trueMs + 13_000; // 13秒後にお題発表終了
        const plan = planTopicRevealSfx({ deadlineMs, serverNowMs: clock.now(), seMs, overlapMs: overlap });
        assert.equal(plan.kind, "wait", `round${round}: 開始前は待機(端末時計${offset})`);
        if (plan.kind === "wait") near(plan.delayMs, 13_000 - seMs + overlap, 2, "待機時間はサーバー基準");
        w.advance(13_000 + 5_000); // 次ラウンドへ
      }
    }
    const dl = 1_000_000;
    const mid = planTopicRevealSfx({ deadlineMs: dl, serverNowMs: dl - 4100 + 2000 + 1500, seMs: 4100, overlapMs: 2000 });
    assert.equal(mid.kind, "offset");
    if (mid.kind === "offset") near(mid.offsetSec, 1.5, 0.001, "途中入場は経過分から再生");
    assert.equal(planTopicRevealSfx({ deadlineMs: dl, serverNowMs: dl + 10_000, seMs: 4100, overlapMs: 2000 }).kind, "skip");
    console.log("PASS: 拍手音の計画はサーバー時刻基準（±60秒不変・途中入場・終了済みskip）");
  }

  // 15: 司会だけの自動進行。偽DB（真の時刻でdeadlineを判定）を相手に、本番のtryAdvanceAnsweringを実行する。
  {
    const makeDb = (w: World, deadlineOffsetMs: number) => {
      const deadline = w.trueMs + deadlineOffsetMs;
      const db = { phase: "answering", rpcCalls: 0, refetches: 0 };
      const rpc = async () => {
        db.rpcCalls++;
        // DBのnow()（＝真の時刻）だけで判断する。端末時計は一切見ない。
        if (db.phase !== "answering" || w.trueMs < deadline) {
          return { data: { updated: false, live: { id: "L", current_phase: "answering", current_turn_id: "T" } as never }, error: null };
        }
        db.phase = "group_result";
        return { data: { updated: true, live: { id: "L", current_phase: "group_result", current_turn_id: "T" } as never }, error: null };
      };
      return { db, rpc };
    };
    const liveAnswering = { id: "L", current_phase: "answering" as const, current_turn_id: "T" };
    const run = (adv: ReturnType<typeof createAnsweringAdvancer>, w: World, rpc: () => Promise<{ data: { updated: boolean; live: never } | null; error: unknown }>, refetch: () => void) =>
      tryAdvanceAnswering({
        advancer: adv,
        perfNow: w.perfNow,
        minIntervalMs: 1500,
        live: liveAnswering,
        isFrozen: () => false,
        callRpc: rpc as never,
        applyLive: () => {},
        afterAdvanced: async () => refetch(),
      });

    // (a) 司会端末の時計が60秒遅れ・DB締切は到達済み・観客画面なし → RPCが呼ばれ、組結果へ進む。
    {
      const w = new World();
      w.deviceOffsetMs = -60_000;
      const realNow = Date.now;
      Date.now = w.deviceNow; // 端末時計を遅らせる（本番コードがDate.nowを見ていれば止まる）
      try {
        const { db, rpc } = makeDb(w, -1_000);
        const adv = createAnsweringAdvancer();
        const out = await run(adv, w, rpc as never, () => db.refetches++);
        assert.equal(out, "advanced");
        assert.equal(db.phase, "group_result");
      } finally {
        Date.now = realNow;
      }
    }
    // (b) 司会端末の時計が60秒進み・DB締切は未到達 → RPCは呼ばれるがupdated=false、早送りされず全件再取得もしない。
    {
      const w = new World();
      w.deviceOffsetMs = 60_000;
      const realNow = Date.now;
      Date.now = w.deviceNow;
      try {
        const { db, rpc } = makeDb(w, 30_000);
        const adv = createAnsweringAdvancer();
        const out = await run(adv, w, rpc as never, () => db.refetches++);
        assert.equal(out, "noop");
        assert.equal(db.phase, "answering", "DB締切前は端末時計が進んでいても早送りされない");
        assert.equal(db.refetches, 0, "no-opで全件再取得しない");
        // 時間が経ち締切に達したら、次の試行(最小間隔後)で進む。
        w.advance(31_000);
        assert.equal(await run(adv, w, rpc as never, () => db.refetches++), "advanced");
      } finally {
        Date.now = realNow;
      }
    }
    // (c) single-flight＋最小間隔：同時・連打でRPCは増えない。
    {
      const w = new World();
      const { db, rpc } = makeDb(w, 30_000);
      const adv = createAnsweringAdvancer();
      const r = await Promise.all([run(adv, w, rpc as never, () => {}), run(adv, w, rpc as never, () => {})]);
      assert.deepEqual(r.sort(), ["noop", "skipped"]);
      assert.equal(await run(adv, w, rpc as never, () => {}), "skipped", "最小間隔内は呼ばない");
      w.advance(1_600);
      assert.equal(await run(adv, w, rpc as never, () => {}), "noop");
      assert.equal(db.rpcCalls, 2);
    }
    // (d) answering以外・凍結中は呼ばない。
    {
      const w = new World();
      const { db, rpc } = makeDb(w, -1);
      const out = await tryAdvanceAnswering({
        advancer: createAnsweringAdvancer(), perfNow: w.perfNow, minIntervalMs: 0,
        live: { id: "L", current_phase: "group_result", current_turn_id: "T" }, isFrozen: () => false,
        callRpc: rpc as never, applyLive: () => {}, afterAdvanced: async () => {},
      });
      assert.equal(out, "skipped");
      assert.equal(db.rpcCalls, 0);
    }
    console.log("PASS: 司会だけの進行：端末時計が±60秒ずれてもDB締切だけで進み、早送りもされない（single-flight・間隔制御・no-op時は再取得なし）");
  }

  // ===== 5回目レビュー =====
  // 16: 同期前は端末時刻由来の秒数を出さず「同期中」。同期後は約20秒。端末時計±60秒。
  for (const offset of [60_000, -60_000]) {
    const w = new World();
    w.deviceOffsetMs = offset;
    const clock = makeClock(w);
    const deadline = new Date(w.trueMs + 20_000).toISOString();
    const live = { answering_paused: false, answering_remaining_ms: null, phase_deadline: deadline };
    const view = () => ({ now: clock.now(), fresh: clock.isFresh() });
    const before = answeringRemaining(live, view());
    assert.equal(before.syncing, true, `端末時計${offset}：未同期は同期中表示`);
    assert.equal(judgingRemaining(deadline, view()).syncing, true);
    assert.deepEqual(phaseRemainingSeconds(live, view()), { sec: null, syncing: true });
    // 一時停止中のDB残り時間は同期前でも表示できる。
    const paused = { answering_paused: true, answering_remaining_ms: 12_000, phase_deadline: null };
    assert.deepEqual(answeringRemaining(paused, view()), { ms: 12_000, syncing: false });
    assert.equal(clock.nowIfFresh(), null);
    await clock.sync();
    const after = answeringRemaining(live, view());
    assert.equal(after.syncing, false);
    near(after.ms, 20_000, 5, "同期成功後は約20秒");
    assert.deepEqual(phaseRemainingSeconds(live, view()), { sec: 20, syncing: false });
  }
  console.log("PASS: 同期前は誤った秒数を出さず、同期後は約20秒になる（端末時計±60秒）");

  // 17: revision：成功で増え、失敗・古い応答の破棄では増えない。購読者へ成功ごとに通知。
  {
    const w = new World();
    let failing = false;
    const releases: Array<() => void> = [];
    const vals: number[] = [];
    let n = 0;
    const clock = createServerClock({
      perfNow: w.perfNow,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: () => {
        const my = n++;
        if (failing) return Promise.reject(new Error("x"));
        return new Promise<number>((res) => {
          releases[my] = () => res(vals[my]);
        });
      },
    });
    // 状態変化(syncing等)でも通知されるため、revisionが進んだ通知だけを数える。
    let notified = 0;
    let lastRev = 0;
    clock.subscribe(() => {
      if (clock.getRevision() !== lastRev) {
        lastRev = clock.getRevision();
        notified++;
      }
    });
    assert.equal(clock.getRevision(), 0);
    vals[0] = w.trueMs;
    let p = clock.sync();
    releases[0]();
    await p;
    assert.equal(clock.getRevision(), 1, "初回成功でrevision増");
    vals[1] = w.trueMs;
    p = clock.sync({ force: true });
    releases[1]();
    await p;
    assert.equal(clock.getRevision(), 2, "再同期成功でも増える");
    failing = true;
    await clock.sync({ force: true });
    assert.equal(clock.getRevision(), 2, "失敗では増えない");
    failing = false;
    // 古い応答の破棄：先に開始した同期が後から届く。
    vals[3] = w.trueMs - 99_999;
    vals[4] = w.trueMs;
    const older = clock.sync({ force: true }); // n=3
    const newer = clock.sync({ force: true }); // n=4
    releases[4]();
    await newer;
    assert.equal(clock.getRevision(), 3);
    releases[3]();
    assert.equal(await older, false);
    assert.equal(clock.getRevision(), 3, "古い応答の破棄では増えない");
    near(clock.now(), w.trueMs, 1, "最新結果だけが残る");
    assert.equal(notified, 3, "購読者は成功ごとに通知される");
    console.log("PASS: revisionは成功時のみ増え、購読者へ成功ごとに通知される");
  }

  // 18: 拍手音スケジューラ。
  {
    type Timer = { fn: () => void; ms: number; live: boolean };
    const mk = (w: World, clock: ReturnType<typeof makeClock>) => {
      const timers: Timer[] = [];
      const plays: number[] = [];
      const sch = createTopicRevealSfxScheduler({
        nowIfFresh: () => clock.nowIfFresh(),
        setTimeout: (fn, ms) => {
          const t: Timer = { fn: () => ((t.live = false), fn()), ms, live: true };
          timers.push(t);
          return timers.length - 1;
        },
        clearTimeout: (id) => {
          timers[id as number].live = false;
        },
        play: (o) => plays.push(o),
        seMs: 4100,
        overlapMs: 2000,
      });
      const active = () => timers.filter((t) => t.live);
      return { sch, plays, timers, active };
    };
    // (a) 未同期では予約せず、初回同期後に正しい時刻で予約される。
    {
      const w = new World();
      w.deviceOffsetMs = 60_000;
      const clock = makeClock(w);
      const { sch, plays, active } = mk(w, clock);
      const dl = new Date(w.trueMs + 13_000).toISOString();
      sch.update(dl);
      assert.equal(active().length, 0, "未同期では予約しない");
      await clock.sync();
      sch.update(dl);
      assert.equal(active().length, 1);
      near(active()[0].ms, 13_000 - 4100 + 2000, 2, "サーバー基準の待ち時間");
      // (b) 再同期で補正が変わったら未再生予約が作り直される。
      w.advance(3_000);
      await clock.sync({ force: true });
      sch.update(dl);
      assert.equal(active().length, 1, "予約は1本だけ（古い予約は取り消し）");
      near(active()[0].ms, 13_000 - 4100 + 2000 - 3_000, 2, "再計算された待ち時間");
      // (c) バックグラウンドでタイマー発火が遅れた（開始時刻を1.5秒過ぎて発火）→ 先頭再生せず途中再生。
      w.advance(active()[0].ms + 1_500);
      active()[0].fn();
      assert.equal(plays.length, 1);
      near(plays[0], 1.5, 0.01, "遅延発火は途中位置から");
      // (d) 再生済みは再同期・再updateでも二重再生しない。
      await clock.sync({ force: true });
      sch.update(dl);
      sch.update(dl);
      assert.equal(plays.length, 1);
      assert.equal(active().length, 0);
      // (e) 新しいdeadline（次のお題発表）では再度1回だけ。
      w.advance(20_000);
      const dl2 = new Date(w.trueMs + 13_000).toISOString();
      sch.update(dl2);
      assert.equal(active().length, 1);
      w.advance(active()[0].ms + 1);
      active()[0].fn();
      assert.equal(plays.length, 2);
      near(plays[1], 0.001, 0.0011, "新しいお題は（ほぼ）先頭から");
      sch.update(dl2);
      assert.equal(plays.length, 2);
    }
    // (f) 発火時にまだ早ければ再予約する。
    {
      const w = new World();
      const clock = makeClock(w);
      await clock.sync();
      const { sch, plays, active } = mk(w, clock);
      const dl = new Date(w.trueMs + 13_000).toISOString();
      sch.update(dl);
      const first = active()[0];
      w.advance(first.ms - 800); // 早めに発火した（ずれ）
      first.fn();
      assert.equal(plays.length, 0);
      assert.equal(active().length, 1, "残り時間で再予約");
      near(active()[0].ms, 800, 2, "再予約の待ち時間");
    }
    // (g) 尺以上に遅れていたらskip。途中入場は途中再生。リロード相当（新規生成）でも同様。
    {
      const w = new World();
      const clock = makeClock(w);
      await clock.sync();
      const { sch, plays, active } = mk(w, clock);
      sch.update(new Date(w.trueMs - 3_000).toISOString());
      assert.equal(plays.length, 0);
      assert.equal(active().length, 0);
      const m = mk(w, clock);
      m.sch.update(new Date(w.trueMs + 4_100 - 2_000 - 1_000).toISOString()); // 開始時刻を1秒過ぎている
      near(m.plays[0], 1.0, 0.01, "途中入場は途中から");
    }
    // (h) アンマウント（dispose）後は再生しない。
    {
      const w = new World();
      const clock = makeClock(w);
      await clock.sync();
      const { sch, plays, active } = mk(w, clock);
      sch.update(new Date(w.trueMs + 13_000).toISOString());
      const t = active()[0];
      sch.dispose();
      assert.equal(active().length, 0, "dispose時にタイマー解除");
      t.fn();
      assert.equal(plays.length, 0);
    }
    // (i) 初回のお題と2回目以降で同じ結果。
    {
      const w = new World();
      const clock = makeClock(w);
      await clock.sync();
      const { sch, active } = mk(w, clock);
      const waits: number[] = [];
      for (let round = 0; round < 2; round++) {
        sch.update(new Date(w.trueMs + 13_000).toISOString());
        waits.push(active().at(-1)!.ms);
        w.advance(13_000);
        active().at(-1)!.fn();
        w.advance(5_000);
      }
      near(waits[0], waits[1], 1, "1回目と2回目以降で同じ待ち時間");
    }
    console.log("PASS: 拍手音スケジューラ（初回同期後予約・再同期で再予約・遅延発火は途中再生・発火時再判定・二重再生なし・新deadlineで再度1回・skip・dispose）");
  }

  // ===== 6回目レビュー：時計の鮮度 =====
  // 21: unsynced→syncing→fresh。stale中はnowIfFreshがnullで残り秒数を出さない。
  {
    const w = new World();
    const pending: Array<() => void> = [];
    let fetches = 0;
    const clock = createServerClock({
      perfNow: w.perfNow,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: () => {
        fetches++;
        return new Promise<number>((res) => pending.push(() => res(w.trueMs)));
      },
    });
    const seen: string[] = [];
    clock.subscribe(() => seen.push(clock.getStatus()));
    assert.equal(clock.getStatus(), "unsynced");
    const p1 = clock.sync();
    assert.equal(clock.getStatus(), "syncing", "初回同期中はsyncing");
    pending[0]();
    await p1;
    assert.equal(clock.getStatus(), "fresh");
    assert.deepEqual(seen, ["syncing", "fresh"]);
    const deadline = new Date(w.trueMs + 20_000).toISOString();
    const live = { answering_paused: false, answering_remaining_ms: null, phase_deadline: deadline };
    const view = () => ({ now: clock.now(), fresh: clock.isFresh() });

    // 連続イベント：visible/pageshow/online相当。再同期前にstale化し、同期は1本に合流する。
    type T = { fn: () => void };
    let onlineFn = () => {};
    let visibleFn = () => {};
    const env: AutoSyncEnv = {
      setTimeout: () => 0,
      clearTimeout: () => {},
      onOnline: (fn) => ((onlineFn = fn), () => {}),
      onVisible: (fn) => ((visibleFn = fn), () => {}),
    };
    void ({} as T);
    const before = fetches;
    const stop = startServerClockAutoSync(clock, env); // 再入場：古いアンカーをfreshのまま使わない
    assert.equal(clock.isFresh(), false, "再入場時にstale化");
    assert.equal(clock.nowIfFresh(), null);
    assert.equal(clock.hasAnchor(), true, "stale中もアンカーは保持");
    assert.equal(answeringRemaining(live, view()).syncing, true, "stale中は残り秒数を出さない");
    assert.equal(fetches, before + 1);
    for (let i = 0; i < 5; i++) {
      visibleFn();
      onlineFn(); // pageshow/online
    }
    assert.equal(fetches, before + 1, "連続イベントでも同期は増えない（single-flight）");
    // 復帰時に、再同期の完了前からstaleである。
    assert.equal(clock.getStatus(), "syncing");
    assert.equal(clock.nowIfFresh(), null);
    w.advance(30_000); // スリープしていた間に30秒経過（performance.nowは追従しない想定は別テスト）
    pending[pending.length - 1]();
    await new Promise((r) => setImmediate(r));
    assert.equal(clock.getStatus(), "fresh", "再同期成功でfreshへ戻る");
    stop();
    console.log("PASS: 時計の鮮度（unsynced→syncing→fresh、再入場・visible・pageshow・online相当でstale化、連続イベントでも同期は1本）");
  }

  // 22: 再同期失敗時はstaleのまま。進行RPCは動く。購読解除後は通知されない。
  {
    const w = new World();
    let failing = false;
    const clock = makeClock(w, { fail: () => failing });
    await clock.sync();
    let notified = 0;
    const off = clock.subscribe(() => notified++);
    clock.markStale();
    assert.equal(clock.getStatus(), "stale");
    failing = true;
    assert.equal(await clock.sync(), false);
    assert.equal(clock.getStatus(), "stale", "失敗時はstaleのまま");
    assert.equal(clock.nowIfFresh(), null);
    const live = { answering_paused: false, answering_remaining_ms: null, phase_deadline: new Date(w.trueMs + 20_000).toISOString() };
    assert.equal(answeringRemaining(live, { now: clock.now(), fresh: clock.isFresh() }).syncing, true, "失敗中に誤った秒数を出さない");
    let rpc = 0;
    const out = await tryAdvanceAnswering({
      advancer: createAnsweringAdvancer(), perfNow: w.perfNow, minIntervalMs: 0,
      live: { id: "L", current_phase: "answering", current_turn_id: "T" }, isFrozen: () => false,
      callRpc: (async () => (rpc++, { data: { updated: false, live: null }, error: null })) as never,
      applyLive: () => {}, afterAdvanced: async () => {},
    });
    assert.equal(out, "noop");
    assert.equal(rpc, 1, "stale中でも進行RPCは呼ばれる");
    failing = false;
    assert.equal(await clock.sync(), true);
    assert.equal(clock.getStatus(), "fresh");
    off();
    const n = notified;
    clock.markStale();
    assert.equal(notified, n, "購読解除後は通知しない");
    console.log("PASS: 再同期失敗時はstaleのまま・誤った秒数を出さず・進行RPCは動く");
  }

  // 23: stale化より前に始まった同期の応答は破棄され、新しい同期の結果だけがfreshになる。
  {
    const w = new World();
    const rel: Array<() => void> = [];
    const vals: number[] = [];
    let n = 0;
    const clock = createServerClock({
      perfNow: w.perfNow,
      fallbackNow: w.deviceNow,
      fetchServerEpochMs: () => {
        const my = n++;
        return new Promise<number>((res) => (rel[my] = () => res(vals[my])));
      },
    });
    vals[0] = w.trueMs;
    const first = clock.sync();
    rel[0]();
    await first; // fresh
    vals[1] = w.trueMs - 40_000; // 定期同期中（スリープ跨ぎで値が古い想定の応答）
    const periodic = clock.sync({ force: true });
    clock.markStale(); // スリープ復帰
    vals[2] = w.trueMs;
    const resync = clock.sync(); // taintedな進行中には合流せず新規
    assert.equal(n, 3);
    rel[1]();
    assert.equal(await periodic, false, "stale化前の応答は破棄");
    assert.equal(clock.isFresh(), false);
    rel[2]();
    assert.equal(await resync, true);
    near(clock.now(), w.trueMs, 1, "新しい同期結果だけが反映される");
    console.log("PASS: stale化前に始まった同期の応答は破棄される");
  }

  // 24: 拍手音スケジューラはstale中に予約・再生・skip確定をしない。
  {
    const w = new World();
    const clock = makeClock(w);
    await clock.sync();
    type Timer = { fn: () => void; ms: number; live: boolean };
    const timers: Timer[] = [];
    const plays: number[] = [];
    const sch = createTopicRevealSfxScheduler({
      nowIfFresh: () => clock.nowIfFresh(),
      setTimeout: (fn, ms) => {
        const t: Timer = { fn: () => ((t.live = false), fn()), ms, live: true };
        timers.push(t);
        return timers.length - 1;
      },
      clearTimeout: (id) => (timers[id as number].live = false),
      play: (o) => plays.push(o),
      seMs: 4100,
      overlapMs: 2000,
    });
    const active = () => timers.filter((t) => t.live);
    const dl = new Date(w.trueMs + 13_000).toISOString();
    sch.update(dl);
    assert.equal(active().length, 1);
    // スリープ→復帰：時計がstale化される。
    clock.markStale();
    sch.update(dl); // stale通知に伴う再評価：予約は取り消され、確定もしない
    assert.equal(active().length, 0, "stale中は予約しない");
    // 実時間は締切を大きく過ぎているが、stale中は skip 確定しない。
    w.advance(60_000);
    sch.update(dl);
    assert.equal(plays.length, 0);
    // 既存タイマーがstale中に発火しても、再生もskip確定もしない。
    const sch2Timers = timers.length;
    void sch2Timers;
    // 再同期成功後にfreshで再評価：締切を過ぎているのでskip（再生しない）
    await clock.sync({ force: true });
    sch.update(dl);
    assert.equal(plays.length, 0, "尺以上遅れていればskip");
    assert.equal(active().length, 0);
    // 別のdeadlineで、stale中に発火したタイマーが確定しないこと。
    const dl2 = new Date(w.trueMs + 13_000).toISOString();
    sch.update(dl2);
    const t = active()[0];
    clock.markStale();
    t.fn(); // stale中の発火
    assert.equal(plays.length, 0);
    assert.equal(active().length, 0, "stale中の発火で再予約もしない");
    w.advance(13_000 - 4100 + 2000 + 1000);
    await clock.sync({ force: true });
    sch.update(dl2); // fresh通知後に再評価：1秒遅れ→途中再生
    assert.equal(plays.length, 1);
    near(plays[0], 1.0, 0.01, "freshへ戻った後に途中再生");
    sch.update(dl2);
    assert.equal(plays.length, 1, "再生済みは二重再生しない");
    console.log("PASS: 拍手音はstale中に予約・再生・skip確定をせず、fresh復帰後に再評価する");
  }

  // ===== 6・7回目レビュー：BGM補正・再生開始 =====
  // audioManagerと同じ分岐（activateBgmの同一曲再開分岐・startWhenReady・setBgmEnabled・stop・
  // correctBgmPosition）を、本番と同じ純粋関数（bgmStartIntent / bgmStartPlan / bgmCorrection）
  // で組み立てた状態機械で検証する。Web Audio本体の代わりに、attemptStart/fadeを記録する
  // バックエンドを持つ。単調増加時計(perf)はテストが制御する。
  {
    class Engine {
      perf = 1_000;
      intent = createBgmStartIntent(() => this.perf);
      enabled = true;
      currentName: string | null = null;
      loading = false; // デコード/メタデータ未完了
      duration = 100_000;
      playing = false;
      pos = 0; // 再生中は開始時のオフセット+経過（簡易）。停止時は停止位置
      startedAt = 0;
      starts: number[] = []; // attemptStartに渡したオフセット(ms)
      fades = 0;
      seeks: number[] = [];
      loadBgLoading = false;
      pendingLoads: Array<() => void> = [];
      tick(ms: number) {
        this.perf += ms;
      }
      curPos() {
        return this.playing ? (this.pos + (this.perf - this.startedAt)) % this.duration : this.pos;
      }
      attemptStart(offsetMs: number) {
        this.starts.push(offsetMs);
        this.pos = offsetMs;
        this.startedAt = this.perf;
        this.playing = true;
      }
      fadeIn() {
        this.fades++;
      }
      pause() {
        if (!this.playing) return;
        this.pos = this.curPos();
        this.playing = false;
      }
      playBgm(name: string, startAtMs?: number) {
        this.intent.request(name, startAtMs);
        if (this.enabled) this.activate(name);
      }
      activate(name: string) {
        if (this.currentName === name) {
          // 同じ曲：停止中なら意図(intent)の今の有効位置から再開する。
          if (!this.playing && !this.loading) {
            const off = resolveBgmOffsetSec(
              this.intent.name === name ? this.intent.startAtMs : undefined,
              this.duration / 1000,
              this.pos / 1000,
            );
            this.attemptStart(off * 1000);
          }
          this.fadeIn();
          return;
        }
        const gen = this.intent.gen;
        this.currentName = name;
        this.loadBgLoading = true;
        const startWhenReady = () => {
          const d = decideBgmStart({
            intentCurrent: this.intent.isCurrent(gen),
            nameMatches: this.intent.name === name,
            enabled: this.enabled, // 完了時にも最新のON/OFFを確認する
            alreadyPlaying: this.playing,
          });
          if (d === "skip_stale") return;
          if (d !== "start") {
            this.loadBgLoading = false;
            return;
          }
          const off = resolveBgmOffsetSec(this.intent.startAtMs, this.duration / 1000, 0);
          this.attemptStart(off * 1000);
          this.fadeIn();
          this.loadBgLoading = false;
        };
        if (this.loading) this.pendingLoads.push(startWhenReady);
        else startWhenReady();
      }
      setEnabled(v: boolean) {
        this.enabled = v;
        if (v) {
          if (this.intent.name) this.activate(this.intent.name);
        } else {
          this.pause();
        }
      }
      finishLoad() {
        this.loading = false;
        const l = this.pendingLoads;
        this.pendingLoads = [];
        l.forEach((f) => f());
      }
      stop() {
        this.intent.clear();
        this.currentName = null;
        this.pause();
      }
      correct(name: string, target: number, tol = 1500): BgmCorrectionResult {
        const cur = this.currentName === name;
        const d = decideBgmCorrection(
          {
            plannedName: this.intent.name,
            enabled: this.enabled,
            currentName: this.currentName,
            loading: this.loading,
            position: cur && !this.loading ? { durationMs: this.duration, currentPosMs: this.curPos() } : null,
          },
          name,
          target,
          tol,
        );
        if (d.effect === "seek") {
          this.pos = target % this.duration;
          this.startedAt = this.perf;
          this.seeks.push(target);
        }
        if (d.result === "corrected" || d.result === "within_tolerance" || d.result === "queued") {
          this.intent.updateStart(name, target);
        }
        return d.result;
      }
    }
    const input = (over: Partial<Parameters<ReturnType<typeof createBgmSyncPlanner>["plan"]>[0]> = {}) => ({
      key: "answering|T1", deadline: "d1", fresh: true, revision: 1, gaveUp: false, elapsedMs: 30_000 as number | null, ...over,
    });
    const drive = (pl: ReturnType<typeof createBgmSyncPlanner>, e: Engine, i: ReturnType<typeof input>) => {
      const a: BgmSyncAction = pl.plan(i);
      let r: BgmCorrectionResult | undefined;
      if (a.kind === "play") e.playBgm("live", a.startAtMs);
      else if (a.kind === "seek") r = e.correct("live", a.startAtMs);
      pl.ack(a, r);
      return { a, r };
    };

    // fresh前は待つ／3秒待って同期できない時は先頭から暫定再生。
    {
      const pl = createBgmSyncPlanner();
      const e = new Engine();
      assert.equal(drive(pl, e, input({ fresh: false, elapsedMs: null })).a.kind, "wait");
      assert.equal(e.starts.length, 0);
      drive(pl, e, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      assert.deepEqual(e.starts, [0], "端末時計由来の途中位置を使わず先頭から");
    }
    // 補正：暫定再生→同期後corrected→同revisionで二度補正しない→許容内は再スタートしない。
    {
      const pl = createBgmSyncPlanner();
      const e = new Engine();
      drive(pl, e, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 40_000 })).r, "corrected");
      assert.deepEqual(e.seeks, [40_000]);
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 40_500 })).a.kind, "none");
      const r2 = drive(pl, e, input({ revision: 3, elapsedMs: e.curPos() + 500 }));
      assert.equal(r2.r, "within_tolerance");
      assert.equal(e.seeks.length, 1, "許容範囲内は再スタートしない");
      assert.equal(drive(pl, e, input({ revision: 3, elapsedMs: 41_800 })).a.kind, "none", "within_toleranceでもrevision完了");
    }
    // T1: 読込中にOFFにし、読込完了しても再生・フェードインされない。
    // T2: 読込完了後にONにすると、その時点の正しい位置から1回だけ再生。
    {
      const e = new Engine();
      e.loading = true;
      e.playBgm("live", 0);
      e.tick(1_000);
      e.setEnabled(false); // 読込中にOFF
      e.tick(1_000);
      e.finishLoad(); // 読込完了
      assert.equal(e.starts.length, 0, "OFF中は読込完了しても再生しない");
      assert.equal(e.fades, 0, "OFF中はフェードインもしない");
      assert.equal(e.playing, false);
      assert.equal(e.loadBgLoading, false, "bgmLoadingが残らない");
      e.tick(6_000);
      e.setEnabled(true);
      assert.equal(e.starts.length, 1, "ONで1回だけ再生");
      near(e.starts[0], 8_000, 5, "OFFのまま経過した時間ぶん進んだ位置から（0秒へ戻らない）");
      e.setEnabled(true);
      assert.equal(e.starts.length, 1, "ONを繰り返しても二重再生しない");
    }
    // T3: OFFのまま3秒地点でqueued→20秒後にON→約23秒地点。
    {
      const pl = createBgmSyncPlanner();
      const e = new Engine();
      e.enabled = false;
      drive(pl, e, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      const r = drive(pl, e, input({ revision: 2, elapsedMs: 3_000 }));
      assert.equal(r.r, "queued");
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 3_100 })).a.kind, "none", "queuedでrevision完了");
      e.tick(20_000);
      e.setEnabled(true);
      near(e.starts[0], 23_000, 5, "queued位置＋待機時間");
    }
    // T4: 10秒地点でqueued（読込中）→5秒後に読込完了→約15秒地点。
    {
      const pl = createBgmSyncPlanner();
      const e = new Engine();
      e.loading = true;
      drive(pl, e, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 10_000 })).r, "queued");
      e.tick(5_000);
      e.finishLoad();
      near(e.starts[0], 15_000, 5, "読込にかかった時間ぶん加算");
      assert.equal(e.starts.length, 1);
    }
    // 曲長に対するmodulo。
    {
      const e = new Engine();
      e.duration = 30_000;
      e.playBgm("live", 25_000);
      e.tick(10_000);
      e.setEnabled(false);
      e.tick(5_000);
      e.setEnabled(true);
      near(e.starts[1], (25_000 + 15_000) % 30_000, 5, "modulo処理を維持");
    }
    // T5: 同じ曲をON→OFF→時間経過→ONしても、古い停止位置や0秒へ戻らない。
    {
      const e = new Engine();
      e.playBgm("live", 30_000);
      e.tick(4_000);
      e.setEnabled(false);
      const stopPos = e.pos;
      near(stopPos, 34_000, 5, "停止位置");
      e.tick(10_000);
      e.setEnabled(true);
      near(e.starts.at(-1)!, 44_000, 5, "停止位置(34秒)でも0秒でもなく、経過を加算した位置");
    }
    // T6: 素早いOFF→ONでも二重再生しない（読込中）。
    {
      const e = new Engine();
      e.loading = true;
      e.playBgm("live", 5_000);
      e.setEnabled(false);
      e.setEnabled(true);
      e.setEnabled(false);
      e.setEnabled(true);
      e.finishLoad();
      assert.equal(e.starts.length, 1, "二重再生しない");
    }
    // T7: OFF中に別の曲へ変えたら、古い曲の読込完了では鳴らない。
    {
      const e = new Engine();
      e.loading = true;
      e.playBgm("A", 5_000);
      e.setEnabled(false);
      e.playBgm("B", 1_000); // OFF中の要求（intentのみ更新）
      e.finishLoad();
      assert.equal(e.starts.length, 0);
      e.loading = false;
      e.setEnabled(true);
      assert.equal(e.currentName, "B");
      assert.equal(e.starts.length, 1);
      near(e.starts[0], 1_000, 5, "Bの位置から");
    }
    // T8: stop・ページ離脱後に読込が完了しても鳴らない。
    {
      const e = new Engine();
      e.loading = true;
      e.playBgm("live", 3_000);
      e.stop();
      e.finishLoad();
      assert.equal(e.starts.length, 0);
    }
    // T9: not_ready・wrong_trackはack完了扱いにせず再試行できる。
    {
      const pl = createBgmSyncPlanner();
      const e = new Engine();
      drive(pl, e, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      e.currentName = null; // 有効だがまだ曲が確定していない
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 25_000 })).r, "not_ready");
      assert.equal(pl.plan(input({ revision: 2, elapsedMs: 25_000 })).kind, "seek", "not_readyはrevisionを消費しない");
      e.currentName = "live";
      e.pos = 0;
      e.playing = true;
      e.startedAt = e.perf;
      assert.equal(drive(pl, e, input({ revision: 2, elapsedMs: 25_000 })).r, "corrected");
      // wrong_track
      const pl2 = createBgmSyncPlanner();
      const e2 = new Engine();
      drive(pl2, e2, input({ fresh: false, elapsedMs: null, gaveUp: true }));
      e2.stop();
      e2.playBgm("other", 0);
      assert.equal(e2.correct("live", 20_000), "wrong_track");
      assert.equal(e2.seeks.length, 0, "別曲をシークしない");
      const a = pl2.plan(input({ revision: 2, elapsedMs: 20_000 }));
      pl2.ack(a, "wrong_track");
      assert.equal(pl2.plan(input({ revision: 2, elapsedMs: 20_000 })).kind, "seek");
    }
    // T10: 完了条件（queued/corrected/within_tolerance）で完了、他は未完了（上で個別確認済み）。
    {
      const pl = createBgmSyncPlanner();
      for (const [res, done] of [["corrected", true], ["within_tolerance", true], ["queued", true], ["not_ready", false], ["wrong_track", false]] as const) {
        const p2 = createBgmSyncPlanner();
        p2.ack(p2.plan(input({ fresh: false, elapsedMs: null, gaveUp: true })), undefined);
        const a = p2.plan(input({ revision: 2, elapsedMs: 9_000 }));
        p2.ack(a, res);
        assert.equal(p2.plan(input({ revision: 2, elapsedMs: 9_000 })).kind === "none", done, `${res}の完了判定`);
      }
      void pl;
    }
    // T11: 世代の古い非同期完了が最新曲を上書きしない／同じ曲の再要求では無効化されない。
    {
      const e = new Engine();
      e.loading = true;
      e.playBgm("A", 5_000);
      e.playBgm("A", 6_000);
      e.playBgm("B", 1_000);
      e.finishLoad();
      assert.equal(e.starts.length, 1);
      near(e.starts[0], 1_000, 5, "古い曲Aの完了はBを上書きしない");
      const e2 = new Engine();
      e2.loading = true;
      e2.playBgm("A", 5_000);
      e2.playBgm("A", 6_000);
      e2.finishLoad();
      near(e2.starts[0], 6_000, 5, "同じ曲の再要求では最新の位置で開始");
      const pl = createBgmSyncPlanner();
      const a = pl.plan(input({ key: "group_result|T1", deadline: "d9", elapsedMs: 700 }));
      assert.deepEqual(a, { kind: "play", startAtMs: 700, revision: 1, provisional: false });
    }
    // intentは端末の絶対時刻(Date.now)に依存しない。
    {
      const realNow = Date.now;
      let perf = 0;
      const it = createBgmStartIntent(() => perf);
      it.request("x", 1_000);
      Date.now = () => realNow() + 3_600_000; // 端末時計を1時間進める
      perf += 2_000;
      assert.equal(it.startAtMs, 3_000);
      Date.now = realNow;
    }
    console.log("PASS: BGM（OFF中の読込完了で鳴らない・queued位置に経過時間を加算・OFF→ON再開・二重再生なし・世代管理・ack条件・Date.now非依存）");
  }

  // ===== 8・9回目レビュー：自動再生制限後の再開(retryCurrentBgm)とHTMLAudioフォールバック =====
  // audioManagerのretryCurrentBgm / attemptStartBgm / 同一曲再開と同じ分岐・同じ処理順を、
  // 本番と同じ純粋関数(decideBgmRetry/resolveBgmOffsetSec/resolveFallbackSeekSec/decideBgmStart/intent)で
  // 再現する。偽AudioContext：resume()を呼んだ瞬間にrunningになる（suspended中は時間が止まる）。
  // 偽HTMLAudioElement：自動再生制限を模し、ユーザー操作中に呼ばれたplay()だけ成功する。
  {
    let inGesture = false;
    class FakeAudioEl {
      duration = NaN;
      currentTime = 0;
      paused = true;
      plays = 0;
      autoplayBlocked = false; // trueなら、ユーザー操作外のplay()は拒否される
      forceReject = false;
      listeners: Array<() => void> = [];
      addEventListener(_t: string, fn: () => void) {
        this.listeners.push(fn);
      }
      play() {
        this.plays++;
        if (this.forceReject || (this.autoplayBlocked && !inGesture)) return Promise.reject(new Error("blocked"));
        this.paused = false;
        return Promise.resolve();
      }
      loadMeta(d: number) {
        this.duration = d;
        const l = this.listeners;
        this.listeners = [];
        l.forEach((f) => f());
      }
    }
    class Player {
      perf = 0;
      intent = createBgmStartIntent(() => this.perf);
      enabled = true;
      current: string | null = null;
      lastName = "live";
      needsResume = false;
      webAudio: boolean;
      ctxRunning = false;
      ctxTime = 0; // suspended中は進まない
      sourceStarts: number[] = [];
      sources = 0;
      isPlaying = false;
      offsetAtStart = 0;
      ctxAtStart = 0;
      duration = 100_000;
      els = new Map<string, FakeAudioEl>([["live", new FakeAudioEl()]]);
      metaHolders = new Map<string, { metadataWaiting?: boolean }>();
      holder(name: string) {
        if (!this.metaHolders.has(name)) this.metaHolders.set(name, {});
        return this.metaHolders.get(name)!;
      }
      constructor(webAudio: boolean) {
        this.webAudio = webAudio;
      }
      get el(): FakeAudioEl {
        return this.els.get(this.current ?? this.lastName)!;
      }
      elOf(name: string) {
        if (!this.els.has(name)) this.els.set(name, new FakeAudioEl());
        return this.els.get(name)!;
      }
      tick(ms: number) {
        this.perf += ms;
        if (this.ctxRunning) this.ctxTime += ms;
      }
      paused() {
        return this.webAudio ? !this.isPlaying : this.el.paused;
      }
      offsetSec() {
        if (!this.webAudio) return this.el.currentTime;
        if (!this.isPlaying) return this.offsetAtStart;
        return ((this.offsetAtStart * 1000 + (this.ctxTime - this.ctxAtStart)) % this.duration) / 1000;
      }
      startSource(offsetSec: number) {
        this.sources = 1; // 既存sourceは停止して置き換える（二重sourceにならない）
        this.sourceStarts.push(offsetSec * 1000);
        this.offsetAtStart = offsetSec;
        this.ctxAtStart = this.ctxTime;
        this.isPlaying = true;
      }
      // attemptStartBgm(Web Audio)のresume：running済みならneedsResume解除。suspendedなら
      // ユーザー操作中のresumeだけ成功して即running、操作外は失敗（needsResume=true）。
      resumeInAttempt() {
        if (this.ctxRunning) this.needsResume = false;
        else if (inGesture) {
          this.ctxRunning = true;
          this.needsResume = false;
        } else this.needsResume = true;
      }
      attemptStart(offsetSec: number, userGesture = false) {
        if (!this.webAudio) {
          const name = this.current!;
          const el = this.elOf(name);
          const play = () => {
            el.play().then(() => (this.needsResume = false)).catch(() => (this.needsResume = true));
          };
          const seek = resolveFallbackSeekSec(offsetSec, el.duration);
          if (seek !== null) {
            el.currentTime = seek;
            play();
            return;
          }
          if (userGesture) play(); // ユーザー操作内で同期的にplay()
          // 本番(audioManager)と同じ共通関数：待機フラグの確認・trueへの設定を登録の前に行う。
          registerMetadataListenerOnce(
            this.holder(name),
            (onLoaded) => el.addEventListener("loadedmetadata", onLoaded),
            () => {
              if (this.current !== name) return; // 曲変更・stop後の古いイベントは無視
              if (
                decideBgmStart({
                  intentCurrent: this.intent.name !== null,
                  nameMatches: this.intent.name === this.current,
                  enabled: this.enabled,
                  alreadyPlaying: false,
                }) !== "start"
              ) return;
              const latest = resolveFallbackSeekSec(
                resolveBgmOffsetSec(this.intent.startAtMs, el.duration, offsetSec),
                el.duration,
              );
              if (latest !== null) el.currentTime = latest;
              if (el.paused) play(); // 既に再生中なら二重playしない
            },
          );
          return;
        }
        this.startSource(offsetSec);
        this.resumeInAttempt();
      }
      resumeAudioContext() {
        this.ctxRunning = true; // resume()を呼んだ瞬間にrunningになる偽ctx
      }
      // audioManagerのretryCurrentBgmと同じ処理順：
      //   1) resume前の状態で再開要否を判定 → 2) 必要なら最新位置から作り直す → 3) resume
      retry() {
        inGesture = true;
        try {
          const cur = this.current;
          const decision = cur
            ? decideBgmRetry({
                enabled: this.enabled,
                hasCurrent: true,
                paused: this.paused(),
                webAudioStalled: this.webAudio && this.isPlaying && !this.ctxRunning,
              })
            : "skip";
          if (decision === "restart" && cur) {
            const dur = this.webAudio ? this.duration / 1000 : this.el.duration;
            const fallbackSec = this.offsetSec();
            this.attemptStart(
              this.intent.name === cur ? resolveBgmOffsetSec(this.intent.startAtMs, dur, fallbackSec) : fallbackSec,
              true,
            );
          }
          this.resumeAudioContext();
        } finally {
          inGesture = false;
        }
      }
      play(name: string, start?: number) {
        this.intent.request(name, start);
        if (!this.enabled) return;
        this.current = name;
        this.lastName = name;
        this.attemptStart((this.intent.startAtMs ?? 0) / 1000); // 自動開始：ユーザー操作ではない
      }
      stop() {
        this.intent.clear();
        this.current = null;
        this.isPlaying = false;
        this.els.forEach((e) => (e.paused = true));
      }
    }
    const flush = () => new Promise((r) => setImmediate(r));

    // ---- Web Audio ----
    // 1)〜4) suspended・isPlaying=true・resumeで即running：それでも最新位置から作り直し、二重sourceにならない。
    {
      const p = new Player(true);
      p.play("live", 5_000);
      assert.equal(p.isPlaying, true, "suspendedでもsourceは作成済み(isPlaying=true)");
      assert.equal(p.needsResume, true, "自動再生制限：needsAudioResume=true");
      p.tick(10_000);
      near(p.offsetSec() * 1000, 5_000, 1, "従来の位置はctx停止で古いまま");
      p.retry();
      near(p.sourceStarts.at(-1)!, 15_000, 5, "resume前の状態でstalledと判定→最新位置から作り直し");
      assert.equal(p.sources, 1, "古いsourceは置き換えられ二重にならない");
      assert.equal(p.ctxRunning, true);
      assert.equal(p.needsResume, false, "成功時はneedsAudioResume=false");
    }
    // 5) 正常再生中のタップでは再スタートしない。6) 連打でsourceが増殖しない。
    {
      const p = new Player(true);
      p.ctxRunning = true;
      p.play("live", 5_000);
      const n = p.sourceStarts.length;
      p.tick(3_000);
      p.retry();
      p.retry();
      assert.equal(p.sourceStarts.length, n, "正常再生中は再スタートしない");
      const q = new Player(true);
      q.play("live", 1_000);
      q.tick(2_000);
      for (let i = 0; i < 5; i++) q.retry();
      assert.equal(q.sources, 1);
      assert.equal(q.sourceStarts.length, 2, "作り直しは最初のタップの1回だけ");
    }
    // 7) needsAudioResume：ユーザー操作外の自動開始で失敗(true)、操作内のresumeで成功(false)。
    {
      const p = new Player(true);
      p.play("live", 0);
      assert.equal(p.needsResume, true);
      p.retry();
      assert.equal(p.needsResume, false);
    }
    // OFF・stop・currentなし：再生しない。ただしctxのアンロックは維持。
    {
      const p = new Player(true);
      p.play("live", 5_000);
      p.enabled = false;
      p.isPlaying = false;
      const n = p.sourceStarts.length;
      p.retry();
      assert.equal(p.sourceStarts.length, n, "OFF中は再生しない");
      const q = new Player(true);
      q.play("live", 5_000);
      q.stop();
      const m = q.sourceStarts.length;
      q.retry();
      assert.equal(q.sourceStarts.length, m, "stop後は再生しない");
      assert.equal(q.ctxRunning, true, "currentなしでもAudioContextはアンロックされる");
    }
    // intentとcurrentの曲が異なる場合、古い位置を使わない。
    {
      const p = new Player(true);
      p.play("live", 50_000);
      p.intent.request("other", 90_000);
      p.isPlaying = false;
      p.offsetAtStart = 7;
      p.retry();
      near(p.sourceStarts.at(-1)!, 7_000, 1, "古いintent位置(50秒)ではなく従来の停止位置");
    }

    // ---- HTMLAudioElement（自動再生制限：ユーザー操作中のplay()だけ成功）----
    // 1)2)3)4) duration未取得でタップ→その操作中にplay()、metadata後に最新位置へseek、二重playなし。
    {
      const f = new Player(false);
      f.el.autoplayBlocked = true;
      f.play("live", 10_000); // 自動開始（ユーザー操作外）
      assert.equal(f.el.plays, 0, "メタデータ前の自動開始はplayしない");
      await flush();
      f.tick(2_000);
      f.retry(); // ユーザーのタップ
      assert.equal(f.el.plays, 1, "ユーザー操作中に同期的にplay()を試す");
      await flush();
      assert.equal(f.el.paused, false, "操作中のplay()は成功する");
      assert.equal(f.needsResume, false);
      assert.equal(f.el.listeners.length, 1, "リスナーは重複登録しない");
      f.tick(3_000);
      f.el.loadMeta(100); // メタデータ取得（操作の外）
      near(f.el.currentTime * 1000, 15_000, 5, "取得時点の最新位置（10秒＋経過5秒）へseek");
      assert.equal(f.el.plays, 1, "既に再生中なので二重play()しない");
    }
    // 5)6) 待機中の再タップが無視されない／最初のplayが失敗しても次のタップで再試行できる。
    {
      const f = new Player(false);
      f.play("live", 1_000);
      f.el.forceReject = true; // 最初のタップのplayは失敗
      f.retry();
      await flush();
      assert.equal(f.el.plays, 1);
      assert.equal(f.needsResume, true, "失敗時はneedsAudioResume=true");
      assert.equal(f.el.paused, true);
      f.el.forceReject = false;
      f.retry(); // metadataWaiting中の再タップ：無視されずplay()を試す
      assert.equal(f.el.plays, 2, "待機中の再タップも同期playに使われる");
      await flush();
      assert.equal(f.needsResume, false);
      assert.equal(f.el.listeners.length, 1, "リスナー増殖なし");
      f.retry();
      f.retry();
      assert.equal(f.el.plays, 2, "再生中の連打でplay()は増えない");
    }
    // 7)8) 待機中のOFF・stop・曲変更・ページ離脱では鳴らない。古いloadedmetadataが新しい曲を上書きしない。
    {
      const f = new Player(false);
      f.play("live", 10_000);
      f.enabled = false;
      f.el.loadMeta(100);
      assert.equal(f.el.plays, 0, "待機中にOFFなら再生しない");
      const h = new Player(false);
      h.play("live", 10_000);
      h.stop();
      h.els.get("live")!.loadMeta(100);
      assert.equal(h.els.get("live")!.plays, 0, "stop・ページ離脱後は再生しない");
      const g = new Player(false);
      g.play("A", 10_000);
      g.play("B", 0);
      const elB = g.elOf("B");
      elB.duration = 60;
      elB.currentTime = 12;
      g.elOf("A").loadMeta(100); // 古い曲Aのイベント
      assert.equal(g.elOf("A").plays, 0, "古い曲は再生しない");
      assert.equal(elB.currentTime, 12, "新しい曲のcurrentTimeを上書きしない");
    }
    // 9) durationが分かっている場合：offsetがcurrentTimeへ反映（modulo）され、連打でplayは増えない。
    {
      const f = new Player(false);
      f.el.duration = 30;
      f.play("live", 65_000);
      near(f.el.currentTime * 1000, 5_000, 1, "65秒 mod 30秒 = 5秒");
      assert.equal(f.el.plays, 1);
      f.retry();
      f.retry();
      assert.equal(f.el.plays, 1, "再生中の連打でplayは増えない");
      assert.equal(resolveFallbackSeekSec(-5, 30), 0);
      assert.equal(resolveFallbackSeekSec(NaN, 30), 0);
      assert.equal(resolveFallbackSeekSec(Infinity, 30), 0);
      assert.equal(resolveFallbackSeekSec(10, NaN), null);
    }
    // ---- 10回目レビュー：metadataWaitingの状態遷移とリスナー重複防止 ----
    // 共通関数の単体：確認とtrue設定は登録前。待機中は登録しない。発火でfalse。例外時はtrueのまま残さない。
    {
      const h: { metadataWaiting?: boolean } = {};
      let added = 0;
      let flagAtAdd: boolean | undefined;
      const fns: Array<() => void> = [];
      const add = (fn: () => void) => {
        added++;
        flagAtAdd = h.metadataWaiting; // 登録の瞬間にtrueになっていること
        fns.push(fn);
      };
      assert.equal(registerMetadataListenerOnce(h, add, () => {}), true);
      assert.equal(flagAtAdd, true, "リスナー登録の直前にmetadataWaiting=trueが設定されている");
      assert.equal(h.metadataWaiting, true);
      for (let i = 0; i < 5; i++) assert.equal(registerMetadataListenerOnce(h, add, () => {}), false);
      assert.equal(added, 1, "待機中の連打でリスナーは1件だけ");
      fns[0]();
      assert.equal(h.metadataWaiting, false, "発生後はfalseへ戻る");
      assert.equal(registerMetadataListenerOnce(h, add, () => {}), true, "次の正当な待機では新しく登録できる");
      assert.equal(added, 2);
      const h2: { metadataWaiting?: boolean } = {};
      assert.equal(
        registerMetadataListenerOnce(h2, () => {
          throw new Error("addEventListener failed");
        }, () => {}),
        false,
      );
      assert.equal(h2.metadataWaiting, false, "登録が同期例外を投げてもtrueのまま残らない");
    }
    // 本番コードの配線：audioManager.tsが共通関数経由でリスナー登録し、直接addEventListener("loadedmetadata")
    // していない（配線漏れの検出）。
    {
      const src = readFileSync(join(process.cwd(), "src", "lib", "audio", "audioManager.ts"), "utf8");
      assert.ok(/registerMetadataListenerOnce\(\s*playback,/.test(src), "audioManagerがregisterMetadataListenerOnce(playback,…)を使っていない");
      const direct = (src.match(/addEventListener\(\s*"loadedmetadata"/g) ?? []).length;
      assert.equal(direct, 1, "loadedmetadataの登録は共通関数のコールバック内の1箇所だけ");
      const idx = src.indexOf("registerMetadataListenerOnce(\n      playback,");
      assert.ok(idx > 0 && src.slice(idx, idx + 200).includes('addEventListener("loadedmetadata"'));
    }
    // 1)〜7)9)10) 状態機械：待機中の多重呼び出し・再タップ・失敗後の再試行。
    {
      const f = new Player(false);
      f.el.autoplayBlocked = true;
      f.play("live", 10_000); // 1) metadata未取得で最初の呼び出し
      assert.equal(f.holder("live").metadataWaiting, true, "2) metadataWaitingがtrue");
      f.attemptStart(0);
      f.attemptStart(0);
      assert.equal(f.el.listeners.length, 1, "3) metadata取得前に複数回呼んでもリスナーは1件");
      f.el.forceReject = true; // 最初のタップのplay()は失敗（paused=trueのまま）
      f.retry();
      await flush();
      f.retry(); // 4) 待機中の再タップで同期play()を再試行
      await flush();
      assert.equal(f.el.plays, 2, "待機中の再タップで同期play()を再試行");
      assert.equal(f.el.listeners.length, 1, "5) ただしリスナーは追加しない");
      for (let i = 0; i < 5; i++) f.retry();
      assert.equal(f.el.listeners.length, 1, "10) 連打でリスナーが増殖しない");
      const playsBefore = f.el.plays;
      f.el.forceReject = false;
      f.el.loadMeta(100);
      assert.equal(f.el.plays, playsBefore + 1, "6) 最初のplayが失敗してpausedでも、metadata後のplayは最大1回");
      assert.equal(f.holder("live").metadataWaiting, false, "7) 発生後はmetadataWaiting=false");
      // 9) 別の正当な待機（stop後に新しい曲要求でduration未取得）では新しく登録できる。
      f.stop();
      f.els.set("live", new FakeAudioEl());
      f.play("live", 0);
      assert.equal(f.el.listeners.length, 1, "新しい待機では新規にリスナー登録できる");
    }
    // 8) 曲変更・OFF・stop後の古いイベントでは再生しない（待機フラグは発火で解除される）。
    {
      const f = new Player(false);
      f.play("A", 1_000);
      f.play("B", 0);
      f.elOf("A").loadMeta(100);
      assert.equal(f.elOf("A").plays, 0, "曲変更後の古いイベントでは再生しない");
      assert.equal(f.holder("A").metadataWaiting, false, "古いイベントでもフラグは解除される");
      const g = new Player(false);
      g.play("live", 1_000);
      g.enabled = false;
      g.el.loadMeta(100);
      assert.equal(g.el.plays, 0);
      const h = new Player(false);
      h.play("live", 1_000);
      h.stop();
      h.els.get("live")!.loadMeta(100);
      assert.equal(h.els.get("live")!.plays, 0);
    }
    console.log("PASS: 自動再開はresume前の状態でstalled判定→最新位置からsource作り直し→resume（本番と同順）、HTMLAudioはユーザー操作内で同期play・metadata後に最新位置へseek・待機中の再タップも有効・二重play/リスナー/sourceなし");
  }

  // 20: 進行RPCはサーバー時計の同期に依存しない（時計RPCが失敗し続けても進行RPCは動く）。
  {
    const w = new World();
    const clock = makeClock(w, { fail: () => true });
    assert.equal(await clock.sync(), false);
    assert.equal(clock.isFresh(), false);
    let rpcCalls = 0;
    const out = await tryAdvanceAnswering({
      advancer: createAnsweringAdvancer(),
      perfNow: w.perfNow,
      minIntervalMs: 1500,
      live: { id: "L", current_phase: "answering", current_turn_id: "T" },
      isFrozen: () => false,
      callRpc: (async () => {
        rpcCalls++;
        return { data: { updated: true, live: { id: "L", current_phase: "group_result", current_turn_id: "T" } }, error: null };
      }) as never,
      applyLive: () => {},
      afterAdvanced: async () => {},
    });
    assert.equal(out, "advanced");
    assert.equal(rpcCalls, 1);
    console.log("PASS: サーバー時計が未同期・同期失敗中でも回答終了の進行RPCは呼ばれる");
  }

  console.log("ALL SERVER_CLOCK CHECKS PASSED");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
