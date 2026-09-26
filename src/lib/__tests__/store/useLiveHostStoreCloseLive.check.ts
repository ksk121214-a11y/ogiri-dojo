// 司会画面：ライブ終了(closeLive)後に「状態を確認中…」のまま止まらないことの検証。
// 修正前の問題：init()（復旧）が進行中に終了処理が走ると、追い越されたinit()が
// loading:true のまま戻り、司会画面がリロードするまで「状態を確認中…」だった。
// 実行方法は src/lib/__tests__/run.sh 参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { LiveRow } from "@/lib/liveRoomTypes";
import { useLiveBotStore } from "@/store/useLiveBotStore";
import { useLiveHostStore } from "@/store/useLiveHostStore";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const liveRow = {
  id: "live-1",
  current_phase: "final_result",
  current_turn_id: null,
  phase_deadline: null,
  answering_paused: false,
  timing_profile: "standard",
  live_mode: "test",
  created_at: "2026-01-01T00:00:00Z",
} as unknown as LiveRow;

let releaseLives: () => void = () => {};
let livesGate: Promise<void> | null = null;
let closeResponses: Array<{ data: unknown; error: unknown }> = [];
let closeCalls = 0;

function chain(result: { data: unknown; error: unknown }, gate?: Promise<void> | null) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order", "limit", "in", "maybeSingle"]) b[m] = () => b;
  b.insert = async () => ({ error: null });
  b.then = (ok: (v: unknown) => unknown) => (gate ? gate.then(() => result) : Promise.resolve(result)).then(ok);
  return b;
}
(supabase as unknown as Record<string, unknown>).from = (table: string) => {
  if (table === "lives") return chain({ data: liveRow, error: null }, livesGate);
  return chain({ data: [], error: null });
};
(supabase as unknown as Record<string, unknown>).rpc = (name: string) => {
  if (name === "close_live") {
    closeCalls += 1;
    const res = closeResponses.shift() ?? { data: null, error: { message: "unexpected" } };
    return { single: async () => res };
  }
  return { single: async () => ({ data: null, error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) };
};
(supabase as unknown as Record<string, unknown>).channel = () => {
  const ch: Record<string, unknown> = {};
  ch.on = () => ch;
  ch.subscribe = () => ch;
  return ch;
};
(supabase as unknown as Record<string, unknown>).removeChannel = async () => "ok";

const okClose = { data: { closed: true, rewards_applied: true, rewards_error: null, error_code: null }, error: null };
const alreadyClosed = { data: { closed: false, rewards_applied: false, rewards_error: null, error_code: null }, error: null };

function resetState(overrides: Record<string, unknown> = {}) {
  closeCalls = 0;
  livesGate = null;
  useLiveHostStore.setState({
    live: liveRow,
    liveSnapshotConfirmed: true,
    loading: false,
    error: null,
    participants: [],
    turns: [],
    ...overrides,
  } as never);
}

async function main() {
  // 1) 通常終了：ライブ無しの確定状態になり、loadingは必ずfalse。
  resetState({ loading: true });
  closeResponses = [okClose];
  const r1 = await useLiveHostStore.getState().closeLive();
  assert.equal(r1.ok, true);
  assert.equal(useLiveHostStore.getState().live, null, "終了後にライブが残っている");
  assert.equal(useLiveHostStore.getState().loading, false, "終了後にloadingが解除されていない（状態を確認中…のまま）");
  assert.equal(useLiveHostStore.getState().liveSnapshotConfirmed, true);
  console.log("PASS: close_live成功後は、ライブ無しの確定状態になりloadingが解除される");

  // 2) 復旧(init)が進行中に終了処理が走っても、追い越されたinitがloadingを残さない。
  resetState();
  let gateResolve: () => void = () => {};
  livesGate = new Promise<void>((r) => (gateResolve = r));
  releaseLives = gateResolve;
  const initPromise = useLiveHostStore.getState().init();
  await delay(20);
  assert.equal(useLiveHostStore.getState().loading, true, "前提：init中はloading=trueのはず");
  closeResponses = [okClose];
  await useLiveHostStore.getState().closeLive();
  releaseLives();
  await initPromise;
  await delay(50);
  assert.equal(useLiveHostStore.getState().loading, false, "終了処理に追い越されたinitがloading=trueのまま残った（状態を確認中…で止まる）");
  assert.equal(useLiveHostStore.getState().live, null, "追い越されたinitが、終了済みのライブを復活させた");
  console.log("PASS: 復旧(init)中に終了処理が走っても、リロード無しで準備画面（loading解除・ライブ無し）へ移る");

  // 3) close_live失敗時は既存状態を勝手に消さない。
  resetState();
  closeResponses = [{ data: null, error: { message: "network error" } }];
  const r3 = await useLiveHostStore.getState().closeLive();
  assert.equal(r3.ok, false);
  assert.equal(useLiveHostStore.getState().live?.id, "live-1", "close_live失敗なのにライブ状態が消えた");
  assert.equal(useLiveHostStore.getState().loading, false);
  console.log("PASS: close_live失敗時は既存のライブ状態を保持する");

  // 4) 「まだ最終結果ではない」は終了扱いにしない。
  resetState();
  closeResponses = [{ data: { closed: false, rewards_applied: false, rewards_error: null, error_code: "NOT_FINAL_RESULT" }, error: null }];
  const r4 = await useLiveHostStore.getState().closeLive();
  assert.equal(r4.ok, false);
  assert.equal(useLiveHostStore.getState().live?.id, "live-1", "最終結果前の終了要求でライブ状態が消えた");
  console.log("PASS: 最終結果に到達していない終了要求は拒否され、状態は保持される");

  // 5) 二重クリック・複数司会タブ：2回目は「既に終了済み」として安全に同じ確定状態へ。
  resetState();
  closeResponses = [okClose, alreadyClosed];
  const [a, b] = await Promise.all([useLiveHostStore.getState().closeLive(), useLiveHostStore.getState().closeLive()]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, "2回目（既に終了済み）がエラーになった");
  assert.equal(useLiveHostStore.getState().live, null);
  assert.equal(useLiveHostStore.getState().loading, false);
  assert.equal(closeCalls, 2);
  console.log("PASS: 二重クリック・複数司会タブの終了でも、同じ確定状態（ライブ無し・loading解除）になる");
  // 6) ボットのログアウト：removeAllBotsはPromiseを返し、終了処理はその完了を待つ。
  //    遅い・失敗・応答なしでも終了処理自体は完了する（短いタイムアウト＋allSettled）。
  const fakeBot = (signOut: () => Promise<{ error: unknown }>) =>
    ({ participantId: "pb", userId: "ub", displayName: "ボット", client: { auth: { signOut } } }) as never;
  const realWarn = console.warn;
  const warns: string[] = [];
  console.warn = (...a: unknown[]) => {
    warns.push(a.map(String).join(" "));
  };
  try {
    // 6a) 遅いログアウト（100ms）：完了まで待ってから返る。
    resetState();
    closeResponses = [okClose];
    let finished = 0;
    useLiveBotStore.setState({
      bots: [
        fakeBot(async () => {
          await delay(100);
          finished += 1;
          return { error: null };
        }),
        fakeBot(async () => {
          await delay(50);
          finished += 1;
          return { error: null };
        }),
      ],
    });
    const r6a = await useLiveHostStore.getState().closeLive();
    assert.equal(r6a.ok, true);
    assert.equal(finished, 2, "closeLiveがボットのログアウト完了を待たずに返った（通信中断の恐れ）");
    assert.equal(useLiveBotStore.getState().bots.length, 0);
    assert.equal(warns.length, 0, "正常なログアウトで警告が出た");
    console.log("PASS: closeLiveはボットのログアウト完了を待ってから返る（正常時は警告なし）");

    // 6b) ログアウト失敗：警告のみ、終了処理は完了。
    resetState();
    closeResponses = [okClose];
    useLiveBotStore.setState({ bots: [fakeBot(async () => ({ error: { message: "boom" } }))] });
    const r6b = await useLiveHostStore.getState().closeLive();
    assert.equal(r6b.ok, true, "ボットのログアウト失敗で終了処理が失敗した");
    assert.equal(useLiveHostStore.getState().live, null);
    assert.ok(warns.some((w) => w.includes("ログアウトに失敗")), "ログアウト失敗が警告として残っていない");
    console.log("PASS: ボットのログアウト失敗は警告に留まり、終了処理は完了する");

    // 6c) 応答なし（永久に待つ）：短いタイムアウトで打ち切り、終了画面が止まらない（緊急中止も同様）。
    resetState();
    closeResponses = [okClose];
    useLiveBotStore.setState({ bots: [fakeBot(() => new Promise(() => {}))] });
    const t0 = Date.now();
    const r6c = await useLiveHostStore.getState().closeLive();
    const elapsed = Date.now() - t0;
    assert.equal(r6c.ok, true);
    assert.equal(useLiveHostStore.getState().live, null);
    assert.equal(useLiveHostStore.getState().loading, false);
    assert.ok(elapsed < 4_000, `応答しないログアウトで終了処理が${elapsed}ms止まった`);
    assert.ok(warns.some((w) => w.includes("完了しませんでした")), "タイムアウトが警告として残っていない");
    console.log(`PASS: 応答しないボットのログアウトでも、${elapsed}msで打ち切って終了処理が完了する`);
  } finally {
    console.warn = realWarn;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
