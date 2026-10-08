// 称号管理画面の対象ライブ切替の競合検証。遅延Promiseで「古い取得が後から完了する」順序を
// 再現し、古い結果が新しい選択の画面（ライブ・到達記録）を上書きしないことを確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyPanelLoad,
  createLimitedRewardPresenceLoader,
  initialPanelState,
  selectPanelLive,
  startPanelReload,
  type LimitedRewardLiveOption,
  type LimitedRewardQueryResult,
} from "../limitedRewardPresenceLoader";
import { runSingleFlight, SINGLE_FLIGHT_SKIPPED } from "../singleFlight";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 1 flush：Promiseの連鎖（await）を進めるための待機
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const LIVES: LimitedRewardLiveOption[] = [
  { id: "live-1", title: "第1回", official_sequence_number: 1 },
  { id: "live-2", title: "第2回", official_sequence_number: 2 },
  { id: "live-3", title: "第3回", official_sequence_number: 3 },
];

const okLives = async (): Promise<LimitedRewardQueryResult<LimitedRewardLiveOption[]>> => ({ data: LIVES, error: null });

void (async () => {

// 1) 古い到達記録の取得が後から完了しても、新しく選んだライブの結果を上書きしない
{
  const pending = new Map<string, Deferred<LimitedRewardQueryResult<string[]>>>();
  const loader = createLimitedRewardPresenceLoader<string>({
    fetchLives: okLives,
    fetchPresence: (liveId) => {
      const d = deferred<LimitedRewardQueryResult<string[]>>();
      pending.set(liveId + "#" + pending.size, d);
      return d.promise;
    },
  });

  // 先に#2を選ぶ（遅い）→ その後#3を選ぶ（速い）。
  const first = loader.load("live-2");
  await flush();
  const second = loader.load("live-3");
  await flush();

  const entries = [...pending.entries()];
  const [key2, d2] = entries[0];
  const [key3, d3] = entries[1];
  assert.ok(key2.startsWith("live-2"), "1回目の取得は#2のはず");
  assert.ok(key3.startsWith("live-3"), "2回目の取得は#3のはず");

  d3.resolve({ data: ["利用者C"], error: null });
  const r3 = await second;
  assert.equal(r3.status, "applied");
  if (r3.status === "applied") {
    assert.equal(r3.liveId, "live-3");
    assert.deepEqual(r3.presence, ["利用者C"]);
  }

  // 古い#2の結果が後から完了しても、結果は捨てられる
  d2.resolve({ data: ["利用者A"], error: null });
  const r2 = await first;
  assert.equal(r2.status, "stale", "古い取得の結果は破棄されるはず");
  console.log("PASS: 古いライブの取得が後から完了しても、新しく選んだライブの到達記録は上書きされない");
}

// 2) 古い一覧取得が後から完了しても、最新の選択を上書きしない（一覧側も世代で判定）
{
  const pendingLives = deferred<LimitedRewardQueryResult<LimitedRewardLiveOption[]>>();
  let calls = 0;
  const loader = createLimitedRewardPresenceLoader<string>({
    fetchLives: () => {
      calls += 1;
      return calls === 1 ? pendingLives.promise : okLives();
    },
    fetchPresence: async () => ({ data: ["利用者"], error: null }),
  });

  const first = loader.load(null);
  const second = await loader.load("live-1");
  assert.equal(second.status, "applied");
  pendingLives.resolve({ data: LIVES, error: null });
  assert.equal((await first).status, "stale", "古い一覧取得は破棄されるはず");
  console.log("PASS: 古い対象ライブ一覧の取得は、後から完了しても最新の読込を上書きしない");
}

// 3) 希望のライブが一覧に無い場合は、最も新しい開催番号（一覧の末尾）を選ぶ
{
  const loader = createLimitedRewardPresenceLoader<string>({
    fetchLives: okLives,
    fetchPresence: async (liveId) => ({ data: [liveId], error: null }),
  });
  const r = await loader.load("not-in-list");
  assert.equal(r.status, "applied");
  if (r.status === "applied") {
    assert.equal(r.liveId, "live-3");
    assert.deepEqual(r.presence, ["live-3"]);
  }
  const none = await createLimitedRewardPresenceLoader<string>({
    fetchLives: async () => ({ data: [], error: null }),
    fetchPresence: async () => ({ data: ["x"], error: null }),
  }).load(null);
  assert.equal(none.status, "applied");
  if (none.status === "applied") {
    assert.equal(none.liveId, null);
    assert.deepEqual(none.presence, []);
  }
  console.log("PASS: 希望のライブが無ければ最新の開催番号を選び、対象ライブが無ければ空表示にする");
}

// 4) 対象ライブ一覧の取得エラーは握りつぶさず、失敗として返す（reject・error応答とも）
{
  const errorLoader = createLimitedRewardPresenceLoader<string>({
    fetchLives: async () => ({ data: null, error: { message: "raw db error" } }),
    fetchPresence: async () => ({ data: [], error: null }),
  });
  assert.equal((await errorLoader.load(null)).status, "lives_failed");

  const rejectLoader = createLimitedRewardPresenceLoader<string>({
    fetchLives: () => Promise.reject(new Error("network down")),
    fetchPresence: async () => ({ data: [], error: null }),
  });
  assert.equal((await rejectLoader.load(null)).status, "lives_failed");
  console.log("PASS: 対象ライブ一覧の取得失敗（エラー応答・通信例外）は失敗として返す");
}

// 5) 到達記録の取得失敗は、そのライブ向けの失敗として返す（古い取得の失敗は破棄）
{
  const loader = createLimitedRewardPresenceLoader<string>({
    fetchLives: okLives,
    fetchPresence: async () => ({ data: null, error: { message: "boom" } }),
  });
  const r = await loader.load("live-2");
  assert.equal(r.status, "presence_failed");
  if (r.status === "presence_failed") assert.equal(r.liveId, "live-2");

  const rejecting = createLimitedRewardPresenceLoader<string>({
    fetchLives: okLives,
    fetchPresence: () => Promise.reject(new Error("offline")),
  });
  assert.equal((await rejecting.load("live-1")).status, "presence_failed");
  console.log("PASS: 到達記録の取得失敗（エラー応答・通信例外）は失敗として返し、生の例外を画面に出さない");
}

// 6) 古い到達記録の失敗が後から届いても、最新の成功結果を失敗表示で上書きしない
{
  const pending = new Map<string, Deferred<LimitedRewardQueryResult<string[]>>>();
  const loader = createLimitedRewardPresenceLoader<string>({
    fetchLives: okLives,
    fetchPresence: (liveId) => {
      const d = deferred<LimitedRewardQueryResult<string[]>>();
      pending.set(liveId, d);
      return d.promise;
    },
  });
  const first = loader.load("live-1");
  await flush();
  const second = loader.load("live-2");
  await flush();
  pending.get("live-2")!.resolve({ data: ["利用者B"], error: null });
  assert.equal((await second).status, "applied");
  pending.get("live-1")!.resolve({ data: null, error: { message: "late error" } });
  assert.equal((await first).status, "stale", "古い失敗応答は画面に反映しないはず");
  console.log("PASS: 古い到達記録の失敗応答は、最新の成功結果を上書きしない");
}

  // 8) 管理画面の表示状態（取得失敗・再試行・選択直後の反映）
  {
    const livesQueue: Deferred<LimitedRewardQueryResult<LimitedRewardLiveOption[]>>[] = [];
    const presenceQueue = new Map<string, Deferred<LimitedRewardQueryResult<string[]>>>();
    const loader = createLimitedRewardPresenceLoader<string>({
      fetchLives: () => {
        const d = deferred<LimitedRewardQueryResult<LimitedRewardLiveOption[]>>();
        livesQueue.push(d);
        return d.promise;
      },
      fetchPresence: (liveId) => {
        const d = deferred<LimitedRewardQueryResult<string[]>>();
        presenceQueue.set(liveId, d);
        return d.promise;
      },
    });

    // 初期読込：一覧→#3（最新）を表示
    let panel = initialPanelState<string>();
    let p = loader.load(null);
    await flush();
    livesQueue[0].resolve({ data: LIVES, error: null });
    await flush();
    presenceQueue.get("live-3")!.resolve({ data: ["到達者3"], error: null });
    panel = applyPanelLoad(panel, await p);
    assert.equal(panel.selectedLiveId, "live-3");
    assert.deepEqual(panel.presence, ["到達者3"]);

    // (a) 選択直後：新しいライブIDが即座に選ばれ、結果が届くまで「読み込み中」
    panel = selectPanelLive(panel, "live-2");
    assert.equal(panel.selectedLiveId, "live-2", "選択直後から新しいライブIDが表示されない");
    assert.equal(panel.presence, null, "通信完了まで旧ライブの表示へ戻ってはいけない");

    // (b) 一覧取得が失敗しても「読み込み中」のまま残らない：失敗表示＋再試行可能
    p = loader.load("live-2");
    await flush();
    livesQueue[livesQueue.length - 1].resolve({ data: null, error: { message: "raw" } });
    panel = applyPanelLoad(panel, await p);
    assert.equal(panel.listFailed, true, "一覧取得の失敗が画面状態に残らない");
    assert.notEqual(panel.presence, null, "失敗後も読み込み中のまま残ってはいけない");

    // (c) 再試行で復帰する
    panel = startPanelReload(panel);
    p = loader.load(panel.selectedLiveId);
    await flush();
    livesQueue[livesQueue.length - 1].resolve({ data: LIVES, error: null });
    await flush();
    presenceQueue.get("live-2")!.resolve({ data: ["到達者2"], error: null });
    panel = applyPanelLoad(panel, await p);
    assert.equal(panel.listFailed, false, "再試行で失敗表示が消えない");
    assert.deepEqual(panel.presence, ["到達者2"]);
    console.log("PASS: 対象ライブ一覧の取得失敗は読み込み中のまま残らず、再試行で正常に復帰する");
    console.log("PASS: プルダウン変更直後から新しいライブIDが表示され、通信完了まで旧ライブへ戻らない");

    // (d) 古い失敗が最新の成功表示を壊さない
    const oldFailure = loader.load("live-1");
    await flush();
    const latest = loader.load("live-3");
    await flush();
    const oldLivesIdx = livesQueue.length - 2;
    livesQueue[oldLivesIdx].resolve({ data: null, error: { message: "old failure" } });
    livesQueue[livesQueue.length - 1].resolve({ data: LIVES, error: null });
    await flush();
    presenceQueue.get("live-3")!.resolve({ data: ["到達者3（最新）"], error: null });
    panel = applyPanelLoad(panel, await latest);
    const oldResult = await oldFailure;
    assert.equal(oldResult.status, "stale", "古い失敗が破棄されていない");
    panel = applyPanelLoad(panel, oldResult);
    assert.equal(panel.listFailed, false, "古い失敗が最新の成功表示を失敗表示へ変えた");
    assert.deepEqual(panel.presence, ["到達者3（最新）"]);
    console.log("PASS: 古い失敗の結果は、最新の成功表示（一覧・到達記録）を壊さない");
  }

  // 9) 再付与の単一実行（同期連打でもRPCは1回だけ。例外でも必ずロックを解除する）
  {
    const lock = { current: false };
    let calls = 0;
    const pending = deferred<string>();
    const task = () => {
      calls += 1;
      return pending.promise;
    };
    const first = runSingleFlight(lock, task);
    const second = runSingleFlight(lock, task);
    const third = runSingleFlight(lock, task);
    assert.equal(await second, SINGLE_FLIGHT_SKIPPED, "2回目の連打が実行されてしまった");
    assert.equal(await third, SINGLE_FLIGHT_SKIPPED, "3回目の連打が実行されてしまった");
    assert.equal(calls, 1, "同期連打でRPCが複数回開始された");
    pending.resolve("done");
    assert.equal(await first, "done");
    assert.equal(lock.current, false, "成功後にロックが解除されていない");

    await assert.rejects(runSingleFlight(lock, async () => { throw new Error("network"); }));
    assert.equal(lock.current, false, "例外後にロックが残っている");
    assert.equal(await runSingleFlight(lock, async () => "retry-ok"), "retry-ok");
    console.log("PASS: 再付与は同期連打でもRPCが1回だけ開始され、成功・例外のどちらでもロックが解除される");
  }

// 7) 管理画面が競合対策のローダー経由で読み込み、古い結果を画面へ直接反映しないこと（配線の検査）
{
  const page = readFileSync(join(process.cwd(), "src/app/admin/titles/page.tsx"), "utf8");
  assert.match(page, /createLimitedRewardPresenceLoader</, "管理画面が競合対策のローダーを使っていない");
  assert.match(page, /if \(result\.status === "stale"\) return;/, "管理画面が古い結果を破棄していない");
  assert.match(page, /presenceFailed/, "到達記録の取得失敗を画面で扱っていない");
  assert.match(page, /runSingleFlight\(regrantLockRef\.current/, "再付与が単一実行になっていない");
  assert.match(page, /selectPanelLive\(panelRef\.current, e\.target\.value\)/, "プルダウン変更を即座に反映していない");
  assert.doesNotMatch(page, /supabase\s*\.rpc\("admin_list_final_result_presence"[\s\S]{0,20}\)[\s\S]{0,40}setPresence/, "RPC結果を直接setPresenceしている");
  assert.match(page, /regrantingKey === `\$\{panel\.selectedLiveId\}:\$\{p\.user_id\}`/, "再付与の処理中表示がライブ単位になっていない");
  console.log("PASS: 管理画面は競合対策のローダー経由で読み込み、古い結果を破棄し、再付与の処理中表示はライブ単位");
}


  console.log("limitedRewardPresenceLoader.check: ALL PASS");
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
