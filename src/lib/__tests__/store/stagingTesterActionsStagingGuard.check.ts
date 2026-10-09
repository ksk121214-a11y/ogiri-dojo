// ステージング誤接続時の運営操作防止(assertStagingOperationAllowed)を、
// /live/host の StagingTestersPanel が使う grantStagingTester / revokeStagingTester
// （src/lib/stagingTesterActions.ts）へ実呼び出しで検証する。
// StagingTestersPanel自体はReact描画が必要でこのランナーからは直接呼び出せないため、
// 実際のRPC呼び出し・安全確認はこのモジュールへ分離してある（page.tsx側は
// busy/messageの更新のみを行う。src/lib/__tests__/liveHostStagingGuardInventory.check.ts
// の5-3でpage.tsxがこの分離を維持していることも別途確認している）。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig＋pathAliasHook経由）。
import assert from "node:assert/strict";

import { grantStagingTester, revokeStagingTester } from "@/lib/stagingTesterActions";
import { supabase } from "@/lib/supabase";

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
(supabase as unknown as Record<string, unknown>).rpc = (name: string) => {
  recordWrite(`rpc:${name}`);
  return Promise.resolve({ data: true, error: null });
};

function resetState() {
  writeLog = [];
  markerMode = "staging-row";
}

async function main() {
  // 1) Project Ref不一致 → 許可/失効のRPCが0回
  {
    resetState();
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      const r = await grantStagingTester("user-x");
      assert.equal(r.ok, false, "Ref不一致なのにgrantStagingTesterが成功した");
      assert.equal(writeLog.length, 0, `Ref不一致なのにRPCが呼ばれた: ${writeLog.join(",")}`);
    });
    console.log("PASS: grantStagingTester - Project Ref不一致でhost_grant_staging_testerが0回");

    resetState();
    await withEnv({ ...STAGING_ENV, NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref" }, async () => {
      const r = await revokeStagingTester("user-x");
      assert.equal(r.ok, false, "Ref不一致なのにrevokeStagingTesterが成功した");
      assert.equal(writeLog.length, 0, `Ref不一致なのにRPCが呼ばれた: ${writeLog.join(",")}`);
    });
    console.log("PASS: revokeStagingTester - Project Ref不一致でhost_revoke_staging_testerが0回");
  }

  // 2) marker不在 → 0回
  {
    resetState();
    markerMode = "no-row";
    await withEnv(STAGING_ENV, async () => {
      const r = await grantStagingTester("user-x");
      assert.equal(r.ok, false);
      assert.equal(writeLog.length, 0, `marker不在なのにRPCが呼ばれた: ${writeLog.join(",")}`);
    });
    console.log("PASS: grantStagingTester - marker不在でhost_grant_staging_testerが0回");
  }

  // 3) 正しいステージング接続 → 許可/失効が1回だけ実行される
  {
    resetState();
    await withEnv(STAGING_ENV, async () => {
      const r = await grantStagingTester("user-x");
      assert.equal(r.ok, true, `正しい接続でgrantStagingTesterが失敗した`);
      const calls = writeLog.filter((w) => w === "rpc:host_grant_staging_tester");
      assert.equal(calls.length, 1, `host_grant_staging_testerが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: grantStagingTester - 正しいステージング接続では既存処理が1回だけ実行される");

    resetState();
    await withEnv(STAGING_ENV, async () => {
      const r = await revokeStagingTester("user-x");
      assert.equal(r.ok, true, `正しい接続でrevokeStagingTesterが失敗した`);
      const calls = writeLog.filter((w) => w === "rpc:host_revoke_staging_tester");
      assert.equal(calls.length, 1, `host_revoke_staging_testerが1回だけ呼ばれていない: ${writeLog.join(",")}`);
    });
    console.log("PASS: revokeStagingTester - 正しいステージング接続では既存処理が1回だけ実行される");
  }

  // 4) production環境 → marker問い合わせ0回・既存処理は妨げられない
  {
    resetState();
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
        const r = await grantStagingTester("user-x");
        assert.equal(r.ok, true, "production環境でgrantStagingTesterが妨げられた");
      },
    );
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "production環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: grantStagingTester - production環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  // 5) development環境 → marker問い合わせ0回・既存処理は妨げられない
  {
    resetState();
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
        const r = await revokeStagingTester("user-x");
        assert.equal(r.ok, true, "development環境でrevokeStagingTesterが妨げられた");
      },
    );
    (supabase as unknown as Record<string, unknown>).from = originalFrom;
    assert.equal(markerQueried, false, "development環境なのに_environment_markerへ問い合わせた");
    console.log("PASS: revokeStagingTester - development環境ではmarker問い合わせ0回で既存処理が妨げられない");
  }

  console.log("ALL STAGING_TESTER_ACTIONS_STAGING_GUARD CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
