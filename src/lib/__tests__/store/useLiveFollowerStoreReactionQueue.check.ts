// useLiveFollowerStore.ts のツッコミ/拍手/爆笑キュー方式（0068）を、本番と同じ
// 実装をそのまま呼び出して検証するスクリプト。実行方法は
// src/lib/__tests__/run.sh 参照（この1ファイルだけ専用のtsconfigと
// requireフック(pathAliasHook.js)経由でコンパイル・実行される。理由は
// useLiveFollowerStoreRace.check.tsと同じ：useLiveFollowerStore.tsが
// "@/..."エイリアスとSupabaseクライアントの実生成を含むため）。
import assert from "node:assert/strict";

import {
  ReactionDisplayScheduler,
  sharedReactionDisplayCounter,
  TSUKKOMI_TOTAL_DISPLAY_MAX,
} from "@/lib/liveReactionQueue";
import { supabase } from "@/lib/supabase";
import type { LiveRow } from "@/lib/liveRoomTypes";
import {
  enqueueTsukkomiEvent,
  resetTsukkomiReactionQueue,
  TSUKKOMI_PROCESSED_ID_CACHE_MAX,
  TSUKKOMI_QUEUE_MAX,
  TSUKKOMI_STALE_MS,
  useLiveFollowerStore,
  type TsukkomiEvent,
} from "@/store/useLiveFollowerStore";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isLaugh = (e: TsukkomiEvent) => e.kind === "stamp" && e.text === "爆笑";
const isDanmaku = (e: TsukkomiEvent) => !isLaugh(e);

function resetAll() {
  resetTsukkomiReactionQueue();
  sharedReactionDisplayCounter.reset();
  assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "resetTsukkomiReactionQueue後もキューが空になっていない");
  assert.equal(sharedReactionDisplayCounter.get(), 0, "sharedReactionDisplayCounter.reset()後もカウンタが0になっていない");
}

// 実際の画面（TsukkomiDanmakuOverlay・LaughMarkOverlay）と同じ定数値。
// tick間隔・表示時間はsrc/lib/liveReactionQueue.ts・各Overlayコンポーネントと
// 揃えること（値がずれると、ここでの「取りこぼさない」検証の前提が崩れる）。
const SIM_TICK_MS = 100;
const SIM_DANMAKU_HOLD_MS = 4200; // TsukkomiDanmakuOverlayのSCROLL_DURATION_MS
const SIM_LAUGH_HOLD_MS = 900; // LaughMarkOverlayのMARK_DURATION_MS
const SIM_DANMAKU_MAX = 10; // TsukkomiDanmakuOverlayのMAX_CONCURRENT
const SIM_LAUGH_MAX = 10; // LaughMarkOverlayのMAX_CONCURRENT

// setInterval/setTimeoutを使わず、手動でnowMsを進めながら
// 「tick→表示終了予定のあるものをremove→tick」を繰り返すシミュレータ。
// 実際のTsukkomiDanmakuOverlay/LaughMarkOverlayが同時にマウントされている状況
// （2つの独立したスケジューラが同じ共有カウンタを見る）を再現する。
function runSchedulerSimulation(args: {
  baseNow: number;
  totalExpected: number;
  maxSimMs: number;
}): {
  claimedDanmaku: TsukkomiEvent[];
  claimedLaugh: TsukkomiEvent[];
  maxSharedObserved: number;
  maxDanmakuObserved: number;
  maxLaughObserved: number;
  danmakuScheduler: ReactionDisplayScheduler;
  laughScheduler: ReactionDisplayScheduler;
} {
  const { baseNow, totalExpected, maxSimMs } = args;
  const danmakuScheduler = new ReactionDisplayScheduler({
    claim: (p, now) => useLiveFollowerStore.getState().claimReactionEvent(p, now),
    predicate: isDanmaku,
    maxConcurrent: SIM_DANMAKU_MAX,
  });
  const laughScheduler = new ReactionDisplayScheduler({
    claim: (p, now) => useLiveFollowerStore.getState().claimReactionEvent(p, now),
    predicate: isLaugh,
    maxConcurrent: SIM_LAUGH_MAX,
  });

  const claimedDanmaku: TsukkomiEvent[] = [];
  const claimedLaugh: TsukkomiEvent[] = [];
  let maxSharedObserved = 0;
  let maxDanmakuObserved = 0;
  let maxLaughObserved = 0;

  for (let elapsed = 0; elapsed <= maxSimMs; elapsed += SIM_TICK_MS) {
    const now = baseNow + elapsed;
    // 表示終了予定を過ぎたものを先に片付ける（実際のsetTimeoutによる
    // remove()呼び出しに相当）。
    for (const id of danmakuScheduler.collectDue(now)) danmakuScheduler.remove(id);
    for (const id of laughScheduler.collectDue(now)) laughScheduler.remove(id);

    const d = danmakuScheduler.tick(now, SIM_DANMAKU_HOLD_MS);
    if (d) claimedDanmaku.push(d);
    const l = laughScheduler.tick(now, SIM_LAUGH_HOLD_MS);
    if (l) claimedLaugh.push(l);

    maxSharedObserved = Math.max(maxSharedObserved, sharedReactionDisplayCounter.get());
    maxDanmakuObserved = Math.max(maxDanmakuObserved, danmakuScheduler.displayedCount);
    maxLaughObserved = Math.max(maxLaughObserved, laughScheduler.displayedCount);

    if (
      claimedDanmaku.length + claimedLaugh.length === totalExpected &&
      useLiveFollowerStore.getState().tsukkomiQueue.length === 0
    ) {
      break;
    }
  }

  return {
    claimedDanmaku,
    claimedLaugh,
    maxSharedObserved,
    maxDanmakuObserved,
    maxLaughObserved,
    danmakuScheduler,
    laughScheduler,
  };
}

async function main() {
  // ============================================================
  // 1. 同一描画タイミングで10〜20件受信しても、全イベントが一度ずつ処理される
  //    （通常のバーストは可能な限り全て表示される＝取りこぼさない）。
  // ============================================================
  {
    resetAll();
    const total = 17; // 10〜20件の間
    for (let i = 0; i < total; i++) {
      const kind: "clap" | "stamp" = i % 5 === 0 ? "stamp" : "clap";
      const text = kind === "stamp" && i % 10 === 0 ? "爆笑" : kind === "stamp" ? "座布団!" : "";
      enqueueTsukkomiEvent(`burst-${i}`, kind, text);
    }
    assert.equal(
      useLiveFollowerStore.getState().tsukkomiQueue.length,
      total,
      "通常バースト件数がキューにそのまま積まれていない",
    );

    // 2つの独立した消費者（Danmaku担当・Laugh担当）が交互に1件ずつ取り出す想定を再現する。
    const claimedDanmaku: TsukkomiEvent[] = [];
    const claimedLaugh: TsukkomiEvent[] = [];
    let guard = 0;
    while (guard < total * 3) {
      guard++;
      const d = useLiveFollowerStore.getState().claimReactionEvent(isDanmaku);
      if (d) claimedDanmaku.push(d);
      const l = useLiveFollowerStore.getState().claimReactionEvent(isLaugh);
      if (l) claimedLaugh.push(l);
      if (!d && !l) break;
    }
    assert.equal(
      claimedDanmaku.length + claimedLaugh.length,
      total,
      "通常バーストの一部が取りこぼされた、または重複して取り出された",
    );
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "全件取り出した後もキューが空になっていない");
    // 到着順維持：それぞれの系統内で番号が昇順のままであること。
    const numOf = (e: TsukkomiEvent) => Number(e.id.split("-")[1]);
    for (let i = 1; i < claimedDanmaku.length; i++) {
      assert.ok(numOf(claimedDanmaku[i]) > numOf(claimedDanmaku[i - 1]), "danmaku系統の到着順が保たれていない");
    }
    for (let i = 1; i < claimedLaugh.length; i++) {
      assert.ok(numOf(claimedLaugh[i]) > numOf(claimedLaugh[i - 1]), "laugh系統の到着順が保たれていない");
    }
    console.log("PASS: 10〜20件の通常バーストは全件処理され、系統ごとの到着順も保たれる");
  }

  // ============================================================
  // 2. 重複UUIDは二度処理されない。
  // ============================================================
  {
    resetAll();
    enqueueTsukkomiEvent("dup-1", "clap", "");
    enqueueTsukkomiEvent("dup-1", "clap", ""); // 同じidを重複受信
    enqueueTsukkomiEvent("dup-1", "clap", ""); // 3回目
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 1, "重複UUIDが複数回キューに積まれた");
    console.log("PASS: 重複UUIDは二度キューに積まれない");
  }

  // ============================================================
  // 3. 100〜1000件規模の異常な量のイベントを連続投入しても、待機キューは常に
  //    TSUKKOMI_QUEUE_MAX(30)件以内に保たれる（フリーズ・無限増加しない）。
  // ============================================================
  {
    resetAll();
    const started = Date.now();
    const floodCount = 1000;
    for (let i = 0; i < floodCount; i++) {
      enqueueTsukkomiEvent(`flood-${i}`, "clap", "");
      // 途中経過でも常に上限以内であることを確認する（後半だけ確認して漏れが
      // 無いようにする）。
      if (i % 97 === 0) {
        assert.ok(
          useLiveFollowerStore.getState().tsukkomiQueue.length <= TSUKKOMI_QUEUE_MAX,
          `途中経過でキューが上限(${TSUKKOMI_QUEUE_MAX})を超えた(i=${i})`,
        );
      }
    }
    const elapsedMs = Date.now() - started;
    const finalQueue = useLiveFollowerStore.getState().tsukkomiQueue;
    assert.equal(finalQueue.length, TSUKKOMI_QUEUE_MAX, "1000件投入後、キューがTSUKKOMI_QUEUE_MAXちょうどになっていない");
    // 直近30件（flood-970〜flood-999）だけが残っているはず（古いものから破棄）。
    assert.equal(finalQueue[0].id, `flood-${floodCount - TSUKKOMI_QUEUE_MAX}`, "キューに残っているべき最古の要素が違う（古いものから破棄されていない）");
    assert.equal(finalQueue[finalQueue.length - 1].id, `flood-${floodCount - 1}`, "キューに残っているべき最新の要素が違う");
    // 「画面が固まらない」の代理指標：1000件の同期処理が明らかに異常な時間
    // （5秒以上）かからないこと。
    assert.ok(elapsedMs < 5000, `1000件投入に${elapsedMs}msかかった（フリーズの疑い）`);
    console.log(`PASS: 100〜1000件規模の連続投入でも待機キューは${TSUKKOMI_QUEUE_MAX}件以内に保たれる（${elapsedMs}ms）`);
  }

  // ============================================================
  // 4. 受信からTSUKKOMI_STALE_MS（現在の設定値）経過した待機イベントは、
  //    表示されずに破棄される。
  // ============================================================
  {
    resetAll();
    const now = Date.now();
    enqueueTsukkomiEvent("stale-1", "clap", "", now - (TSUKKOMI_STALE_MS + 500)); // 期限+0.5秒前
    enqueueTsukkomiEvent("fresh-1", "clap", "", now); // 今
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 2, "投入直後の件数が想定と違う");

    const claimed = useLiveFollowerStore.getState().claimReactionEvent(isDanmaku);
    assert.ok(claimed, "新しい方のイベントが取り出せなかった");
    assert.equal(claimed!.id, "fresh-1", "古い(stale)イベントが先に取り出されてしまった（破棄されずに表示される経路に入っている）");
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "stale-1が破棄されずキューに残っている");
    console.log(`PASS: 受信からTSUKKOMI_STALE_MS(${TSUKKOMI_STALE_MS}ms)経過した待機イベントは表示されずに破棄される`);
  }

  // ============================================================
  // 5. 画面上の同時表示数の上限超過分は順番待ち（＝キューから即座には消えず、
  //    表示側が取り出すまで残る）ことをclaimReactionEventの粒度で確認する。
  // ============================================================
  {
    resetAll();
    for (let i = 0; i < 12; i++) enqueueTsukkomiEvent(`cap-${i}`, "clap", "");
    const maxConcurrent = 8;
    const displayed: TsukkomiEvent[] = [];
    for (let i = 0; i < maxConcurrent; i++) {
      const c = useLiveFollowerStore.getState().claimReactionEvent(isDanmaku);
      assert.ok(c, `上限(${maxConcurrent})件までは取り出せるはず`);
      displayed.push(c!);
    }
    assert.equal(displayed.length, maxConcurrent, "同時表示上限ぶんが取り出せなかった");
    // 上限を超えた残り4件は、破棄されず順番待ちとしてキューに残っている。
    const remaining = useLiveFollowerStore.getState().tsukkomiQueue;
    assert.equal(remaining.length, 12 - maxConcurrent, "上限超過分が破棄されてしまった（順番待ちになっていない）");
    assert.equal(remaining[0].id, `cap-${maxConcurrent}`, "順番待ちの先頭が想定と違う（到着順が崩れている）");
    console.log("PASS: 同時表示上限を超えた分は破棄されず、順番待ちとしてキューに残る");
  }

  // ============================================================
  // 6. ライブ切り替え・購読解除・再購読相当（resetTsukkomiReactionQueue）で、
  //    前のライブの待機キュー・処理済みIDセットがリセットされる
  //    （リロード・再接続時に過去のリアクションをまとめて再生しない）。
  // ============================================================
  {
    resetAll();
    enqueueTsukkomiEvent("carry-over-1", "clap", "");
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 1);
    resetTsukkomiReactionQueue();
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "リセット後もキューに前のライブのイベントが残っている");
    // 処理済みIDセットもリセットされている：同じidを再度受信しても、
    // 新しいライブの分として今度はちゃんと積まれる（重複扱いされない）。
    enqueueTsukkomiEvent("carry-over-1", "clap", "");
    assert.equal(
      useLiveFollowerStore.getState().tsukkomiQueue.length,
      1,
      "リセット後、同じidの新しい受信が重複判定で無視されてしまった（処理済みIDセットがリセットされていない）",
    );
    console.log("PASS: ライブ切り替え相当のリセットで待機キュー・処理済みIDセットが初期化される");
  }

  // ============================================================
  // 7. 処理済みIDセットも無限に増え続けない（TSUKKOMI_PROCESSED_ID_CACHE_MAX件で
  //    頭打ちになる）ことを、間接的に確認する：上限を超える数のユニークなidを
  //    受信させても例外なく完走し、直近のidの重複判定は正しく機能し続ける。
  // ============================================================
  {
    resetAll();
    const uniqueCount = TSUKKOMI_PROCESSED_ID_CACHE_MAX + 50;
    for (let i = 0; i < uniqueCount; i++) {
      enqueueTsukkomiEvent(`idcap-${i}`, "clap", "");
      // キュー自体は30件上限なので都度クレームして空にしておく（このテストの
      // 主眼はprocessedIdセット側の頭打ちの確認のため）。
      useLiveFollowerStore.getState().claimReactionEvent(() => true);
    }
    // 直近のidはまだ処理済みセットに残っているはずなので、再送されても無視される。
    enqueueTsukkomiEvent(`idcap-${uniqueCount - 1}`, "clap", "");
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "直近のidの重複が弾かれていない");
    console.log("PASS: 処理済みIDセットは大量投入でも例外なく完走し、直近idの重複判定を維持する（頭打ち動作の代理確認）");
  }

  // ============================================================
  // 8. 1人1秒の送信制限（フロント側）が維持されている。
  // ============================================================
  {
    let rpcCallCount = 0;
    (supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ error: null }> }).rpc = (
      name: string,
    ) => {
      if (name === "send_tsukkomi") rpcCallCount++;
      return Promise.resolve({ error: null });
    };

    const liveRow = { id: "live-reaction-test" } as unknown as LiveRow;
    useLiveFollowerStore.setState({ live: liveRow });

    useLiveFollowerStore.getState().sendTsukkomi("clap", "");
    useLiveFollowerStore.getState().sendTsukkomi("clap", ""); // 直後の連打：間引かれるはず
    await delay(20);
    assert.equal(rpcCallCount, 1, "1秒以内の連打が間引かれず2回送信された");

    await delay(1100); // クールダウン(1000ms)を超えて待つ
    useLiveFollowerStore.getState().sendTsukkomi("clap", "");
    await delay(20);
    assert.equal(rpcCallCount, 2, "クールダウン後の送信が行われなかった");
    console.log("PASS: 1人1秒の送信制限（フロント側のクールダウン）が維持されている");
  }

  // ============================================================
  // 9. 【本丸】実際のスケジューラ相当（tick間隔100ms・danmaku表示4.2秒/
  //    laugh表示0.9秒・種別横断の共有上限TSUKKOMI_TOTAL_DISPLAY_MAX・
  //    TSUKKOMI_STALE_MS）を手動tickで再現し、20件の純danmakuバーストが
  //    重複なく・取りこぼされずに全件表示処理されることを検証する。
  //    以前のテスト（claimReactionEventを待ち時間なしでループ呼び出しするだけ）は
  //    このタイミング起因の取りこぼしを検出できていなかった。
  // ============================================================
  {
    resetAll();
    const total = 20;
    const baseNow = Date.now();
    for (let i = 0; i < total; i++) {
      enqueueTsukkomiEvent(`sched-${i}`, "clap", "", baseNow);
    }
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, total, "投入直後の件数が想定と違う");

    const { claimedDanmaku, claimedLaugh, maxSharedObserved, maxDanmakuObserved, maxLaughObserved, danmakuScheduler, laughScheduler } =
      runSchedulerSimulation({ baseNow, totalExpected: total, maxSimMs: 15_000 });

    assert.equal(
      claimedDanmaku.length + claimedLaugh.length,
      total,
      `20件の純danmakuバーストが全件処理されなかった（stale期限切れで失われた疑い。danmaku=${claimedDanmaku.length}, laugh=${claimedLaugh.length}）`,
    );
    // 純danmakuバーストなのでlaugh側が誤って取り出すことは無いはず。
    assert.equal(claimedLaugh.length, 0, "laughのpredicateに一致しないはずのイベントがlaugh側で取り出された");
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "全件処理後もキューにイベントが残っている");
    // 重複なく1回ずつ：idの集合がユニークかつ想定件数と一致する。
    const claimedIds = new Set(claimedDanmaku.map((e) => e.id));
    assert.equal(claimedIds.size, total, "同じイベントが複数回取り出された（重複）");
    assert.ok(
      maxSharedObserved <= TSUKKOMI_TOTAL_DISPLAY_MAX,
      `種別横断の同時表示数が共有上限(${TSUKKOMI_TOTAL_DISPLAY_MAX})を超えた(観測値=${maxSharedObserved})`,
    );
    assert.ok(maxDanmakuObserved <= SIM_DANMAKU_MAX, "danmaku単体の同時表示数が自分の上限を超えた");
    assert.ok(maxLaughObserved <= SIM_LAUGH_MAX, "laugh単体の同時表示数が自分の上限を超えた");

    danmakuScheduler.dispose();
    laughScheduler.dispose();
    assert.equal(sharedReactionDisplayCounter.get(), 0, "シミュレーション終了後、共有カウンタが0に戻らない（リーク）");
    console.log(
      `PASS: 実際のスケジューラ相当(tick=${SIM_TICK_MS}ms)で20件の純danmakuバーストが取りこぼされず、種別横断の同時表示数も共有上限(${TSUKKOMI_TOTAL_DISPLAY_MAX})を超えない（最大観測=${maxSharedObserved}）`,
    );
  }

  // ============================================================
  // 10. danmaku/laughが混在するバースト（10件+10件=20件）でも、種別横断の
  //     合計が共有上限を超えず、かつ全件が取りこぼされずに処理される。
  // ============================================================
  {
    resetAll();
    const danmakuCount = 10;
    const laughCount = 10;
    const baseNow = Date.now();
    for (let i = 0; i < danmakuCount; i++) {
      enqueueTsukkomiEvent(`mix-d-${i}`, "clap", "", baseNow);
    }
    for (let i = 0; i < laughCount; i++) {
      enqueueTsukkomiEvent(`mix-l-${i}`, "stamp", "爆笑", baseNow);
    }
    const total = danmakuCount + laughCount;
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, total, "混在バースト投入直後の件数が想定と違う");

    const { claimedDanmaku, claimedLaugh, maxSharedObserved, danmakuScheduler, laughScheduler } = runSchedulerSimulation({
      baseNow,
      totalExpected: total,
      maxSimMs: 15_000,
    });

    assert.equal(claimedDanmaku.length, danmakuCount, "混在バーストでdanmaku側の件数が想定と違う（取りこぼしの疑い）");
    assert.equal(claimedLaugh.length, laughCount, "混在バーストでlaugh側の件数が想定と違う（取りこぼしの疑い）");
    assert.equal(useLiveFollowerStore.getState().tsukkomiQueue.length, 0, "混在バースト全件処理後もキューにイベントが残っている");
    assert.ok(
      maxSharedObserved <= TSUKKOMI_TOTAL_DISPLAY_MAX,
      `種別混在時の同時表示数合計が共有上限(${TSUKKOMI_TOTAL_DISPLAY_MAX})を超えた(観測値=${maxSharedObserved})`,
    );

    danmakuScheduler.dispose();
    laughScheduler.dispose();
    assert.equal(sharedReactionDisplayCounter.get(), 0, "混在バースト終了後、共有カウンタが0に戻らない（リーク）");
    console.log(
      `PASS: danmaku/laugh混在バースト(${danmakuCount}+${laughCount}件)でも取りこぼしなく、共有上限(${TSUKKOMI_TOTAL_DISPLAY_MAX})を超えない（最大観測=${maxSharedObserved}）`,
    );
  }

  // ============================================================
  // 11. 100〜1000件規模の異常投入下でも、スケジューラを回し続けて有限時間で
  //     完走する（画面が固まらない）こと、待機キュー・処理済みIDキャッシュの
  //     上限（TSUKKOMI_QUEUE_MAX・TSUKKOMI_PROCESSED_ID_CACHE_MAX）が
  //     守られたままであることを確認する（全件表示の保証は不要）。
  // ============================================================
  {
    resetAll();
    const floodCount = 500;
    const baseNow = Date.now();
    for (let i = 0; i < floodCount; i++) {
      enqueueTsukkomiEvent(`sched-flood-${i}`, "clap", "", baseNow);
    }
    assert.ok(
      useLiveFollowerStore.getState().tsukkomiQueue.length <= TSUKKOMI_QUEUE_MAX,
      "異常投入直後から待機キューがTSUKKOMI_QUEUE_MAXを超えている",
    );

    const started = Date.now();
    const { maxSharedObserved, danmakuScheduler, laughScheduler } = runSchedulerSimulation({
      baseNow,
      totalExpected: floodCount, // 全件処理は保証しないため、上限までシミュレーションを回すだけ
      maxSimMs: 20_000,
    });
    const elapsedMs = Date.now() - started;

    assert.ok(
      useLiveFollowerStore.getState().tsukkomiQueue.length <= TSUKKOMI_QUEUE_MAX,
      `異常投入後も待機キューが上限(${TSUKKOMI_QUEUE_MAX})を超えている`,
    );
    assert.ok(
      maxSharedObserved <= TSUKKOMI_TOTAL_DISPLAY_MAX,
      "異常投入下でも種別横断の同時表示数が共有上限を超えてはいけない",
    );
    // 「画面が固まらない」の代理指標：シミュレーション自体が明らかに異常な時間
    // （5秒以上）かからないこと（手動tickのみで実時間の待機は発生しないため、
    // 本来は非常に高速に終わるはず）。
    assert.ok(elapsedMs < 5000, `500件規模のスケジューラ・シミュレーションに${elapsedMs}msかかった（フリーズの疑い）`);

    danmakuScheduler.dispose();
    laughScheduler.dispose();
    sharedReactionDisplayCounter.reset();
    console.log(
      `PASS: 500件規模の異常投入下でもスケジューラは有限時間で完走し(${elapsedMs}ms)、待機キュー・共有上限のいずれも超過しない`,
    );
  }

  // ============================================================
  // 12. アンマウント相当の処理（scheduler.dispose()）後は、表示中アイテムが
  //     無くなり共有カウンタも0に戻る（増減が対称でリークしない）。
  //     実際のReactフック側は、これに加えてclearInterval/clearTimeoutで
  //     以降のtick呼び出し自体を止める（src/lib/liveReactionQueue.tsの
  //     disposedフラグ参照）。
  // ============================================================
  {
    resetAll();
    const baseNow = Date.now();
    for (let i = 0; i < 5; i++) enqueueTsukkomiEvent(`unmount-${i}`, "clap", "", baseNow);

    const scheduler = new ReactionDisplayScheduler({
      claim: (p, now) => useLiveFollowerStore.getState().claimReactionEvent(p, now),
      predicate: isDanmaku,
      maxConcurrent: SIM_DANMAKU_MAX,
    });
    for (let i = 0; i < 5; i++) scheduler.tick(baseNow, SIM_DANMAKU_HOLD_MS);
    assert.equal(scheduler.displayedCount, 5, "5件claimした直後の表示中件数が想定と違う");
    assert.equal(sharedReactionDisplayCounter.get(), 5, "5件claimした直後の共有カウンタが想定と違う");

    scheduler.dispose(); // アンマウント相当
    assert.equal(scheduler.displayedCount, 0, "dispose後も表示中件数が0に戻っていない");
    assert.equal(sharedReactionDisplayCounter.get(), 0, "dispose後も共有カウンタが0に戻っていない（リーク）");

    // dispose後にキューへ新しいイベントを積んでも、（本番ではclearIntervalにより
    // 呼ばれなくなるが）この破棄済みインスタンスへ誤って再度tickしてしまった
    // 場合でも、内部状態は一貫している（0から正しく再カウントできる）ことを確認する。
    enqueueTsukkomiEvent("after-dispose", "clap", "", baseNow);
    const claimed = scheduler.tick(baseNow, SIM_DANMAKU_HOLD_MS);
    assert.ok(claimed, "dispose後の新規イベントをtickで取り出せない");
    assert.equal(sharedReactionDisplayCounter.get(), 1, "dispose後の再tickで共有カウンタが正しく1にならない");
    scheduler.dispose();
    assert.equal(sharedReactionDisplayCounter.get(), 0, "後片付け後も共有カウンタが0に戻らない");
    console.log("PASS: アンマウント相当のdispose()で表示中アイテム・共有カウンタが対称にリセットされ、リークしない");
  }

  console.log("ALL USE_LIVE_FOLLOWER_STORE_REACTION_QUEUE CHECKS PASSED");
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
