// 2026-10-15（2A.2b-W1）：複数のadminタブで司会の自動進行が重複しないことを、
// useLiveHostStore.ts を本番と同じ実装のまま検証する。
// - タブごとにストアのモジュールインスタンス（＝別のJS実行環境）を読み込み直し、
//   偽のWeb Locks（fakeWebLocks.ts）だけをタブ間で共有する。
// - HostProgressController と同じ組み立て（createHostAutoWriter＋attachHostProgressSession）を使う。
// - DB・ステージング・本番へは一切接続しない（Supabaseクライアントのfrom/rpc/channelを偽物に置換）。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import path from "node:path";

import {
  attachHostProgressSession,
  createHostAutoWriter,
  hostIdentityMatches,
  type HostAutoWriter,
} from "@/lib/hostAutoWriter";
import type { AnswerRow, LiveRow } from "@/lib/liveRoomTypes";

import { deferred, FakeEventTarget, FakeWebLocks } from "../fakeWebLocks";

type StoreModule = typeof import("@/store/useLiveHostStore");
type SupabaseModule = typeof import("@/lib/supabase");

// ステージング安全確認(_environment_marker読み取り)を「RPC直前の読み取り」として使い、
// そこで処理を止められるようにする。値はテスト専用のダミー。
process.env.NEXT_PUBLIC_APP_ENV = "staging";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummyref000.supabase.co";
process.env.NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF = "dummyref000";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, timeoutMs = 5_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`待機タイムアウト: ${what}`);
    await sleep(20);
  }
}

// ---- 共有DB（全タブが同じ行を読む）----
const AUTO_RPCS = new Set([
  "host_advance_interlude_to_opening",
  "host_advance_topic_reveal_to_answering",
  "reveal_next_answer_if_due",
  "resolve_answer_if_due",
  "sync_answering_pause_if_due",
  "host_advance_answering_to_group_result",
  "host_advance_group_result_to_next",
]);

const baseLive = {
  id: "live-1",
  current_phase: "opening",
  current_turn_id: "turn-1",
  phase_deadline: "2026-01-01T00:00:00Z",
  answering_paused: false,
  answering_remaining_ms: null,
  next_reveal_pending_at: null,
  reveal_sequence_until: null,
  timing_profile: "standard",
  live_mode: "test",
  access_restricted: false,
  rounds_per_live: 2,
  created_at: "2026-01-01T00:00:00Z",
} as unknown as LiveRow;

const db = {
  live: baseLive as LiveRow | null,
  answers: [] as AnswerRow[],
};

function setLive(patch: Partial<LiveRow>) {
  db.live = { ...baseLive, ...patch } as LiveRow;
}

// 自動進行RPCの応答：進行後は自動進行の無い「周回の判断待ち」へ移す（1経路1回を数えやすくする）。
function afterLive(): LiveRow {
  return { ...baseLive, current_phase: "awaiting_round_decision" } as LiveRow;
}

// ---- 送信記録 ----
interface Call {
  tab: string;
  name: string;
}
let calls: Call[] = [];
const autoCalls = (tab?: string, name?: string) =>
  calls.filter((c) => AUTO_RPCS.has(c.name) && (!tab || c.tab === tab) && (!name || c.name === name));

// ---- タブ ----
interface Tab {
  id: string;
  userId: string;
  identity: { authUserId: string | null; profileId: string | null; isHost: boolean };
  store: StoreModule;
  doc: FakeEventTarget;
  win: FakeEventTarget;
  writer: HostAutoWriter | null;
  detach: (() => void) | null;
  markerGate: Promise<void> | null;
  markerReads: number;
  // 自動進行RPCの物理Promiseを未決着のまま止めるためのゲート（nullなら即応答）。
  rpcGate: Promise<void> | null;
  channelsCreated: number;
  channelsRemoved: number;
  alive: boolean;
}

const locks = new FakeWebLocks();
const tabs: Tab[] = [];

// interval の生成・解除を数える（ストアのtimerが重複・残存しないことの確認用）。
const activeIntervals = new Set<unknown>();
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
// Supabaseクライアント等が内部で作るintervalは数えず、ストア（useLiveHostStore）が作ったものだけを数える。
(global as unknown as Record<string, unknown>).setInterval = ((fn: () => void, ms?: number) => {
  const h = realSetInterval(fn, ms);
  if ((new Error().stack ?? "").includes("useLiveHostStore.js")) activeIntervals.add(h);
  return h;
}) as unknown as typeof setInterval;
(global as unknown as Record<string, unknown>).clearInterval = ((h: ReturnType<typeof setInterval>) => {
  activeIntervals.delete(h);
  realClearInterval(h);
}) as unknown as typeof clearInterval;

const loadedStores: StoreModule[] = [];
function loadModules(): { store: StoreModule; supabase: SupabaseModule["supabase"] } {
  const outDir = process.env.STORE_CHECK_OUT_DIR;
  assert.ok(outDir, "STORE_CHECK_OUT_DIR が未設定");
  // macOSでは一時ディレクトリが/var→/private/varのシンボリックリンクのため、実パスで比較する。
  const roots = [path.join(outDir!, "src") + path.sep, path.join(realpathSync(outDir!), "src") + path.sep];
  for (const key of Object.keys(require.cache)) {
    if (roots.some((r) => key.startsWith(r)) && !key.includes(`${path.sep}__tests__${path.sep}`) && !key.endsWith("hostAutoWriter.js")) {
      delete require.cache[key];
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sb = require("@/lib/supabase") as SupabaseModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require("@/store/useLiveHostStore") as StoreModule;
  assert.ok(!loadedStores.includes(store), "タブごとに別のストアインスタンスを読み込めていない");
  loadedStores.push(store);
  return { store, supabase: sb.supabase };
}

function patchSupabase(sb: SupabaseModule["supabase"], tab: Tab) {
  const tableRows = (table: string): unknown => {
    if (table === "lives") return db.live;
    if (table === "answers") return db.answers;
    if (table === "topic_bank") {
      return ["tb1", "tb2", "tb3", "tb4"].map((id) => ({ id, body: `お題${id}`, format: "normal", is_active: true }));
    }
    if (table === "turns") return [{ id: "turn-1", live_id: "live-1", group_id: "g1", topic_id: "t1", status: "active" }];
    return [];
  };
  const makeChain = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in", "match", "is", "not", "gte", "lte"]) b[m] = () => b;
    b.maybeSingle = async () => {
      if (table === "_environment_marker") {
        tab.markerReads += 1;
        const gate = tab.markerGate;
        if (gate) await gate;
        return { data: { environment: "staging" }, error: null };
      }
      return { data: tableRows(table), error: null };
    };
    b.single = async () => ({ data: table === "lives" ? db.live : null, error: null });
    const write = (op: string) => () => {
      calls.push({ tab: tab.id, name: `${op}:${table}` });
      return Object.assign({}, b, {
        then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(ok, ng),
      });
    };
    b.insert = write("insert");
    b.update = write("update");
    b.upsert = write("upsert");
    b.delete = write("delete");
    b.then = (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tableRows(table), error: null }).then(ok, ng);
    return b;
  };
  const rpcResponse = (name: string): { data: unknown; error: unknown } => {
    if (AUTO_RPCS.has(name)) {
      const next = afterLive();
      const answer = db.answers[0] ? { ...db.answers[0], revealed_at: "2026-01-01T00:00:01Z", resolved: name === "resolve_answer_if_due" } : null;
      db.live = next;
      return { data: { updated: true, live: next, answer, advanced_to: "awaiting_round_decision" }, error: null };
    }
    return { data: { ok: true, updated: true, live: db.live, closed: true, rewards_applied: true }, error: null };
  };
  const anySb = sb as unknown as Record<string, unknown>;
  anySb.from = (table: string) => makeChain(table);
  anySb.rpc = (name: string) => {
    calls.push({ tab: tab.id, name });
    const gate = AUTO_RPCS.has(name) ? tab.rpcGate : null;
    if (gate) {
      // 遅れて決着する旧writerの応答は「更新なし」（DBを進めない）にし、新leaderが最新状態で送れるようにする。
      const settled = gate.then(() => ({ data: { updated: false, live: null, answer: null }, error: null }));
      return { single: () => settled, then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => settled.then(ok, ng) };
    }
    const res = rpcResponse(name);
    return {
      single: () => Promise.resolve(res),
      then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ng),
    };
  };
  anySb.channel = () => {
    tab.channelsCreated += 1;
    const ch: Record<string, unknown> = {};
    ch.on = () => ch;
    ch.subscribe = (cb?: (status: string) => void) => {
      if (cb) queueMicrotask(() => cb("SUBSCRIBED"));
      return ch;
    };
    return ch;
  };
  anySb.removeChannel = async () => {
    tab.channelsRemoved += 1;
    return "ok";
  };
}

function newTab(id: string, opts: { userId?: string; noLocks?: boolean; visible?: boolean } = {}): Tab {
  const { store, supabase } = loadModules();
  const userId = opts.userId ?? "host-user";
  const tab: Tab = {
    id,
    userId,
    identity: { authUserId: userId, profileId: userId, isHost: true },
    store,
    doc: new FakeEventTarget(),
    win: new FakeEventTarget(),
    writer: null,
    detach: null,
    markerGate: null,
    markerReads: 0,
    rpcGate: null,
    channelsCreated: 0,
    channelsRemoved: 0,
    alive: true,
  };
  tab.doc.visibilityState = opts.visible === false ? "hidden" : "visible";
  patchSupabase(supabase, tab);
  tabs.push(tab);
  startSession(tab, opts.noLocks ?? false);
  return tab;
}

// HostProgressController の useEffect と同じ組み立て。
function startSession(tab: Tab, noLocks: boolean, userId: string = tab.userId) {
  const { store } = tab;
  const writer = createHostAutoWriter({
    locks: noLocks ? null : locks.forTab(tab.id),
    isVisible: () => tab.doc.visibilityState === "visible",
    verifyHost: async () => hostIdentityMatches(userId, tab.identity),
    catchUp: store.catchUpHostAutoProgress,
    startAutoTimer: store.startHostAutoProgress,
    stopAutoTimer: store.stopHostAutoProgress,
    waitWritesIdle: store.waitHostAutoWritesIdle,
    onStatus: (status) => store.useLiveHostStore.setState({ autoProgressStatus: status }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  tab.writer = writer;
  tab.detach = attachHostProgressSession({
    targets: { doc: tab.doc, win: tab.win },
    writer,
    startRead: () => {
      void store.useLiveHostStore.getState().init();
    },
    stopAll: () => store.useLiveHostStore.getState().stopHostProgress(),
  });
}

function closeTab(tab: Tab) {
  if (!tab.alive) return;
  tab.alive = false;
  tab.detach?.();
  tab.detach = null;
  locks.closeTab(tab.id);
}

function hide(tab: Tab) {
  tab.doc.visibilityState = "hidden";
  tab.doc.dispatch("visibilitychange");
}

function show(tab: Tab) {
  tab.doc.visibilityState = "visible";
  tab.doc.dispatch("visibilitychange");
}

const timers = (tab: Tab) => tab.store.hostProgressTimerState();
const status = (tab: Tab) => tab.store.useLiveHostStore.getState().autoProgressStatus;
const autoWriters = () => tabs.filter((t) => t.alive && timers(t).autoTimer).map((t) => t.id);

async function closeAll() {
  for (const t of tabs) closeTab(t);
  await sleep(50);
  tabs.length = 0;
  calls = [];
  db.answers = [];
}

// 各経路のDB状態。target は「その経路が送る自動進行RPC」。
interface PathCase {
  label: string;
  target: string;
  setup: () => void;
}

const revealedAnswer = (resolved: boolean): AnswerRow =>
  ({
    id: "ans-1",
    turn_id: "turn-1",
    live_id: "live-1",
    participant_id: "p1",
    seq: 1,
    body: "回答",
    revealed_at: "2026-01-01T00:00:01Z",
    judging_ends_at: "2026-01-01T00:00:05Z",
    resolved,
    created_at: "2026-01-01T00:00:00Z",
  }) as unknown as AnswerRow;

const PATHS: PathCase[] = [
  {
    label: "interlude",
    target: "host_advance_interlude_to_opening",
    setup: () => setLive({ current_phase: "interlude" }),
  },
  {
    label: "topic_reveal",
    target: "host_advance_topic_reveal_to_answering",
    setup: () => setLive({ current_phase: "topic_reveal" }),
  },
  {
    label: "回答reveal",
    target: "reveal_next_answer_if_due",
    setup: () => {
      setLive({ current_phase: "answering", answering_paused: true });
      db.answers = [{ ...revealedAnswer(false), revealed_at: null } as unknown as AnswerRow];
    },
  },
  {
    label: "resolve",
    target: "resolve_answer_if_due",
    setup: () => {
      setLive({ current_phase: "answering", answering_paused: true });
      db.answers = [revealedAnswer(false)];
    },
  },
  {
    label: "pause同期",
    target: "sync_answering_pause_if_due",
    setup: () => {
      setLive({ current_phase: "answering", answering_paused: true });
      db.answers = [];
    },
  },
  {
    label: "answering→group_result",
    target: "host_advance_answering_to_group_result",
    setup: () => {
      setLive({ current_phase: "answering", answering_paused: false });
      db.answers = [];
    },
  },
  {
    label: "group_result以降",
    target: "host_advance_group_result_to_next",
    setup: () => setLive({ current_phase: "group_result" }),
  },
];

async function main() {
  let unhandled = 0;
  process.on("unhandledRejection", () => {
    unhandled += 1;
  });

  // ===== 1) 単一leader・非leaderの読み取り/手動操作・/live/host の迂回防止 =====
  {
    setLive({ current_phase: "opening" }); // 自動進行の無いフェーズで開始
    const a = newTab("A");
    const b = newTab("B"); // 同時に開始・lock要求
    await waitFor(() => autoWriters().length === 1, "leader 1件");
    await waitFor(
      () => [a, b].every((t) => !t.store.useLiveHostStore.getState().loading && timers(t).readTimer),
      "両タブの読み取り開始",
    );
    const leader = autoWriters()[0] === "A" ? a : b;
    const follower = leader === a ? b : a;
    await waitFor(() => status(follower) === "standby", "非leaderの表示『別タブが担当中』");
    assert.equal(status(leader), "leader");
    assert.equal(timers(follower).autoTimer, false, "非leaderに自動timerがある");
    assert.equal(follower.store.useLiveHostStore.getState().live?.id, "live-1", "非leaderの司会画面が空");
    assert.ok(follower.channelsCreated >= 5, "非leaderがRealtime購読していない");
    // interval総数：読み取りtick×2＋自動tick×1
    assert.equal(activeIntervals.size, 3, `intervalの本数が想定外: ${activeIntervals.size}`);

    // 自動進行RPCは leader から1回だけ（topic_revealへ切り替えて観察）
    setLive({ current_phase: "topic_reveal" });
    await leader.store.useLiveHostStore.getState().refresh();
    await follower.store.useLiveHostStore.getState().refresh();
    await waitFor(() => autoCalls().length >= 1, "自動進行RPC");
    await sleep(1_200);
    assert.deepEqual(
      autoCalls().map((c) => `${c.tab}:${c.name}`),
      [`${leader.id}:host_advance_topic_reveal_to_answering`],
      "自動進行RPCがleaderから1回だけでない",
    );

    // /live/host ページの init()・手動refresh・復帰イベントを非leaderで重ねても自動timerは作られない
    setLive({ current_phase: "topic_reveal" });
    calls = [];
    for (let i = 0; i < 3; i++) void follower.store.useLiveHostStore.getState().init();
    await follower.store.useLiveHostStore.getState().refresh();
    follower.win.dispatch("focus");
    follower.win.dispatch("pageshow");
    follower.win.dispatch("online");
    follower.doc.dispatch("visibilitychange");
    leader.win.dispatch("focus");
    leader.win.dispatch("pageshow");
    leader.win.dispatch("online");
    void leader.store.useLiveHostStore.getState().init();
    await sleep(1_500);
    assert.equal(timers(follower).autoTimer, false, "/live/host 側の init/refresh で自動timerが作られた（迂回）");
    assert.equal(autoCalls(follower.id).length, 0, "非leaderから自動進行RPCが送られた");
    assert.equal(activeIntervals.size, 3, `init/focus/pageshow/online の重複でintervalが増えた: ${activeIntervals.size}`);
    console.log("PASS: 単一leader（leader1件・自動timer1本・RPC1回、非leaderは表示/Realtime継続、/live/hostのinit・refresh・復帰イベントでも迂回しない）");

    // 手動司会操作は非leaderでも従来どおり送れる
    setLive({ current_phase: "opening" });
    await follower.store.useLiveHostStore.getState().refresh();
    calls = [];
    const st = follower.store.useLiveHostStore;
    const setPhase = (phase: string) => {
      setLive({ current_phase: phase as LiveRow["current_phase"] });
      st.setState({ live: db.live });
    };
    const manual: [string, string, () => Promise<{ ok: boolean; reason?: string }>][] = [
      ["最新状態の取得", "", () => st.getState().refresh()],
      ["受付開始", "open_reception", async () => (setPhase("scheduled"), st.getState().openReception())],
      ["組分け", "randomize_groups", async () => (setPhase("opening"), st.getState().randomizeGroups())],
      ["ゲーム開始", "begin_game", async () => (setPhase("opening"), st.getState().beginGame())],
      ["お題変更", "update:topics", () => st.getState().changeTopicAssignment("t1", { id: "tb1", body: "お題", format: "normal" } as never)],
      ["回答・採点（審査員数の再計算）", "resync_eligible_judge_counts", async () => (setPhase("answering"), st.getState().resyncEligibleJudgeCounts())],
      ["回答・採点（退場）", "kick_participant", () => st.getState().kickParticipant("p1")],
      ["次の周", "host_add_next_round", async () => (setPhase("awaiting_round_decision"), st.getState().addNextRound([]))],
      ["最終結果", "host_finish_live_from_round_decision", async () => (setPhase("awaiting_round_decision"), st.getState().finishLiveFromRoundDecision())],
      ["通常終了", "close_live", async () => (setPhase("final_result"), st.getState().closeLive())],
      ["緊急中止", "emergency_close_live", async () => (setPhase("answering"), st.getState().emergencyCloseLive("test"))],
    ];
    const notSent: string[] = [];
    for (const [label, name, run] of manual) {
      const before = calls.length;
      await run();
      if (name && !calls.slice(before).some((c) => c.tab === follower.id && c.name === name)) notSent.push(`${label}(${name})`);
    }
    // 次の周はお題0件だと入力確認で止まる仕様のため、組が無い状態で送られることを別途確認する。
    const filtered = notSent.filter((n) => !n.startsWith("次の周"));
    assert.deepEqual(filtered, [], `非leaderで手動操作が送られなかった: ${notSent.join(",")}`);
    if (notSent.some((n) => n.startsWith("次の周"))) {
      const before = calls.length;
      setPhase("awaiting_round_decision");
      st.setState({ groups: [{ id: "g1", live_id: "live-1" } as never] });
      await st.getState().addNextRound([{ groupId: "g1", topicBody: "次のお題" }]);
      assert.ok(
        calls.slice(before).some((c) => c.tab === follower.id && c.name === "host_add_next_round"),
        "非leaderで次の周を送れない",
      );
    }
    // ライブ準備（進行中ライブが無い状態）
    {
      db.live = null;
      st.setState({ live: null });
      const before = calls.length;
      await st.getState().createLivePreparation({
        title: "テスト",
        scheduledAt: "2026-12-01T10:00:00Z",
        maxPlayers: null,
        groupCount: 1,
        topicSelection: { mode: "manual", topicBankIds: ["tb1", "tb2", "tb3", "tb4"] },
        liveMode: "test",
        manualOfficialSequenceNumber: null,
        timingProfile: "standard",
      });
      assert.ok(
        calls.slice(before).some((c) => c.tab === follower.id && c.name === "create_live_preparation"),
        `非leaderでライブ準備を送れない: ${calls.slice(before).map((c) => c.name).join(",")}`,
      );
    }
    assert.equal(autoCalls(follower.id).length, 0, "手動操作に紛れて非leaderから自動進行RPCが送られた");
    console.log("PASS: 手動司会操作（ライブ準備・受付開始・組分け・ゲーム開始・お題変更・回答/採点・次の周・最終結果・通常終了・緊急中止・最新状態の取得）は非leaderでも送れる");
    await closeAll();
  }

  // ===== 2) 各自動進行経路の leadership 喪失競合 =====
  for (const pc of PATHS) {
    db.answers = [];
    pc.setup();
    const a = newTab(`A-${pc.label}`);
    const gate = deferred();
    a.markerGate = gate.promise; // 1. leaderとしてtick開始 → 2. RPC前の読み取り(安全確認)で停止
    await waitFor(() => a.markerReads >= 1, `${pc.label}: Aが RPC 前の読み取りで停止`);
    assert.equal(autoCalls().length, 0);
    const b = newTab(`B-${pc.label}`);
    await waitFor(() => status(b) === "standby", `${pc.label}: Bが待機`);
    hide(a); // 3. leadershipを別タブへ
    await waitFor(() => autoCalls(b.id, pc.target).length >= 1, `${pc.label}: 新leader Bが送信`);
    gate.resolve(); // 4. 古い読み取りを完了
    await sleep(1_200);
    assert.equal(autoCalls(a.id).length, 0, `${pc.label}: 旧leaderのRPCが0件でない`); // 5
    assert.equal(autoCalls(b.id, pc.target).length, 1, `${pc.label}: 新leaderの送信が1回でない`); // 6
    assert.equal(autoCalls().length, 1, `${pc.label}: 自動進行RPCが合計1回でない: ${autoCalls().map((c) => c.name).join(",")}`);
    assert.equal(timers(a).autoTimer, false, `${pc.label}: hiddenの旧leaderの自動timerが残っている`);
    console.log(`PASS: leadership喪失競合 - ${pc.label}（旧leader 0件・新leaderだけ最新状態で1回）`);
    await closeAll();
  }

  // ===== 3) visibility・全タブhidden・復帰 =====
  {
    setLive({ current_phase: "opening" });
    const a = newTab("A");
    await waitFor(() => autoWriters().length === 1, "A leader");
    const b = newTab("B");
    await waitFor(() => status(b) === "standby", "B待機");
    hide(a);
    await waitFor(() => autoWriters().join() === "B", "Bが引き継ぎ");
    show(a);
    await sleep(300);
    assert.deepEqual(autoWriters(), ["B"], "再visibleのAが現在のleaderを奪った");
    hide(a);
    hide(b);
    await sleep(100);
    assert.deepEqual(autoWriters(), [], "全タブhiddenなのに自動timerがある");
    setLive({ current_phase: "topic_reveal" });
    calls = [];
    await sleep(1_200);
    assert.equal(autoCalls().length, 0, "全タブhidden中に自動進行RPCが送られた");
    show(b);
    await waitFor(() => autoCalls(b.id).length === 1, "復帰したBが最新状態で送信");
    assert.equal(b.store.useLiveHostStore.getState().live?.current_phase, "awaiting_round_decision");
    assert.equal(autoCalls().length, 1);
    console.log("PASS: visibility（hiddenで引き継ぎ・復帰しても奪わない・全hiddenでRPC 0・復帰時は最新状態を取り直して再開）");
    await closeAll();
  }

  // ===== 4) leaderを閉じる → 1件だけ引き継ぐ／reload・bfcache =====
  {
    setLive({ current_phase: "opening" });
    const a = newTab("A");
    await waitFor(() => autoWriters().length === 1, "A leader");
    const b = newTab("B");
    const c = newTab("C");
    await waitFor(() => status(b) === "standby" && status(c) === "standby", "B・C待機");
    assert.deepEqual(autoWriters(), ["A"]);
    closeTab(c);
    await sleep(100);
    assert.deepEqual(autoWriters(), ["A"], "非leaderを閉じたらAが影響を受けた");
    closeTab(a);
    await waitFor(() => autoWriters().length === 1, "1件が引き継ぎ");
    assert.deepEqual(autoWriters(), ["B"]);
    // reload（Bを閉じて開き直す）
    closeTab(b);
    const b2 = newTab("B-reload");
    await waitFor(() => autoWriters().length === 1, "reload後のleader");
    assert.deepEqual(autoWriters(), ["B-reload"]);
    // bfcache（pagehide→pageshow）
    const d = newTab("D");
    await waitFor(() => status(d) === "standby", "D待機");
    b2.win.dispatch("pagehide");
    await waitFor(() => autoWriters().join() === "D", "pagehideで引き継ぎ");
    b2.win.dispatch("pageshow");
    await sleep(300);
    assert.deepEqual(autoWriters(), ["D"], "bfcache復帰でwriterが2件になった");
    console.log("PASS: タブの増減（非leader閉鎖で影響なし・leader閉鎖で1件だけ引き継ぎ・reload/bfcacheでも最大1件）");
    await closeAll();
  }

  // ===== 5) logout・isHost剥奪・別ユーザーへの切り替え =====
  {
    setLive({ current_phase: "topic_reveal" });
    const a = newTab("A", { userId: "user-a" });
    const gate = deferred();
    a.markerGate = gate.promise;
    await waitFor(() => a.markerReads >= 1, "Aが RPC 前で停止");
    // ログアウト（HostProgressControllerのeffect cleanup）
    a.identity = { authUserId: null, profileId: null, isHost: false };
    a.detach!();
    a.detach = null;
    gate.resolve();
    await sleep(1_200);
    assert.equal(autoCalls().length, 0, "logout後に古いtickが自動進行RPCを送った");
    assert.deepEqual(timers(a), { readTimer: false, autoTimer: false }, "logout後にtimerが残っている");
    assert.equal(a.channelsRemoved >= a.channelsCreated, true, "logout後にRealtime購読が残っている");
    assert.equal(a.doc.listenerCount() + a.win.listenerCount(), 0, "logout後にlistenerが残っている");
    assert.equal(locks.holderCount(), 0, "logout後にlockが残っている");
    console.log("PASS: logoutでlock解放・timer/Realtime/listener 0・古いtickのRPC 0件");

    // 同じタブ（同じJS環境）で別ユーザーとしてやり直す：古いtickのticketは新しいwriterで有効にならない
    a.markerGate = null;
    const gate2 = deferred();
    a.identity = { authUserId: "user-a", profileId: "user-a", isHost: true };
    a.markerGate = gate2.promise;
    startSession(a, false, "user-a");
    await waitFor(() => a.markerReads >= 2, "user-aのtickが停止");
    a.detach!(); // user-a → user-b へ切替（cleanup）
    a.identity = { authUserId: "user-b", profileId: "user-b", isHost: true };
    a.markerGate = null;
    startSession(a, false, "user-b");
    await waitFor(() => autoCalls(a.id).length === 1, "user-bとして1回送信");
    // user-b側は送信後「周回の判断待ち」を反映済みで、以後は送らない。user-aの古いtickは
    // topic_revealの前提を持ったまま止まっているので、ticketが有効扱いになれば送ってしまう。
    gate2.resolve();
    await sleep(1_200);
    assert.equal(autoCalls(a.id).length, 1, "別ユーザーへ切り替わった古いtickが自動進行RPCを送った");
    a.detach!();
    a.detach = null;
    console.log("PASS: 別ユーザーへ切り替わった古い処理は反映されない（ticketは作り直しても重複しない）");

    // isHost剥奪：leader判定中（認証確認）に失敗 → fail-closed
    await closeAll();
    setLive({ current_phase: "topic_reveal" });
    const h = newTab("H", { userId: "user-h" });
    h.identity = { authUserId: "user-h", profileId: "user-h", isHost: false }; // 確認時点で剥奪済み
    await sleep(1_200);
    assert.equal(timers(h).autoTimer, false, "isHost剥奪後に自動timerが動いた");
    assert.equal(autoCalls().length, 0, "isHost剥奪後に自動進行RPCが送られた");
    assert.equal(locks.holderCount(), 0, "fail-closed後もlockを握っている");
    console.log("PASS: isHost剥奪（認証確認失敗）はfail-closed（timer・RPC 0、lockを手放す）");
    await closeAll();
  }

  // ===== 6) Web Locks非対応 =====
  {
    setLive({ current_phase: "topic_reveal" });
    const logged: unknown[] = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...x: unknown[]) => logged.push(x);
    console.warn = (...x: unknown[]) => logged.push(x);
    const before = unhandled;
    try {
      const u = newTab("U", { noLocks: true });
      await waitFor(() => !u.store.useLiveHostStore.getState().loading, "読み取り完了");
      await sleep(1_200);
      assert.equal(timers(u).autoTimer, false, "非対応なのに自動timerがある");
      assert.equal(timers(u).readTimer, true, "非対応で読み取りまで止まった");
      assert.equal(autoCalls().length, 0, "非対応なのに自動進行RPCが送られた");
      assert.equal(status(u), "unsupported");
      const r = await u.store.useLiveHostStore.getState().emergencyCloseLive("test");
      assert.equal(r.ok, true, "非対応で手動操作が使えない");
      assert.ok(calls.some((c) => c.tab === "U" && c.name === "emergency_close_live"));
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
    assert.equal(logged.length, 0, `非対応時にconsole出力があった: ${JSON.stringify(logged)}`);
    assert.equal(unhandled, before, "非対応時に未処理Promiseがあった");
    console.log("PASS: Web Locks非対応（自動timer・RPC 0、読み取り・手動操作は可能、unsupported表示、console/未処理Promise 0）");
    await closeAll();
  }

  // ===== 7) Strict Mode相当・stop後の後片付け =====
  {
    setLive({ current_phase: "opening" });
    const s = newTab("S");
    s.detach!(); // mount → cleanup
    startSession(s, false); // → mount
    const t = newTab("T");
    await waitFor(() => autoWriters().length === 1 && status(t) === "standby", "Strict Mode後のleader");
    assert.equal(activeIntervals.size, 3, `Strict Mode後のinterval本数が想定外: ${activeIntervals.size}`);
    s.detach!();
    s.detach = null;
    t.detach!();
    t.detach = null;
    await sleep(100);
    assert.equal(activeIntervals.size, 0, "停止後にintervalが残っている");
    assert.equal(locks.holderCount() + locks.pendingCount(), 0, "停止後にlock・待機要求が残っている");
    for (const x of [s, t]) {
      assert.ok(x.channelsRemoved >= x.channelsCreated, "停止後にRealtime購読が残っている");
      assert.equal(x.doc.listenerCount() + x.win.listenerCount(), 0, "停止後にlistenerが残っている");
    }
    console.log("PASS: Strict Mode相当でもwriter最大1件、停止後はinterval・lock・待機要求・Realtime・listener 0");
    await closeAll();
  }

  // ===== 8) 送信済みの自動書き込みが未決着の間はlockを返さない（ストア実体の runAutoWrite 経由）=====
  for (const trigger of ["hidden", "pagehide", "unmount"] as const) {
    setLive({ current_phase: "topic_reveal" });
    const a = newTab(`A-${trigger}`);
    const rpcGate = deferred();
    a.rpcGate = rpcGate.promise; // 物理Promiseを未決着にする
    await waitFor(() => autoCalls(a.id).length === 1, `${trigger}: Aが送信`);
    const b = newTab(`B-${trigger}`);
    await waitFor(() => status(b) === "standby", `${trigger}: B待機`);
    if (trigger === "hidden") hide(a);
    else if (trigger === "pagehide") a.win.dispatch("pagehide");
    else {
      a.detach!();
      a.detach = null;
    }
    await sleep(1_500);
    assert.equal(locks.holderTab(), a.id, `${trigger}: 未決着なのにAがlockを返した`);
    assert.deepEqual(autoWriters(), [], `${trigger}: 未決着なのにwriterがいる`);
    assert.equal(timers(b).autoTimer, false, `${trigger}: 未決着なのにBが自動進行を開始した`);
    assert.equal(autoCalls().length, 1, `${trigger}: 自動書き込みRPCが1本から増えた`);
    // 新leaderが最新状態を取り直して送れるよう、DBは引き続きtopic_revealのまま（Aの応答で進めない）。
    rpcGate.resolve();
    await waitFor(() => locks.holderTab() === b.id, `${trigger}: 決着後にBがlock取得`);
    await waitFor(() => autoCalls(b.id).length >= 1, `${trigger}: Bが送信`);
    await sleep(800);
    assert.equal(autoCalls(a.id).length, 1, `${trigger}: 旧Aから追加送信があった`);
    assert.equal(autoCalls(b.id).length, 1, `${trigger}: Bの送信が1回でない`);
    assert.notEqual(status(a), "leader");
    console.log(`PASS: ${trigger} - 送信済みの自動書き込みが決着するまでlockを保持し、決着後にだけBが引き継いで1回送信`);
    await closeAll();
  }

  assert.equal(unhandled, 0, "未処理Promiseがあった");
  console.log("ALL USE_LIVE_HOST_STORE_AUTO_WRITER CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
