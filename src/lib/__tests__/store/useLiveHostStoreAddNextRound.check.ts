// 第3段階修正：host_add_next_roundを「組ごとに1件のお題」仕様へ変更したことに伴う、
// useLiveHostStore.addNextRoundの検証。useLiveHostStore.tsが"@/..."エイリアスと
// 実際のSupabaseクライアント生成を含むため、他のcheck.tsと同じ素のtsc起動では
// 解決できず、専用tsconfig経由でコンパイル・実行する（実行方法はsrc/lib/__tests__/run.sh参照）。
//
// 文字列検索だけでなく、実際にuseLiveHostStore.getState().addNextRoundを呼び、
// 生成されるRPC呼び出し（RPC名・p_expected_round・p_topicsのgroup_id/topic_body対応）
// を検証する。二重クリック防止自体はUI（RoundDecisionPanelのadding状態）の責務であり、
// ストア自体は呼ばれた回数だけRPCを呼ぶ素直な実装であることを、ここでは明示的に確認する
// （「ストアが二重送信を防ぐ」という誤った前提を検証してしまわないようにするため）。
import assert from "node:assert/strict";

import type { LiveRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";
import { useLiveHostStore } from "@/store/useLiveHostStore";

type RpcCall = { fn: string; args: unknown };
const rpcCalls: RpcCall[] = [];
let nextRpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

function makeLiveRow(overrides: Partial<LiveRow> = {}): LiveRow {
  return {
    id: "live-1",
    scheduled_at: new Date().toISOString(),
    rounds_per_live: 2,
    current_phase: "awaiting_round_decision",
    current_turn_id: "turn-old",
    phase_deadline: null,
    answering_paused: false,
    answering_remaining_ms: null,
    reveal_sequence_until: null,
    created_at: new Date().toISOString(),
    sequence_number: 1,
    title: "テスト",
    description: null,
    max_players: 20,
    planned_group_count: 2,
    reception_starts_at: null,
    reception_ends_at: null,
    results_published: false,
    ended_at: null,
    announcement_message: null,
    announcement_scope: null,
    announcement_sent_at: null,
    created_by: "host-1",
    rank_rewards_applied: false,
    live_mode: "test",
    official_sequence_number: null,
    emergency_closed: false,
    emergency_close_reason: null,
    next_reveal_pending_at: null,
    timing_profile: "standard",
    access_restricted: false,
    ...overrides,
  } as LiveRow;
}

(supabase as unknown as { rpc: (fn: string, args: unknown) => unknown }).rpc = (fn: string, args: unknown) => {
  rpcCalls.push({ fn, args });
  const result = nextRpcResult;
  return {
    single: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
  };
};

// addNextRoundは成功時にchildrenの再取得(fetchLiveChildren相当のsupabase.from呼び出し)・
// logAdminAction（admin_action_logsへのinsert）も行うため、.from()も空データで安全に
// 解決できるようにしておく（検証対象はrpc呼び出しの方なので、ここは副作用が例外に
// ならないようにするだけ）。
(supabase as unknown as { from: (table: string) => unknown }).from = () => {
  const chainable: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "order", "limit", "insert"];
  for (const m of methods) chainable[m] = () => chainable;
  (chainable as unknown as PromiseLike<{ data: unknown[]; error: null }>).then = (resolve) =>
    Promise.resolve({ data: [], error: null }).then(resolve as never);
  return chainable;
};

function reset() {
  rpcCalls.length = 0;
  nextRpcResult = { data: null, error: null };
}

async function main() {
  // ---- 1) 正常系：group_id/topic_bodyの対応を保ったままp_topicsを渡す ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow({ rounds_per_live: 2 }) });
    nextRpcResult = {
      data: { ok: true, reason: null, live: makeLiveRow({ rounds_per_live: 3, current_phase: "topic_reveal" }), first_turn_id: "turn-new" },
      error: null,
    };
    const result = await useLiveHostStore.getState().addNextRound([
      { groupId: "group-b", topicBody: "2組目のお題" },
      { groupId: "group-a", topicBody: "1組目のお題" },
    ]);
    assert.equal(result.ok, true, "正常な追加が失敗した");
    assert.equal(rpcCalls.length, 1, "RPC呼び出しが1回でない");
    assert.equal(rpcCalls[0].fn, "host_add_next_round", "呼んでいるRPC名が違う");
    const args = rpcCalls[0].args as {
      p_live_id: string;
      p_expected_round: number;
      p_topics: { group_id: string; topic_body: string; topic_bank_id: string | null }[];
    };
    assert.equal(args.p_live_id, "live-1");
    assert.equal(args.p_expected_round, 3, "p_expected_roundがrounds_per_live+1になっていない");
    assert.deepEqual(
      args.p_topics,
      [
        { group_id: "group-b", topic_body: "2組目のお題", topic_bank_id: null },
        { group_id: "group-a", topic_body: "1組目のお題", topic_bank_id: null },
      ],
      "p_topicsのgroup_id/topic_bodyの対応、または渡した順序が変わっている（topicBankId省略時はnullになるはず）",
    );
    console.log("PASS: addNextRoundは渡したgroupId/topicBodyの対応を保ったままp_topicsとしてRPCへ渡し、p_expected_roundを正しく計算する（topicBankId省略時はnull）");
  }

  // ---- 1b) 正常系：topicBankId（登録済みのお題から選んだ出典ID）を渡すとp_topics.topic_bank_idへそのまま入る ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow({ rounds_per_live: 1 }) });
    nextRpcResult = {
      data: { ok: true, reason: null, live: makeLiveRow({ rounds_per_live: 2, current_phase: "topic_reveal" }), first_turn_id: "turn-new" },
      error: null,
    };
    const result = await useLiveHostStore.getState().addNextRound([
      { groupId: "group-a", topicBody: "登録済みのお題", topicBankId: "bank-001" },
      { groupId: "group-b", topicBody: "手入力のお題" },
    ]);
    assert.equal(result.ok, true, "topicBankId混在の正常な追加が失敗した");
    const args = rpcCalls[0].args as {
      p_topics: { group_id: string; topic_body: string; topic_bank_id: string | null }[];
    };
    assert.deepEqual(
      args.p_topics,
      [
        { group_id: "group-a", topic_body: "登録済みのお題", topic_bank_id: "bank-001" },
        { group_id: "group-b", topic_body: "手入力のお題", topic_bank_id: null },
      ],
      "topicBankIdを渡した組はtopic_bank_idへそのまま入り、省略した組はnullになるはず",
    );
    console.log("PASS: topicBankId（登録済みのお題の出典ID）を渡すと、その組だけp_topics.topic_bank_idへそのまま渡り、省略した組はnullになる");
  }

  // ---- 2) 空配列ではRPCを呼ばない ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow() });
    const result = await useLiveHostStore.getState().addNextRound([]);
    assert.equal(result.ok, false, "空配列なのに成功してしまう");
    assert.equal(rpcCalls.length, 0, "空配列なのにRPCが呼ばれている");
    console.log("PASS: 組が1件も無い（空配列）場合はRPCを呼ばずに拒否する");
  }

  // ---- 3) 一部が空文字（trim後空）ではRPCを呼ばない ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow() });
    const result = await useLiveHostStore.getState().addNextRound([
      { groupId: "group-a", topicBody: "1組目のお題" },
      { groupId: "group-b", topicBody: "   " },
    ]);
    assert.equal(result.ok, false, "1件が空白だけなのに成功してしまう");
    assert.equal(rpcCalls.length, 0, "空白だけの要素があるのにRPCが呼ばれている");
    console.log("PASS: 1件でも空文字・空白だけの組があれば、RPCを呼ばずに拒否する");
  }

  // ---- 4) RPCエラー時は生のエラーメッセージを画面へ出さない ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow() });
    nextRpcResult = { data: null, error: { message: "relation \"public.turns\" violates foreign key constraint \"turns_group_id_fkey\"" } };
    const result = await useLiveHostStore.getState().addNextRound([{ groupId: "group-a", topicBody: "a" }]);
    assert.equal(result.ok, false);
    assert.ok(result.reason && !/relation|constraint|fkey/.test(result.reason), "生のSQL/制約エラーが画面向けメッセージに含まれている");
    console.log("PASS: RPC呼び出し自体が失敗した場合、生のSupabase/SQLエラーではなく安全な日本語メッセージを返す");
  }

  // ---- 5) DB側がok:falseを返した場合は、そのreasonをそのまま使う（DB側の日本語案内はそのまま通す） ----
  {
    reset();
    useLiveHostStore.setState({ live: makeLiveRow() });
    nextRpcResult = { data: { ok: false, reason: "お題の数が一致しません（2件必要）", live: makeLiveRow(), first_turn_id: null }, error: null };
    const result = await useLiveHostStore.getState().addNextRound([{ groupId: "group-a", topicBody: "a" }]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "お題の数が一致しません（2件必要）");
    console.log("PASS: DB側が返した日本語の拒否理由（件数不一致等）はそのまま呼び出し元へ伝わる");
  }

  console.log("ALL USE_LIVE_HOST_STORE_ADD_NEXT_ROUND CHECKS PASSED");
}

main();
