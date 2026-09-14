// useSnsStore.ts のaddTopic/addAnswer/addComment/deleteTopic/deleteAnswer/
// deleteComment（2026-09-13、再々レビュー2回目対応）が、Supabase待機中
// （await中）にA→Bへ切り替わった場合、Aの遅延結果を現在のB（あるいはゲスト）の
// ローカルstateへ一切反映しない（新しい利用者の一覧へ"me"として混ざらない・
// 新しい利用者の一覧から削除されない）ことを、本番と同じ実装のまま呼び出して
// 検証するスクリプト。実行方法はsrc/lib/__tests__/run.sh参照。
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");

// ---- RPC呼び出しを名前ごとに手動で解決できるようにするゲート機構。----
type RpcResponse = { data: Record<string, unknown> | null; error: { message: string } | null };
const armedRpcNames = new Set<string>();
const pendingRpcResolvers = new Map<string, Resolver[]>();
type Resolver = (r: RpcResponse) => void;
const rpcCallCount = new Map<string, number>();

function armDeferredRpc(name: string) {
  armedRpcNames.add(name);
}
function resolveDeferredRpc(name: string, response: RpcResponse) {
  armedRpcNames.delete(name);
  const resolvers = pendingRpcResolvers.get(name) ?? [];
  pendingRpcResolvers.set(name, []);
  resolvers.forEach((r) => r(response));
}

(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<RpcResponse> }).rpc = async (name: string) => {
  rpcCallCount.set(name, (rpcCallCount.get(name) ?? 0) + 1);
  if (armedRpcNames.has(name)) {
    return await new Promise<RpcResponse>((resolve) => {
      const list = pendingRpcResolvers.get(name) ?? [];
      list.push(resolve);
      pendingRpcResolvers.set(name, list);
    });
  }
  return { data: null, error: { message: "not armed" } };
};

// profilesテーブル：useProfileStore.tsの自動loadForUserが呼ぶ。中身は
// このテストの検証対象ではないため、要求されたuserIdに対応する最小限の行を返す。
(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  if (table === "profiles") {
    let targetUserId: string | null = null;
    const chain = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        targetUserId = val;
        return chain;
      },
      single: async () => ({
        data: {
          id: targetUserId,
          display_name: `名前-${targetUserId}`,
          display_name_set: true,
          x_username: null,
          avatar_url: null,
          role: "user",
          avatar_icon: "default",
          avatar_color: "#c8320c",
          bio: "",
          mastery_meter: 0,
          total_points: 0,
          points_balance: 0,
          live_count: 0,
          award_count_first: 0,
          award_count_second: 0,
          award_count_third: 0,
          best_answer_count: 0,
          tickets_count: 5,
          tickets_next_recovery_at: null,
          is_guest: false,
        },
        error: null,
      }),
    };
    return chain;
  }
  // それ以外（useSnsStore自体の自動init()が読むsns_topics等）は空データで解決する。
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [], error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  };
  return chain;
};

(supabase.auth as unknown as { getSession: () => Promise<{ data: { session: null } }> }).getSession = async () => ({
  data: { session: null },
});
(
  supabase.auth as unknown as {
    onAuthStateChange: () => { data: { subscription: { unsubscribe: () => void } } };
  }
).onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } });

const memoryLocalStorage = new Map<string, string>();
(global as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memoryLocalStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryLocalStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryLocalStorage.delete(key);
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require("@/store/useAuthStore") as typeof import("@/store/useAuthStore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useSnsStore } = require("@/store/useSnsStore") as typeof import("@/store/useSnsStore");

function setAuthUser(id: string | null, isAnonymous = false) {
  useAuthStore.setState({
    user: id ? ({ id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
    loading: false,
  });
}

async function waitMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

async function main() {
  await waitMicrotasks();
  setAuthUser("userA");
  await waitMicrotasks();
  await waitMicrotasks();

  // ---- テスト1: addTopic実行中にA→Bへ切り替わった場合、Aの遅延結果が
  //      Bのtopics一覧へ"me"として混ざらない。----
  armDeferredRpc("submit_sns_topic");
  const addPromise = useSnsStore.getState().addTopic("Aが投稿しようとするお題");
  await waitMicrotasks(); // RPC呼び出しが保留に入るところまで進める

  setAuthUser("userB"); // 保留中に別ユーザーへ切り替える（generationが進む）
  await waitMicrotasks();
  await waitMicrotasks();

  resolveDeferredRpc("submit_sns_topic", {
    data: { id: "race-topic-1", body: "Aが投稿しようとするお題" },
    error: null,
  });
  const addResult = await addPromise;
  assert.equal(addResult.ok, false, "await中にA→Bへ切り替わったのに、Aの投稿が成功扱いになってしまった");
  assert.equal(
    useSnsStore.getState().topics.some((t) => t.id === "race-topic-1"),
    false,
    "await中に切り替わったAの投稿がBのtopics一覧へ紛れ込んでしまった",
  );
  console.log("PASS: addTopic実行中にA→Bへ切り替わった場合、Aの遅延結果はBのtopics一覧へ反映されない");

  // ---- テスト2: deleteTopic実行中にA→Bへ切り替わった場合、Aの遅延結果が
  //      Bのtopics一覧から削除しない（Bも同じ投稿を見ている状態を模す）。----
  useSnsStore.setState((s) => ({
    topics: [
      { id: "shared-topic-1", body: "みんなに見えているお題", authorId: "someone-else", createdAtLabel: "たった今" },
      ...s.topics,
    ],
  }));

  setAuthUser("userA");
  await waitMicrotasks();
  await waitMicrotasks();

  armDeferredRpc("delete_own_sns_topic");
  const deletePromise = useSnsStore.getState().deleteTopic("shared-topic-1");
  await waitMicrotasks();

  setAuthUser("userB"); // 保留中にBへ切り替わる
  await waitMicrotasks();
  await waitMicrotasks();

  // Bの画面にも同じお題が表示されている状態を再現する（切替リセットで一旦
  // 消えるため、Bとして改めて読み込んだ体で追加する）。
  useSnsStore.setState((s) => ({
    topics: [
      { id: "shared-topic-1", body: "みんなに見えているお題", authorId: "someone-else", createdAtLabel: "たった今" },
      ...s.topics,
    ],
  }));

  resolveDeferredRpc("delete_own_sns_topic", { data: null, error: null });
  const deleteResult = await deletePromise;
  assert.equal(deleteResult.ok, false, "await中にA→Bへ切り替わったのに、Aの削除が成功扱いになってしまった");
  assert.equal(
    useSnsStore.getState().topics.some((t) => t.id === "shared-topic-1"),
    true,
    "await中に切り替わったAの削除結果が、Bの画面から共有中のお題を消してしまった",
  );
  console.log("PASS: deleteTopic実行中にA→Bへ切り替わった場合、Aの遅延結果はBのtopics一覧から削除しない");

  console.log("ALL USE_SNS_STORE_MUTATION_RACE CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
