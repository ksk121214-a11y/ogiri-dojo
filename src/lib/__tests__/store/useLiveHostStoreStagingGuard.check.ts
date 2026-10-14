// ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)を、
// useLiveHostStoreの実際の書き込み操作へ実呼び出しで検証する。
// 対象：受付開始(openReception)・参加制限変更(setAccessRestricted)・
// 通常終了(closeLive)・緊急中止(emergencyCloseLive)・自動進行(advanceIfDue経由のtick)。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { LiveRow } from "@/lib/liveRoomTypes";
import { startHostAutoProgress, useLiveHostStore } from "@/store/useLiveHostStore";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const STAGING_ENV = {
  NEXT_PUBLIC_APP_ENV: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging-ref-abc123.supabase.co",
  NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "staging-ref-abc123",
};

// --- 書き込み記録（テーブル名＋種別、RPC名）。全Supabase書き込みの合計をここで数える。---
let writeLog: string[] = [];
function recordWrite(entry: string) {
  writeLog.push(entry);
}

// --- _environment_marker の応答を切り替えるためのモード。---
type MarkerMode = "staging-row" | "no-row" | "no-table" | "error" | "throw";
let markerMode: MarkerMode = "staging-row";

const liveRow = {
  id: "live-1",
  current_phase: "scheduled",
  current_turn_id: null,
  phase_deadline: null,
  answering_paused: false,
  timing_profile: "standard",
  live_mode: "test",
  access_restricted: false,
  rounds_per_live: 2,
  created_at: "2026-01-01T00:00:00Z",
} as unknown as LiveRow;

type TableName = string;
// "lives"だけは可変（init()経由のfetchActiveLive/fetchLiveRowが、Zustand storeの
// stateではなく常にこのmock応答を直接読むため、current_phaseを変えるテストでは
// 明示的にここも更新する必要がある）。
let currentLiveRow: LiveRow = liveRow;
const tableReadResponse: Record<TableName, { data: unknown; error: unknown }> = {
  get lives() {
    return { data: currentLiveRow, error: null };
  },
  participants: { data: [], error: null },
  groups: { data: [], error: null },
  topics: { data: [], error: null },
  turns: { data: [], error: null },
  answers: { data: [], error: null },
  scores: { data: [], error: null },
  profiles: { data: [], error: null },
  topic_bank: { data: [], error: null },
};

function markerResponse(): { data: unknown; error: unknown } {
  switch (markerMode) {
    case "staging-row":
      return { data: { environment: "staging" }, error: null };
    case "no-row":
      return { data: null, error: null };
    case "no-table":
      return { data: null, error: { message: 'relation "_environment_marker" does not exist' } };
    case "error":
      return { data: null, error: { message: "connection error" } };
    case "throw":
      throw new Error("network down");
  }
}

function makeChain(table: TableName) {
  const b: Record<string, unknown> = {};
  const passthrough = ["select", "eq", "neq", "order", "limit", "in", "match", "is"];
  for (const m of passthrough) b[m] = () => b;
  b.maybeSingle = () => {
    if (table === "_environment_marker") return Promise.resolve(markerResponse());
    return Promise.resolve(tableReadResponse[table] ?? { data: null, error: null });
  };
  b.single = () => {
    if (table === "lives") return Promise.resolve({ data: currentLiveRow, error: null });
    return Promise.resolve(tableReadResponse[table] ?? { data: null, error: null });
  };
  b.insert = () => {
    recordWrite(`insert:${table}`);
    return Object.assign({}, b, {
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    });
  };
  b.update = () => {
    recordWrite(`update:${table}`);
    return b;
  };
  b.upsert = () => {
    recordWrite(`upsert:${table}`);
    return Object.assign({}, b, {
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    });
  };
  b.delete = () => {
    recordWrite(`delete:${table}`);
    return b;
  };
  b.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve(tableReadResponse[table] ?? { data: null, error: null }).then(ok);
  return b;
}

(supabase as unknown as Record<string, unknown>).from = (table: string) => makeChain(table);

type RpcResponse = { data: unknown; error: unknown };
const rpcResponses: Record<string, RpcResponse> = {
  open_reception: { data: { updated: true, live: liveRow, reason: null }, error: null },
  close_live: {
    data: { closed: true, rewards_applied: true, rewards_error: null, error_code: null },
    error: null,
  },
  emergency_close_live: { data: { updated: true, live: liveRow, error_code: null }, error: null },
  host_advance_topic_reveal_to_answering: { data: { updated: true, live: liveRow }, error: null },
};

(supabase as unknown as Record<string, unknown>).rpc = (name: string) => {
  recordWrite(`rpc:${name}`);
  const res = rpcResponses[name] ?? { data: null, error: null };
  return {
    single: () => Promise.resolve(res),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok),
  };
};

(supabase as unknown as Record<string, unknown>).channel = () => {
  const ch: Record<string, unknown> = {};
  ch.on = () => ch;
  ch.subscribe = (cb?: (status: string) => void) => {
    if (cb) queueMicrotask(() => cb("SUBSCRIBED"));
    return ch;
  };
  return ch;
};
(supabase as unknown as Record<string, unknown>).removeChannel = async () => "ok";

function resetState(overrides: Record<string, unknown> = {}) {
  writeLog = [];
  markerMode = "staging-row";
  currentLiveRow = liveRow;
  useLiveHostStore.getState().stopHostProgress();
  useLiveHostStore.setState({
    live: liveRow,
    liveSnapshotConfirmed: true,
    loading: false,
    error: null,
    participants: [],
    turns: [],
    ...overrides,
  } as never);
  // init()経由の自動進行(advanceIfDue)は、Zustand storeのstate.liveではなく
  // 常にこのmock応答(currentLiveRow)を再フェッチして使うため、overrides.liveを
  // 渡した場合はcurrentLiveRowにも同じ値を反映する（5)自動進行テストで使用）。
  const overrideLive = (overrides as { live?: LiveRow }).live;
  if (overrideLive) currentLiveRow = overrideLive;
}

async function main() {
  // ===== 1) openReception（受付開始） =====
  {
    // 1a) Project Ref不一致 → 全Supabase書き込み0回
    resetState();
    await withEnv(
      { ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" },
      async () => {
        const r = await useLiveHostStore.getState().openReception();
        assert.equal(r.ok, false, "Project Ref不一致でopenReceptionがok:trueになった");
        assert.equal(writeLog.length, 0, `Project Ref不一致で書き込みが発生した: ${writeLog.join(",")}`);
      },
    );
    console.log("PASS: openReception - Project Ref不一致で全Supabase書き込み0回");

    // 1b) marker不在 → 0回
    resetState();
    markerMode = "no-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().openReception();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker不在で書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: openReception - marker不在で全Supabase書き込み0回");

    // 1c) marker取得エラー → 0回
    resetState();
    markerMode = "error";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().openReception();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker取得エラーで書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: openReception - marker取得エラーで全Supabase書き込み0回");

    // 1d) Supabase接続エラー（例外） → 0回
    resetState();
    markerMode = "throw";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().openReception();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `接続エラーで書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: openReception - Supabase接続エラー（例外）で全Supabase書き込み0回");

    // 1e) 正しいステージング接続 → 既存処理が1回だけ実行される
    resetState();
    markerMode = "staging-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().openReception();
      assert.equal(r.ok, true, `正しい接続でopenReceptionが失敗した: ${r.reason}`);
      const rpcCalls = writeLog.filter((w) => w === "rpc:open_reception");
      assert.equal(rpcCalls.length, 1, `open_reception RPCが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: openReception - 正しいステージング接続では既存処理が1回だけ実行される");

    // 1f) development環境ではmarker問い合わせ0回・openReceptionが1回実行される
    resetState();
    markerMode = "no-row"; // markerが無くても、staging以外なら問い合わせ自体が発生しないはず
    {
      let markerQueried = false;
      const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
      (supabase as unknown as Record<string, unknown>).from = (table: string) => {
        if (table === "_environment_marker") markerQueried = true;
        return (originalFrom as (t: string) => Record<string, unknown>)(table);
      };
      await withEnv(
        { NEXT_PUBLIC_APP_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined },
        async () => {
          const r = await useLiveHostStore.getState().openReception();
          assert.equal(r.ok, true, `development環境でopenReceptionが妨げられた: ${r.reason}`);
        },
      );
      (supabase as unknown as Record<string, unknown>).from = originalFrom;
      assert.equal(markerQueried, false, "development環境なのに_environment_markerへ問い合わせた");
      const rpcCalls = writeLog.filter((w) => w === "rpc:open_reception");
      assert.equal(rpcCalls.length, 1, `development環境でopen_receptionが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    }
    console.log("PASS: openReception - development環境ではmarker問い合わせ0回でopenReceptionが1回実行される");

    // 1g) production環境ではmarker問い合わせ0回・openReceptionが1回実行される
    // （developmentだけでなくproductionも独立したシナリオとして検証する。
    // developmentとproductionはgetAppEnv()の判定分岐が異なるため、片方の確認だけでは
    // もう片方の分岐が壊れていないことの保証にならない）。
    resetState();
    markerMode = "no-row";
    {
      let markerQueried = false;
      const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
      (supabase as unknown as Record<string, unknown>).from = (table: string) => {
        if (table === "_environment_marker") markerQueried = true;
        return (originalFrom as (t: string) => Record<string, unknown>)(table);
      };
      await withEnv(
        { NEXT_PUBLIC_APP_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined },
        async () => {
          const r = await useLiveHostStore.getState().openReception();
          assert.equal(r.ok, true, `production環境でopenReceptionが妨げられた: ${r.reason}`);
        },
      );
      (supabase as unknown as Record<string, unknown>).from = originalFrom;
      assert.equal(markerQueried, false, "production環境なのに_environment_markerへ問い合わせた");
      const rpcCalls = writeLog.filter((w) => w === "rpc:open_reception");
      assert.equal(rpcCalls.length, 1, `production環境でopen_receptionが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    }
    console.log("PASS: openReception - production環境ではmarker問い合わせ0回でopenReceptionが1回実行される");
  }

  // ===== 2) setAccessRestricted（参加制限変更） =====
  {
    resetState();
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      const r = await useLiveHostStore.getState().setAccessRestricted(true);
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `Ref不一致で書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: setAccessRestricted - Project Ref不一致で全Supabase書き込み0回");

    resetState();
    markerMode = "no-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().setAccessRestricted(true);
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker不在で書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: setAccessRestricted - marker不在で全Supabase書き込み0回");

    resetState();
    markerMode = "staging-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().setAccessRestricted(true);
      assert.equal(r.ok, true, `正しい接続でsetAccessRestrictedが失敗した: ${r.reason}`);
      const updateCalls = writeLog.filter((w) => w === "update:lives");
      assert.equal(updateCalls.length, 1, `lives.updateが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: setAccessRestricted - 正しいステージング接続では既存処理が1回だけ実行される");
  }

  // ===== 3) closeLive（通常終了） =====
  {
    resetState({ live: { ...liveRow, current_phase: "final_result" } });
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      const r = await useLiveHostStore.getState().closeLive();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `Ref不一致で書き込みが発生した: ${writeLog.join(",")}`);
      // ガード失敗後にライブ状態を消して「成功扱い」にしていないことも確認する。
      assert.equal(useLiveHostStore.getState().live?.id, "live-1", "ガード失敗なのにlive状態が変化した");
    });
    console.log("PASS: closeLive - Project Ref不一致で全Supabase書き込み0回、状態も変化しない");

    resetState({ live: { ...liveRow, current_phase: "final_result" } });
    markerMode = "no-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().closeLive();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker不在で書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: closeLive - marker不在で全Supabase書き込み0回");

    resetState({ live: { ...liveRow, current_phase: "final_result" } });
    markerMode = "error";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().closeLive();
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker取得エラーで書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: closeLive - marker取得エラーで全Supabase書き込み0回");

    resetState({ live: { ...liveRow, current_phase: "final_result" } });
    markerMode = "staging-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().closeLive();
      assert.equal(r.ok, true, `正しい接続でcloseLiveが失敗した: ${r.reason}`);
      const rpcCalls = writeLog.filter((w) => w === "rpc:close_live");
      assert.equal(rpcCalls.length, 1, `close_live RPCが1回だけ呼ばれていない: ${writeLog.join(",")}`);
      // admin_action_logsへの記録（付随書き込み）も成功時にのみ1回発生する。
      const logCalls = writeLog.filter((w) => w === "insert:admin_action_logs");
      assert.equal(logCalls.length, 1, "成功時にadmin_action_logsが記録されていない");
    });
    console.log("PASS: closeLive - 正しいステージング接続では既存処理(RPC＋ログ記録)が1回だけ実行される");
  }

  // ===== 4) emergencyCloseLive（緊急中止） =====
  {
    resetState({ live: { ...liveRow, current_phase: "answering" } });
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      const r = await useLiveHostStore.getState().emergencyCloseLive("test");
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `Ref不一致で書き込みが発生した: ${writeLog.join(",")}`);
      assert.equal(useLiveHostStore.getState().live?.id, "live-1", "ガード失敗なのにlive状態が変化した");
    });
    console.log("PASS: emergencyCloseLive - Project Ref不一致で全Supabase書き込み0回、状態も変化しない");

    resetState({ live: { ...liveRow, current_phase: "answering" } });
    markerMode = "no-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().emergencyCloseLive("test");
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker不在で書き込みが発生した: ${writeLog.join(",")}`);
    });
    console.log("PASS: emergencyCloseLive - marker不在で全Supabase書き込み0回");

    resetState({ live: { ...liveRow, current_phase: "answering" } });
    markerMode = "staging-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await useLiveHostStore.getState().emergencyCloseLive("test");
      assert.equal(r.ok, true, `正しい接続でemergencyCloseLiveが失敗した: ${r.reason}`);
      const rpcCalls = writeLog.filter((w) => w === "rpc:emergency_close_live");
      assert.equal(rpcCalls.length, 1, `emergency_close_live RPCが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: emergencyCloseLive - 正しいステージング接続では既存処理が1回だけ実行される");
  }

  // ===== 5) 自動進行（advanceIfDue経由のtick）：init()＋writer ticket→500ms tick→host_advance_* =====
  {
    // 5a) Project Ref不一致：init()→tickを経ても自動進行のRPCが一切呼ばれない。
    resetState({ live: { ...liveRow, current_phase: "topic_reveal" } });
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      useLiveHostStore.getState().init();
      startHostAutoProgress(1, (t) => t === 1); // writerに選ばれた状態でもRef不一致なら書き込まない
      await delay(1_200); // hydrate完了＋1tick(500ms)以上
      const advanceCalls = writeLog.filter((w) => w === "rpc:host_advance_topic_reveal_to_answering");
      assert.equal(
        advanceCalls.length,
        0,
        `Ref不一致なのに自動進行RPCが呼ばれた: ${writeLog.join(",")}`,
      );
    });
    useLiveHostStore.getState().stopHostProgress();
    console.log("PASS: 自動進行(advanceIfDue) - Project Ref不一致ならtickを経ても書き込みRPCが呼ばれない");

    // 5b) 正しいステージング接続：init()→tickで自動進行RPCが呼ばれる（安全確認が自動進行を止めていない）。
    resetState({ live: { ...liveRow, current_phase: "topic_reveal" } });
    markerMode = "staging-row";
    await withEnv(STAGING_ENV, async () => {
      useLiveHostStore.getState().init();
      // 2026-10-15（2A.2b-W1）：自動進行はWeb Locksでwriterに選ばれたタブだけが動かす。
      // ここではwriterに選ばれた状態（有効なticket）を直接与える。
      startHostAutoProgress(1, (t) => t === 1);
      await delay(1_200);
      const advanceCalls = writeLog.filter((w) => w === "rpc:host_advance_topic_reveal_to_answering");
      assert.ok(
        advanceCalls.length >= 1,
        `正しい接続なのに自動進行RPCが呼ばれなかった（hydrate未完了の可能性）: ${writeLog.join(",")}`,
      );
    });
    useLiveHostStore.getState().stopHostProgress();
    console.log("PASS: 自動進行(advanceIfDue) - 正しいステージング接続ではtickの自動進行RPCが妨げられない");
  }

  console.log("ALL USE_LIVE_HOST_STORE_STAGING_GUARD CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
