// useLiveFollowerStore.subscribe() の認証連動（未認証では何も開始しない）と、
// 組切替時の正常な世代交代を「取得失敗」扱いしないことの検証。
// 実行方法は src/lib/__tests__/run.sh 参照（専用tsconfig＋pathAliasHook経由）。
//
// 修正前の問題：未ログインで /live を開くと participants_for_live（anonへ権限なし）が
// 約2.3秒ごとに401になり「参加者情報の取得に失敗しました」が繰り返された。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { LiveRow, ParticipantRow } from "@/lib/liveRoomTypes";
import { refreshTurnDerivedDetailed, useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useAuthStore } from "@/store/useAuthStore";

// node環境用のdocument/windowの最小スタブ（visibilitychange/onlineリスナー用）。
const listeners: Record<string, Set<unknown>> = {};
const fakeTarget = {
  addEventListener: (type: string, fn: unknown) => {
    (listeners[type] ??= new Set()).add(fn);
  },
  removeEventListener: (type: string, fn: unknown) => {
    listeners[type]?.delete(fn);
  },
  visibilityState: "visible",
};
(global as unknown as Record<string, unknown>).document = fakeTarget;
(global as unknown as Record<string, unknown>).window = fakeTarget;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- タイマー計測（この store が作る 5秒tick の setInterval と、再試行の setTimeout） ----
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
let activeIntervals = 0;
const intervalIds = new Set<unknown>();
(global as unknown as { setInterval: unknown }).setInterval = ((fn: () => void, ms: number, ...rest: unknown[]) => {
  const id = realSetInterval(fn, ms, ...rest);
  if (ms === 5_000) {
    activeIntervals += 1;
    intervalIds.add(id);
  }
  return id;
}) as unknown;
(global as unknown as { clearInterval: unknown }).clearInterval = ((id: unknown) => {
  if (intervalIds.delete(id)) activeIntervals -= 1;
  return realClearInterval(id as never);
}) as unknown;

// ---- supabase スタブ ----
const LIVE_ID = "live-1";
const liveRow = {
  id: LIVE_ID,
  current_phase: "answering",
  current_turn_id: null,
  phase_deadline: null,
  answering_paused: false,
  timing_profile: "standard",
  live_mode: "test",
} as unknown as LiveRow;

let rpcCalls: string[] = [];
let channelsCreated = 0;
let channelsRemoved = 0;
let fromCalls: string[] = [];
let participantsRpcImpl: () => Promise<{ data: unknown; error: unknown }> = async () => ({ data: [], error: null });

function thenable(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "order", "limit", "in", "maybeSingle"]) b[m] = () => b;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return b;
}
(supabase as unknown as Record<string, unknown>).from = (table: string) => {
  fromCalls.push(table);
  if (table === "lives") return thenable({ data: liveRow, error: null });
  return thenable({ data: [], error: null });
};
(supabase as unknown as Record<string, unknown>).rpc = (name: string) => {
  rpcCalls.push(name);
  if (name === "participants_for_live") return participantsRpcImpl();
  if (name === "advance_live_progress_if_due") {
    return { single: async () => ({ data: { updated: false, live: liveRow }, error: null }) };
  }
  return Promise.resolve({ data: [], error: null });
};
(supabase as unknown as Record<string, unknown>).channel = () => {
  channelsCreated += 1;
  const ch: Record<string, unknown> = {};
  ch.on = () => ch;
  ch.subscribe = () => ch;
  return ch;
};
(supabase as unknown as Record<string, unknown>).removeChannel = async () => {
  channelsRemoved += 1;
  return "ok";
};

const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
};

function reset() {
  rpcCalls = [];
  fromCalls = [];
  channelsCreated = 0;
  channelsRemoved = 0;
  warnings.length = 0;
  participantsRpcImpl = async () => ({ data: [], error: null });
}
const setUser = (id: string | null, anonymous = false) =>
  useAuthStore.setState({ user: id ? ({ id, is_anonymous: anonymous } as never) : null, loading: false });
const participantRow = (id: string, userId: string) =>
  ({ id, live_id: LIVE_ID, user_id: userId, role: "audience", group_id: null, joined_at: "2026-01-01T00:00:00Z" }) as unknown as ParticipantRow;

async function main() {
  // ---- 1) 未認証：participants_for_live・購読・tick・再試行を一切開始しない ----
  reset();
  setUser(null);
  const unsubscribe = useLiveFollowerStore.getState().subscribe();
  await delay(300);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 0, "未認証なのにparticipants_for_liveを呼んでいる");
  assert.equal(rpcCalls.length, 0, `未認証なのにRPCを呼んでいる: ${rpcCalls.join(",")}`);
  assert.equal(fromCalls.length, 0, "未認証なのにテーブル取得をしている");
  assert.equal(channelsCreated, 0, "未認証なのにRealtimeチャンネルを購読している");
  assert.equal(activeIntervals, 0, "未認証なのに進行補助tick(setInterval)を開始している");
  assert.equal(warnings.length, 0, `未認証なのにconsole警告が出ている: ${warnings.join(" / ")}`);
  console.log("PASS: 未認証ではparticipants_for_live呼び出し0回・Realtime購読0件・進行tick0件・再試行0件・警告0件");

  // ---- 2) 未認証→ゲスト認証：同じsubscribeのまま、初回取得と購読が1回だけ開始 ----
  setUser("guest-1", true);
  await delay(300);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 1, "ゲスト認証後の初回取得が1回になっていない");
  assert.equal(channelsCreated, 6, `ゲスト認証後のRealtime購読が1回分(6チャンネル)になっていない: ${channelsCreated}`);
  assert.equal(activeIntervals, 1, "ゲスト認証後の進行tickが1本になっていない");
  assert.equal(useLiveFollowerStore.getState().loading, false, "認証後に取得が完了していない");
  assert.equal(warnings.length, 0, "認証後の初回取得で警告が出ている");
  console.log("PASS: 未認証→ゲスト認証で、初回取得(participants_for_live)と購読が1回だけ開始される");

  // 認証イベントの再通知（トークン更新など。同じuser id）では再開始しない。
  useAuthStore.setState({ user: { id: "guest-1", is_anonymous: true } as never });
  await delay(100);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 1, "同じ利用者の認証イベントで取得をやり直している");
  assert.equal(channelsCreated, 6, "同じ利用者の認証イベントで購読を張り直している");
  console.log("PASS: 同じ利用者の認証イベント（トークン更新等）では再取得・再購読しない");

  // ---- 3) ログアウト：購読・タイマー・再試行を停止し、状態を破棄 ----
  setUser(null);
  await delay(100);
  assert.equal(channelsRemoved, 6, "ログアウトでRealtimeチャンネルが除去されていない");
  assert.equal(activeIntervals, 0, "ログアウトで進行tickが停止していない");
  assert.equal(useLiveFollowerStore.getState().live, null, "ログアウト後も前の利用者のライブ状態が残っている");
  assert.equal(useLiveFollowerStore.getState().loading, true, "ログアウト後にloadingが初期状態に戻っていない");
  const rpcBefore = rpcCalls.length;
  await delay(300);
  assert.equal(rpcCalls.length, rpcBefore, "ログアウト後も通信が続いている");
  console.log("PASS: ログアウトで購読・tick・再試行を停止し、前の利用者の状態を破棄する");

  // ---- 4) 再ログイン（別利用者）：新しい世代で取得し、古い取得結果は反映しない ----
  reset();
  // 利用者Aの取得を保留し、その間にログアウト→利用者Bでログインする。
  let resolveA: (v: { data: unknown; error: unknown }) => void = () => {};
  participantsRpcImpl = () => new Promise((r) => (resolveA = r));
  setUser("user-a");
  await delay(200);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 1);
  setUser(null);
  participantsRpcImpl = async () => ({ data: [participantRow("pB", "user-b")], error: null });
  setUser("user-b");
  await delay(300);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 2, "再ログイン後に新しい世代で取得されていない");
  assert.deepEqual(
    useLiveFollowerStore.getState().participants.map((p) => p.id),
    ["pB"],
    "再ログイン後の状態が利用者Bの取得結果になっていない",
  );
  // ここで古い（利用者Aの）取得結果が遅れて届く。
  resolveA({ data: [participantRow("pA", "user-a")], error: null });
  await delay(200);
  assert.deepEqual(
    useLiveFollowerStore.getState().participants.map((p) => p.id),
    ["pB"],
    "古い利用者Aの取得結果が、利用者Bの状態へ反映されてしまった",
  );
  assert.equal(useLiveFollowerStore.getState().myParticipant?.user_id, "user-b");
  assert.equal(activeIntervals, 1, "再ログイン後にtickが1本になっていない（二重に開始している）");
  console.log("PASS: ログアウト→別利用者で再ログインは新しい世代で再取得し、古い取得結果は反映されない");

  // ---- 5) 未認証→Xログイン（同じ経路。Xは匿名ではない利用者）----
  unsubscribe();
  await delay(50);
  assert.equal(activeIntervals, 0, "unsubscribeでtickが停止していない");
  reset();
  setUser(null);
  const unsub2 = useLiveFollowerStore.getState().subscribe();
  await delay(100);
  assert.equal(rpcCalls.length, 0);
  setUser("x-user", false);
  await delay(300);
  assert.equal(rpcCalls.filter((n) => n === "participants_for_live").length, 1, "Xログイン後の初回取得が1回になっていない");
  unsub2();
  console.log("PASS: 未認証→Xログインでも初回取得は1回だけ、unsubscribeで全停止");

  // ---- 6) 組切替の正常競合（追い越し）は取得失敗として扱わない ----
  reset();
  setUser("user-c");
  const unsub3 = useLiveFollowerStore.getState().subscribe();
  await delay(300);
  useLiveFollowerStore.setState({ syncError: null });
  warnings.length = 0;
  // current_turn_id が立った状態。2つの取得を重ねると、先発は「追い越された」ことになる。
  useLiveFollowerStore.setState({ live: { ...liveRow, current_turn_id: "turn-1" } as never });
  const turnRows = { data: { id: "turn-1", live_id: LIVE_ID, group_id: "g1", topic_id: "tp1", round: 1, status: "active" }, error: null };
  (supabase as unknown as Record<string, unknown>).from = (table: string) => {
    if (table === "turns" || table === "topics") return thenable(turnRows);
    return thenable({ data: [], error: null });
  };
  const first = refreshTurnDerivedDetailed();
  const second = refreshTurnDerivedDetailed();
  const [o1, o2] = await Promise.all([first, second]);
  assert.equal(o1, "superseded", "先発の取得が追い越された結果(superseded)として返っていない");
  assert.notEqual(o2, "superseded");
  assert.equal(useLiveFollowerStore.getState().syncError, null, "追い越し（正常な世代交代）でsyncErrorが立った");
  assert.equal(
    warnings.filter((w) => w.includes("進行状況の取得に失敗")).length,
    0,
    "追い越し（正常な世代交代）で「進行状況の取得に失敗しました」の警告が出た",
  );
  console.log("PASS: 組切替などの取得の追い越し(superseded)はエラー・警告・再試行の対象にならない");

  // 本当の取得エラーは従来どおり failed として検知される。
  (supabase as unknown as Record<string, unknown>).from = () => thenable({ data: null, error: { message: "network down" } });
  const failed = await refreshTurnDerivedDetailed();
  assert.equal(failed, "failed", "本当の取得エラーがfailedとして検知されていない");
  console.log("PASS: 本当の取得エラーは従来どおり failed として検知される");
  unsub3();
}

main()
  .then(() => {
    console.warn = realWarn;
    process.exit(0);
  })
  .catch((e) => {
    console.warn = realWarn;
    console.error(e);
    process.exit(1);
  });
