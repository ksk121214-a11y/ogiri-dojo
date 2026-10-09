// ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)を、
// useLiveFollowerStore.ts の観客側補助tick（tickIfNeeded → advance_live_progress_if_due）に
// 対して実呼び出しで検証する。tickIfNeeded自体はexportされていないため、実際の
// subscribe()（本番でLivePageが呼ぶ公開アクション）を呼び、内部のsetInterval
// （TICK_INTERVAL_MS=5000）が実際に発火するのを待って検証する。
// joinLive・回答・採点等の通常のユーザー操作はこのテストの対象に含めない
// （tickIfNeeded以外の経路からはadvance_live_progress_if_dueは呼ばれないため、
// このRPC呼び出し回数だけを見れば十分）。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";

import type { LiveRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// subscribe()内部はブラウザのdocument/windowへイベントリスナーを張る
// （visibilitychange/online）。jsdom等を使わないこのテストランナーのNode環境には
// 本来存在しないため、このテストファイルの中だけで最小限のポリフィルを与える
// （本番コードには一切影響しない。document/windowが既に存在する環境では何もしない）。
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  };
}
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

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

let writeLog: string[] = [];
function recordWrite(entry: string) {
  writeLog.push(entry);
}

type MarkerMode = "staging-row" | "no-row" | "error";
let markerMode: MarkerMode = "staging-row";

const liveRow = {
  id: "live-f1",
  current_phase: "interlude",
  current_turn_id: null,
  phase_deadline: null,
  answering_paused: false,
  timing_profile: "standard",
  live_mode: "test",
  access_restricted: false,
  created_at: "2026-01-01T00:00:00Z",
} as unknown as LiveRow;

let currentLiveRow: LiveRow = liveRow;
const tableReadResponse: Record<string, { data: unknown; error: unknown }> = {
  get lives() {
    return { data: currentLiveRow, error: null };
  },
};

function markerResponse(): { data: unknown; error: unknown } {
  switch (markerMode) {
    case "staging-row":
      return { data: { environment: "staging" }, error: null };
    case "no-row":
      return { data: null, error: null };
    case "error":
      return { data: null, error: { message: "connection error" } };
  }
}

function makeChain(table: string) {
  const b: Record<string, unknown> = {};
  const passthrough = ["select", "eq", "neq", "order", "limit", "in", "match", "is"];
  for (const m of passthrough) b[m] = () => b;
  b.maybeSingle = () => {
    if (table === "_environment_marker") return Promise.resolve(markerResponse());
    return Promise.resolve(tableReadResponse[table] ?? { data: null, error: null });
  };
  b.single = () => Promise.resolve(tableReadResponse[table] ?? { data: null, error: null });
  // 観客側の補助tickの経路では本来insert/update/upsert/deleteは発生しないが、
  // 想定外の書き込みが混入したら検出できるように記録だけはしておく。
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
  advance_live_progress_if_due: { data: { updated: true, live: liveRow }, error: null },
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

function resetState() {
  writeLog = [];
  markerMode = "staging-row";
  currentLiveRow = liveRow;
  useAuthStore.setState({ user: { id: "user-f1" } as never, loading: false });
  useLiveFollowerStore.setState({
    live: null,
    myParticipant: null,
    participants: [],
    groups: [],
    participantNames: {},
    participantAvatars: {},
    currentTurn: null,
    currentTopic: null,
    loading: true,
    syncError: null,
    error: null,
  } as never);
}

// 1tick(5000ms)が確実に発火するまでの待ち時間。
const TICK_WAIT_MS = 5_600;

async function main() {
  // 1) Project Ref不一致 → tickを経てもadvance_live_progress_if_dueが0回
  {
    resetState();
    const session: { stop: (() => void) | null } = { stop: null };
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      session.stop = useLiveFollowerStore.getState().subscribe();
      await delay(TICK_WAIT_MS);
      const calls = writeLog.filter((w) => w === "rpc:advance_live_progress_if_due");
      assert.equal(calls.length, 0, `Ref不一致なのに補助tickのRPCが呼ばれた: ${writeLog.join(",")}`);
    });
    session.stop?.();
    console.log("PASS: 観客側補助tick(tickIfNeeded) - Project Ref不一致でadvance_live_progress_if_dueが0回");
  }

  // 2) marker不在 → 0回（DB側確認の失敗も同様に0回になることを確認）
  {
    resetState();
    markerMode = "no-row";
    const session: { stop: (() => void) | null } = { stop: null };
    await withEnv(STAGING_ENV, async () => {
      session.stop = useLiveFollowerStore.getState().subscribe();
      await delay(TICK_WAIT_MS);
      const calls = writeLog.filter((w) => w === "rpc:advance_live_progress_if_due");
      assert.equal(calls.length, 0, `marker不在なのに補助tickのRPCが呼ばれた: ${writeLog.join(",")}`);
    });
    session.stop?.();
    console.log("PASS: 観客側補助tick(tickIfNeeded) - marker不在でadvance_live_progress_if_dueが0回");
  }

  // 3) 正しいステージング接続 → 既存処理(advance_live_progress_if_due)が重複せず1回だけ実行される
  {
    resetState();
    const session: { stop: (() => void) | null } = { stop: null };
    await withEnv(STAGING_ENV, async () => {
      session.stop = useLiveFollowerStore.getState().subscribe();
      await delay(TICK_WAIT_MS);
      const calls = writeLog.filter((w) => w === "rpc:advance_live_progress_if_due");
      assert.equal(
        calls.length,
        1,
        `正しい接続なのにadvance_live_progress_if_dueが1回だけ呼ばれていない: ${writeLog.join(",")}`,
      );
    });
    session.stop?.();
    console.log("PASS: 観客側補助tick(tickIfNeeded) - 正しいステージング接続では既存処理が重複せず1回だけ実行される");
  }

  // 4) production環境 → marker問い合わせ0回・既存処理（RPC）は妨げられない
  {
    resetState();
    let markerQueried = false;
    const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
    (supabase as unknown as Record<string, unknown>).from = (table: string) => {
      if (table === "_environment_marker") markerQueried = true;
      return (originalFrom as (t: string) => Record<string, unknown>)(table);
    };
    const session: { stop: (() => void) | null } = { stop: null };
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined,
      },
      async () => {
        session.stop = useLiveFollowerStore.getState().subscribe();
        await delay(TICK_WAIT_MS);
        const calls = writeLog.filter((w) => w === "rpc:advance_live_progress_if_due");
        assert.equal(calls.length, 1, `production環境で既存処理が妨げられた: ${writeLog.join(",")}`);
      },
    );
    session.stop?.();
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "production環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: 観客側補助tick(tickIfNeeded) - production環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  // 5) development環境 → marker問い合わせ0回・既存処理（RPC）は妨げられない
  {
    resetState();
    let markerQueried = false;
    const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
    (supabase as unknown as Record<string, unknown>).from = (table: string) => {
      if (table === "_environment_marker") markerQueried = true;
      return (originalFrom as (t: string) => Record<string, unknown>)(table);
    };
    const session: { stop: (() => void) | null } = { stop: null };
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined,
      },
      async () => {
        session.stop = useLiveFollowerStore.getState().subscribe();
        await delay(TICK_WAIT_MS);
        const calls = writeLog.filter((w) => w === "rpc:advance_live_progress_if_due");
        assert.equal(calls.length, 1, `development環境で既存処理が妨げられた: ${writeLog.join(",")}`);
      },
    );
    session.stop?.();
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "development環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: 観客側補助tick(tickIfNeeded) - development環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  console.log("ALL USE_LIVE_FOLLOWER_STORE_STAGING_GUARD CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
