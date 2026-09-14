// useSnsStore.ts の「ログイン中ユーザーの切り替え」時の挙動（2026-09-13、
// 再々レビュー対応）を「本番と同じ実装のまま」呼び出して検証するスクリプト。
// 実行方法はsrc/lib/__tests__/run.sh参照（useProfileStoreSwitch.check.ts等と同様、
// 専用tsconfig＋requireフック経由）。
//
// 検証すること：
//   - ゲスト→Xログインへ切り替えると、Xユーザー本人の投稿がauthorId:"me"になり、
//     以前いいねした項目が正しく「いいね済み」として取得できる。
//   - 会員A→会員Bへ切り替えると、Aのauthorとして解決されていた投稿の
//     authorId:"me"タグ・いいね済み状態・フォロー状態が残らず、Bの内容に作り直される。
//   - 会員A→ログアウトへ切り替えると、いいね済み・フォロー状態が空に戻る。
//   - 取得中（await中）に別ユーザーへ切り替わった場合、遅れて届いた古い世代の
//     結果が新しい世代のstateに混ざらない（同じtopic行が二重に追加されない）。
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");

type ProfileRow = {
  id: string;
  display_name: string;
  display_name_set: boolean;
  x_username: string | null;
  avatar_url: string | null;
  role: string;
  avatar_icon: string;
  avatar_color: string;
  bio: string | null;
  mastery_meter: number;
  total_points: number;
  points_balance: number;
  live_count: number;
  award_count_first: number;
  award_count_second: number;
  award_count_third: number;
  best_answer_count: number;
  tickets_count: number;
  tickets_next_recovery_at: string | null;
  is_guest: boolean;
};

function makeProfileRow(id: string, isGuest: boolean): ProfileRow {
  return {
    id,
    display_name: isGuest ? "ゲスト" : `名前-${id}`,
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
    tickets_count: isGuest ? 0 : 5,
    tickets_next_recovery_at: null,
    is_guest: isGuest,
  };
}

// topic/answerの行データ。作者idはテスト用の固定ユーザー("userA"/"userB")のまま
// 変わらない。誰がログイン中かによってauthorId:"me"変換の結果だけが変わる、という
// ことを確認したいための設計（DB側のデータ自体は切り替えの前後で不変）。
const TOPIC_ROWS = [
  { id: "sw-t1", body: "userAのお題", author_id: "userA", created_at: "2024-01-01T00:00:00Z" },
];
const ANSWER_ROWS = [
  { id: "sw-a1", topic_id: "sw-t1", author_id: "userA", body: "userAの回答", likes: 3, created_at: "2024-01-01T01:00:00Z" },
];
// userAは以前"sw-a1"にいいね済み、userBはいいね無し・誰もフォローしていない、という
// DB上の既存状態を模す（「Xログイン後、以前いいねした項目を正しく取得できる」ことの検証）。
const LIKES_BY_USER: Record<string, string[]> = { userA: ["sw-a1"], userB: [] };
const FOLLOWS_BY_USER: Record<string, string[]> = { userA: [], userB: [] };
const FOLLOWER_COUNT_BY_USER: Record<string, number> = { userA: 0, userB: 0 };

// topics取得（sns_topics）の呼び出し1回だけを意図的に保留にする仕組み。
// 「古い利用者向けの取得がまだ完了していない間に、別ユーザーへ切り替わった」状況を
// 再現するために使う（useProfileStoreSwitch.check.tsのarmDeferredFetchと同じ考え方）。
let holdNextTopicsQuery = false;
let heldResolvers: Array<() => void> = [];
function armHoldNextTopicsQuery() {
  holdNextTopicsQuery = true;
}
function releaseHeldTopicsQueries() {
  const resolvers = heldResolvers;
  heldResolvers = [];
  resolvers.forEach((r) => r());
}

function makeChain(resolveWith: () => Promise<{ data: unknown; error: null }>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => resolveWith(),
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolveWith().then(resolve),
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: { message: "not used in this test" } }),
  };
  return chain;
}

(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  if (table === "profiles") {
    let targetUserId: string | null = null;
    let mode: "select" | "update" = "select";
    const chain = {
      select: () => chain,
      update: () => {
        mode = "update";
        return chain;
      },
      eq: (_col: string, val: string) => {
        targetUserId = val;
        return chain;
      },
      single: async () => {
        void mode;
        const userId = targetUserId as string;
        const isGuest = userId.startsWith("guest");
        return { data: makeProfileRow(userId, isGuest), error: null };
      },
    };
    return chain;
  }

  if (table === "sns_topics") {
    return makeChain(async () => {
      if (holdNextTopicsQuery) {
        holdNextTopicsQuery = false;
        await new Promise<void>((r) => heldResolvers.push(r));
      }
      return { data: TOPIC_ROWS, error: null };
    });
  }

  if (table === "sns_answers") {
    return makeChain(async () => ({ data: ANSWER_ROWS, error: null }));
  }

  if (table === "sns_comments") {
    return makeChain(async () => ({ data: [], error: null }));
  }

  if (table === "sns_answer_likes") {
    let targetUserId: string | null = null;
    const chain = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        targetUserId = val;
        return chain;
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        const liked = LIKES_BY_USER[targetUserId ?? ""] ?? [];
        resolve({ data: liked.map((answerId) => ({ answer_id: answerId })), error: null });
      },
    };
    return chain;
  }

  if (table === "sns_follows") {
    let targetUserId: string | null = null;
    let wantsCount = false;
    const chain = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantsCount = true;
        return chain;
      },
      eq: (_col: string, val: string) => {
        targetUserId = val;
        return chain;
      },
      then: (resolve: (v: { data: unknown; error: null; count?: number }) => void) => {
        if (wantsCount) {
          resolve({ data: null, error: null, count: FOLLOWER_COUNT_BY_USER[targetUserId ?? ""] ?? 0 });
          return;
        }
        const following = FOLLOWS_BY_USER[targetUserId ?? ""] ?? [];
        resolve({ data: following.map((id) => ({ following_id: id })), error: null });
      },
    };
    return chain;
  }

  throw new Error(`想定外のテーブルがfromされた: ${table}`);
};

// resolveRealAuthorNames（他ユーザーの表示名解決）が実際のネットワーク呼び出しを
// 行わないようにする（このテストでは表示名の中身自体は検証対象外）。
(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: null }> }).rpc =
  async () => ({ data: [], error: null });

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
  // useAuthStore.tsのモジュール読み込み時セッション復元（getSession().then(...)、
  // モックはuser:null相当を返す）の完了を待ってから、以降のsetAuthUser呼び出しを行う
  // （useProfileStoreSwitch.check.tsと同じ、モック環境固有の初期化順序の対応）。
  await waitMicrotasks();

  // ---- テスト1: ゲスト→Xログイン（userA）への切り替え。 ----
  setAuthUser("guest-1", true);
  await waitMicrotasks();
  await waitMicrotasks();

  setAuthUser("userA");
  await waitMicrotasks();
  await waitMicrotasks();

  const topicAfterA = useSnsStore.getState().topics.find((t) => t.id === "sw-t1");
  assert.ok(topicAfterA, "userAへ切り替え後もsw-t1が取得できていない");
  assert.equal(topicAfterA?.authorId, "me", "userA自身のお題がauthorId:meになっていない");
  assert.ok(
    useSnsStore.getState().likedAnswerIds.includes("sw-a1"),
    "Xログイン後、以前いいねしていたsw-a1が『いいね済み』として取得できていない",
  );
  console.log("PASS: ゲスト→Xログイン（userA）で、本人の投稿がme扱いになり、以前のいいね済み状態も正しく復元される");

  // ---- テスト2: 会員A→会員Bへの切り替えで、Aの情報が残らない。 ----
  setAuthUser("userB");
  await waitMicrotasks();
  await waitMicrotasks();

  const topicAfterB = useSnsStore.getState().topics.find((t) => t.id === "sw-t1");
  assert.ok(topicAfterB, "userBへ切り替え後もsw-t1が取得できていない");
  assert.notEqual(topicAfterB?.authorId, "me", "userAの投稿がuserBの画面でもme扱いのまま残っている（漏えい）");
  assert.equal(topicAfterB?.authorId, "userA", "userBの視点でのauthorIdが実IDになっていない");
  assert.equal(
    useSnsStore.getState().likedAnswerIds.includes("sw-a1"),
    false,
    "userAのいいね済み状態がuserBに引き継がれてしまっている",
  );
  console.log("PASS: 会員A→会員Bへの切り替えで、Aのme判定・いいね済み状態が残らずBの内容に作り直される");

  // ---- テスト3: 会員B→ログアウトへの切り替え。 ----
  setAuthUser(null);
  await waitMicrotasks();
  await waitMicrotasks();
  assert.equal(useSnsStore.getState().likedAnswerIds.length, 0, "ログアウト後もいいね済み状態が残っている");
  assert.equal(useSnsStore.getState().myFollowerCount, 0, "ログアウト後、フォロワー数が0で確定していない");
  console.log("PASS: 会員→ログアウトへの切り替えで、いいね済み状態が空に戻る");

  // ---- テスト4: 取得中に別ユーザーへ切り替わった場合、遅れて届いた古い世代の
  //      結果がstateに混ざらない（同じtopic行が二重に追加されない）。 ----
  armHoldNextTopicsQuery();
  setAuthUser("userA"); // この呼び出しのtopics取得が保留される
  await waitMicrotasks(); // supabase.fromが呼ばれ、保留に入るところまで進める

  setAuthUser("userB"); // 保留中に別ユーザーへ切り替える（世代が進む）
  await waitMicrotasks();
  await waitMicrotasks();

  // 保留していたuserA向けの古い取得を、ここで遅れて解決させる。
  releaseHeldTopicsQueries();
  await waitMicrotasks();
  await waitMicrotasks();

  const swT1Occurrences = useSnsStore.getState().topics.filter((t) => t.id === "sw-t1").length;
  assert.equal(
    swT1Occurrences,
    1,
    `取得中に切り替わった古い世代の結果が反映され、sw-t1が重複して追加されている（${swT1Occurrences}件）`,
  );
  const finalTopic = useSnsStore.getState().topics.find((t) => t.id === "sw-t1");
  assert.notEqual(finalTopic?.authorId, "me", "遅れて届いた古い世代(userA)の結果が反映され、userBの画面でme扱いになっている");
  console.log("PASS: 取得中に別ユーザーへ切り替わった場合、遅れて届いた古い世代の結果はstateに反映されず重複もしない");

  console.log("ALL USE_SNS_STORE_SWITCH CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
