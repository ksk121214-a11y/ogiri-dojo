// 2026-09-22（レビュー対応・項目4）：useLiveHostStore.createLivePreparationが
// create_live_preparation RPC呼び出し自体の失敗時（result.reasonではなく
// error.messageの方）に、生のPostgreSQL/Supabaseエラー文言を画面へ返さないことを
// 「本番と同じ実装のまま」検証するスクリプト。実行方法はsrc/lib/__tests__/run.sh参照
// （useLiveHostStore.tsが"@/..."エイリアス・実際のSupabaseクライアント生成を含む
// ため、他のcheck.tsと同じ素のtsc起動では解決できず、専用tsconfig経由で
// コンパイル・実行する）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useLiveHostStore, type LivePreparationInput } from "@/store/useLiveHostStore";

// ---- supabase.from(...)の最小限のモック ----
// createLivePreparationは本体のRPC呼び出しの前に、
// (a) fetchActiveLive: lives.select("*").neq(...).order(...).limit(1).maybeSingle()
// (b) 手動お題選択: topic_bank.select(...).in("id", ids)
// を呼ぶ。今回検証したいのはRPC呼び出し自体が失敗した場合の文言だけなので、
// どちらも「問題なく通過する」応答を返すだけの最小限のチェーン可能モックにする。
function makeChain(resolveValue: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "neq", "order", "limit", "in"];
  for (const m of methods) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = async () => resolveValue;
  chain.single = async () => resolveValue;
  // .in(...)で終わる場合、chainそのものがPromiseとしてawaitされる
  // （PostgrestFilterBuilderがthenableであるのと同じ振る舞い）。
  (chain as unknown as { then: (resolve: (v: unknown) => void) => void }).then = (resolve) =>
    resolve(resolveValue);
  return chain;
}

(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  if (table === "lives") {
    // fetchActiveLive: 進行中のライブは無い、というのが「通過させる」応答。
    return makeChain({ data: null, error: null });
  }
  if (table === "topic_bank") {
    // 手動お題選択：必要数ぶんのダミーお題を返す。
    return makeChain({
      data: [{ id: "topic-1", body: "テストお題", format: "text" }],
      error: null,
    });
  }
  throw new Error(`想定外のテーブルへのアクセス: ${table}`);
};

type RpcResponse = { data: unknown; error: { message: string } | null };
let nextRpcResponse: RpcResponse = { data: null, error: null };
(supabase as unknown as { rpc: (name: string, args: unknown) => { single: () => Promise<RpcResponse> } }).rpc = () => ({
  single: async () => nextRpcResponse,
});

function makeInput(): LivePreparationInput {
  return {
    title: "テストライブ",
    scheduledAt: new Date().toISOString(),
    maxPlayers: 20,
    groupCount: 1,
    topicSelection: { mode: "manual", topicBankIds: ["topic-1"] },
    liveMode: "official",
    manualOfficialSequenceNumber: null,
  };
}

async function main() {
  // ---- テスト1: RPC呼び出し自体が権限エラー("not authorized")で失敗した場合、
  //      「この操作を行う権限がありません」という安全な日本語になる。 ----
  nextRpcResponse = { data: null, error: { message: "not authorized" } };
  const r1 = await useLiveHostStore.getState().createLivePreparation(makeInput());
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "この操作を行う権限がありません");
  console.log("PASS: RPC呼び出し自体の権限エラー(not authorized)は安全な日本語に変換される");

  // ---- テスト2: RPC呼び出し自体が想定外のPostgreSQL内部エラー（制約名・型名等を
  //      含む）で失敗した場合、その内容が画面へ一切漏れず、安全な汎用文言になる。 ----
  const rawPgError =
    'duplicate key value violates unique constraint "lives_official_sequence_number_key"';
  nextRpcResponse = { data: null, error: { message: rawPgError } };
  const r2 = await useLiveHostStore.getState().createLivePreparation(makeInput());
  assert.equal(r2.ok, false);
  assert.ok(r2.reason, "reasonが空になっている");
  assert.ok(!r2.reason!.includes("constraint"), "生のPostgreSQL制約名が画面文言に漏れている");
  assert.ok(!r2.reason!.includes("lives_official_sequence_number_key"), "生の制約名がそのまま漏れている");
  assert.ok(!r2.reason!.toLowerCase().includes("duplicate key"), "生のPostgreSQLエラー文言が漏れている");
  assert.equal(r2.reason, "ライブの準備に失敗しました。入力内容を確認し、時間をおいて再度お試しください。");
  console.log("PASS: RPC呼び出し自体の想定外エラーは生のPostgreSQL文言を含まない安全な汎用文言になる");

  // ---- テスト3（回帰）：result.reason（SQL関数側が組み立てた日本語文言、例えば
  //      手動開催番号の重複・不正値）は、これまでどおりそのまま画面へ通す
  //      （こちらはerror.messageの経路ではなく、正常応答内のreasonなので
  //      生のDBエラーではない）。 ----
  nextRpcResponse = {
    data: { ok: false, reason: "開催番号#0002は既に使用されています", live_id: null },
    error: null,
  };
  const r3 = await useLiveHostStore.getState().createLivePreparation(makeInput());
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "開催番号#0002は既に使用されています");
  console.log("PASS: SQL関数側が返す日本語のresult.reason（重複番号等）はそのまま画面へ通る（回帰確認）");

  console.log("ALL USE_LIVE_HOST_STORE_CREATE_LIVE_PREPARATION CHECKS PASSED");
}

main();
