// ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)を、
// useLiveBotStore.ts の addBots（ボットのログイン・プロフィール更新・参加RPC）へ
// 実呼び出しで検証する。createBotClient（各ボット専用の独立したSupabaseクライアントを
// 生成するファクトリ）を丸ごと差し替え、ログイン・プロフィール更新・参加RPCの
// 呼び出し回数を記録する。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";

import * as liveBotClientsModule from "@/lib/liveBotClients";
import { supabase } from "@/lib/supabase";
import { useLiveBotStore } from "@/store/useLiveBotStore";

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
// assertStagingOperationAllowed()内部のfetchEnvironmentMarkerは、共有の
// supabaseシングルトン（@/lib/supabase）経由で_environment_markerを読む
// （各ボット専用クライアントではない）。
(supabase as unknown as Record<string, unknown>).from = (table: string) => {
  const b: Record<string, unknown> = {};
  const passthrough = ["select", "eq"];
  for (const m of passthrough) b[m] = () => b;
  b.maybeSingle = () => {
    if (table === "_environment_marker") return Promise.resolve(markerResponse());
    return Promise.resolve({ data: null, error: null });
  };
  return b;
};

// ボット専用クライアント（createBotClient()の戻り値）のモック。
// ログイン・プロフィール更新・参加RPCの全てをここで記録する。
function makeFakeBotClient(email: string) {
  const client: Record<string, unknown> = {};
  client.auth = {
    signInWithPassword: async () => {
      recordWrite(`auth:signInWithPassword:${email}`);
      return { data: { user: { id: `uid-${email}` } }, error: null };
    },
  };
  client.from = (table: string) => {
    const b: Record<string, unknown> = {};
    const passthrough = ["select", "eq"];
    for (const m of passthrough) b[m] = () => b;
    b.update = () => {
      recordWrite(`update:${table}:${email}`);
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: null, error: null }); // participants既存なし→join_liveへ
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
    return b;
  };
  client.rpc = (name: string) => {
    recordWrite(`rpc:${name}:${email}`);
    const res =
      name === "join_live"
        ? { data: { id: `participant-${email}`, user_id: `uid-${email}` }, error: null }
        : { data: null, error: null };
    return Promise.resolve(res);
  };
  return client;
}

function resetState() {
  writeLog = [];
  markerMode = "staging-row";
  useLiveBotStore.setState({ bots: [], loading: false, error: null });
}

async function main() {
  const credentials = [{ email: "bot1@example.com", password: "pw" }];

  // 1) Project Ref不一致 → ログイン・プロフィール更新・参加RPCが0回
  {
    resetState();
    (liveBotClientsModule as unknown as { createBotClient: () => unknown }).createBotClient = () =>
      makeFakeBotClient(credentials[0].email);
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      await useLiveBotStore.getState().addBots("live-bot-1", credentials);
      assert.equal(writeLog.length, 0, `Ref不一致なのにボットの書き込みが発生した: ${writeLog.join(",")}`);
      assert.equal(useLiveBotStore.getState().bots.length, 0, "Ref不一致なのにボットが追加された");
      assert.ok(useLiveBotStore.getState().error, "Ref不一致なのにerrorが設定されていない");
    });
    console.log("PASS: addBots - Project Ref不一致でログイン・プロフィール更新・参加RPCが0回");
  }

  // 2) marker不在 → 0回
  {
    resetState();
    markerMode = "no-row";
    (liveBotClientsModule as unknown as { createBotClient: () => unknown }).createBotClient = () =>
      makeFakeBotClient(credentials[0].email);
    await withEnv(STAGING_ENV, async () => {
      await useLiveBotStore.getState().addBots("live-bot-1", credentials);
      assert.equal(writeLog.length, 0, `marker不在なのにボットの書き込みが発生した: ${writeLog.join(",")}`);
      assert.equal(useLiveBotStore.getState().bots.length, 0, "marker不在なのにボットが追加された");
    });
    console.log("PASS: addBots - marker不在でログイン・プロフィール更新・参加RPCが0回");
  }

  // 3) 正しいステージング接続 → ログイン・プロフィール更新・参加RPCが1回ずつ実行される
  {
    resetState();
    (liveBotClientsModule as unknown as { createBotClient: () => unknown }).createBotClient = () =>
      makeFakeBotClient(credentials[0].email);
    await withEnv(STAGING_ENV, async () => {
      await useLiveBotStore.getState().addBots("live-bot-1", credentials);
      assert.equal(useLiveBotStore.getState().error, null, `正しい接続でaddBotsが失敗した: ${useLiveBotStore.getState().error}`);
      assert.equal(useLiveBotStore.getState().bots.length, 1, "正しい接続なのにボットが追加されなかった");
      const loginCalls = writeLog.filter((w) => w.startsWith("auth:signInWithPassword:"));
      const profileCalls = writeLog.filter((w) => w.startsWith("update:profiles:"));
      const joinCalls = writeLog.filter((w) => w.startsWith("rpc:join_live:"));
      assert.equal(loginCalls.length, 1, `ログインが1回だけ呼ばれていない: ${writeLog.join(",")}`);
      assert.equal(profileCalls.length, 1, `プロフィール更新が1回だけ呼ばれていない: ${writeLog.join(",")}`);
      assert.equal(joinCalls.length, 1, `参加RPCが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: addBots - 正しいステージング接続では既存処理(ログイン・プロフィール更新・参加RPC)が1回ずつ実行される");
  }

  // 4) production環境 → marker問い合わせ0回・既存処理は妨げられない
  {
    resetState();
    (liveBotClientsModule as unknown as { createBotClient: () => unknown }).createBotClient = () =>
      makeFakeBotClient(credentials[0].email);
    let markerQueried = false;
    const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
    (supabase as unknown as Record<string, unknown>).from = (table: string) => {
      if (table === "_environment_marker") markerQueried = true;
      return (originalFrom as (t: string) => Record<string, unknown>)(table);
    };
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined,
      },
      async () => {
        await useLiveBotStore.getState().addBots("live-bot-1", credentials);
        assert.equal(useLiveBotStore.getState().bots.length, 1, "production環境でaddBotsが妨げられた");
      },
    );
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "production環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: addBots - production環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  // 5) development環境 → marker問い合わせ0回・既存処理は妨げられない
  {
    resetState();
    (liveBotClientsModule as unknown as { createBotClient: () => unknown }).createBotClient = () =>
      makeFakeBotClient(credentials[0].email);
    let markerQueried = false;
    const originalFrom = (supabase as unknown as Record<string, unknown>).from as (t: string) => unknown;
    (supabase as unknown as Record<string, unknown>).from = (table: string) => {
      if (table === "_environment_marker") markerQueried = true;
      return (originalFrom as (t: string) => Record<string, unknown>)(table);
    };
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined,
      },
      async () => {
        await useLiveBotStore.getState().addBots("live-bot-1", credentials);
        assert.equal(useLiveBotStore.getState().bots.length, 1, "development環境でaddBotsが妨げられた");
      },
    );
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "development環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: addBots - development環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  console.log("ALL USE_LIVE_BOT_STORE_STAGING_GUARD CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
