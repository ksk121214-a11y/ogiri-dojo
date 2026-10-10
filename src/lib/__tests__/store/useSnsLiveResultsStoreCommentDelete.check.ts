// useSnsLiveResultsStore.ts の addComment / deleteComment（ライブ結果コメントの
// 投稿・自己削除）を、本番と同じ実装のまま呼び出して検証する。所有者確認・論理削除
// の実体はdelete_own_sns_live_result_comment RPC（SQL側、supabase/tests/0088参照）が
// 担うため、ここではストア側の責務（未ログイン拒否・連打防止・成功/失敗時のローカル
// state反映・一覧summaries[].commentCountの同期・アカウント切替中の古い結果の反映
// 防止）だけを確認する。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig経由）。
import assert from "node:assert/strict";

import type { SnsLiveResultLabel } from "@/types/snsLiveResults";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");

type RpcMode = "success" | "error" | "gated";
let rpcMode: RpcMode = "success";
let rpcCallCount = 0;
let rpcGateResolvers: (() => void)[] = [];

(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }> }).rpc =
  async (name: string) => {
    if (name !== "delete_own_sns_live_result_comment") return { data: null, error: null };
    rpcCallCount += 1;
    if (rpcMode === "gated") {
      await new Promise<void>((resolve) => rpcGateResolvers.push(resolve));
      return { data: null, error: null };
    }
    if (rpcMode === "error") return { data: null, error: { message: "NOT_OWNER" } };
    return { data: null, error: null };
  };

function releaseGatedRpc() {
  const resolvers = rpcGateResolvers;
  rpcGateResolvers = [];
  for (const r of resolvers) r();
}

// addComment（.from("sns_live_result_comments").insert(...).select().single()）用の
// 制御可能なモード。success/error/gatedはdeleteComment側のrpcModeと同じ意味。
type InsertMode = "success" | "error" | "gated";
let insertMode: InsertMode = "success";
let insertCallCount = 0;
let insertGateResolvers: (() => void)[] = [];
let insertedCommentSeq = 0;

function releaseGatedInsert() {
  const resolvers = insertGateResolvers;
  insertGateResolvers = [];
  for (const r of resolvers) r();
}

// deleteComment自体はsupabase.rpc(...)しか呼ばないが、useAuthStore/useProfileStore等の
// 初期化処理がこのテストの裏で.from(...)を呼ぶ可能性があるため、常に安全に解決する
// 汎用チェーンを用意する（useSnsLiveResultsStoreStoreSwitch.check.tsのmakeSafeChainと同じ方針）。
function makeSafeChain(resolveValue: () => unknown) {
  const chain: Record<string, unknown> = {};
  const passthrough = ["select", "eq", "neq", "in", "order", "limit", "lt", "is", "match"];
  for (const m of passthrough) chain[m] = () => chain;
  chain.maybeSingle = async () => resolveValue();
  chain.single = async () => resolveValue();
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolveValue()).then(ok);
  return chain;
}
(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  if (table === "sns_live_result_comments") {
    const chain: Record<string, unknown> = {};
    let insertedBody = "";
    chain.insert = (payload: { body: string }) => {
      insertedBody = payload.body;
      return chain;
    };
    chain.select = () => chain;
    chain.single = async () => {
      insertCallCount += 1;
      if (insertMode === "gated") {
        await new Promise<void>((resolve) => insertGateResolvers.push(resolve));
      }
      if (insertMode === "error") return { data: null, error: { message: "insert failed" } };
      insertedCommentSeq += 1;
      return { data: { id: `new-comment-${insertedCommentSeq}`, body: insertedBody }, error: null };
    };
    return chain;
  }
  return makeSafeChain(() => ({ data: null, error: null, count: 0 }));
};

(supabase.auth as unknown as {
  getSession: () => Promise<{ data: { session: { user: { id: string; is_anonymous: boolean } } | null } }>;
}).getSession = async () => ({
  data: { session: { user: { id: "userA", is_anonymous: false } } },
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

async function waitMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const RESULT_ID = "result-1";
const RA_ID = "ra-1";
const OTHER_RESULT_ID = "result-2";
const OTHER_RA_ID = "ra-2";

// RA_IDのカードを、podium(rank1)とmanagerBestの両方へ重複して持たせる（運営ベストに
// 順位代表と同じ回答を選んだ場合の実際にあり得る構成）。これにより
// 「同じ回答カードが順位・運営ベスト・満点に重複表示されても複数回増減しない」ことを
// 検証できる。
function buildCard(commentCount: number) {
  return {
    resultAnswerId: RA_ID,
    answerId: "answer-1",
    authorId: "me",
    participantId: "participant-1",
    topicId: "topic-1",
    topicBody: "お題",
    body: "回答本文",
    score: 5,
    createdAt: "2026-01-01T00:00:00Z",
    labels: ["rank1", "managerBest"] as SnsLiveResultLabel[],
    likes: 0,
    liked: false,
    commentCount,
  };
}

// 別のライブ結果(OTHER_RESULT_ID/OTHER_RA_ID)も同時に用意し、「1回の投稿・削除に
// つき対象の1件だけが変化し、無関係な一覧カードは変化しない」ことも確認できるようにする。
function buildOtherCard() {
  return {
    resultAnswerId: OTHER_RA_ID,
    answerId: "answer-2",
    authorId: "me",
    participantId: "participant-2",
    topicId: "topic-2",
    topicBody: "別のお題",
    body: "別の回答本文",
    score: 3,
    createdAt: "2026-01-01T00:00:00Z",
    labels: ["rank1"] as SnsLiveResultLabel[],
    likes: 0,
    liked: false,
    commentCount: 0,
  };
}

function seedState(opts: { commentCount: number; otherCommentCount?: number } = { commentCount: 2 }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSnsLiveResultsStore } = require("@/store/useSnsLiveResultsStore") as
    typeof import("@/store/useSnsLiveResultsStore");
  const card = buildCard(opts.commentCount);
  const otherCard = buildOtherCard();
  useSnsLiveResultsStore.setState({
    summaries: [
      {
        id: RESULT_ID,
        liveId: "live-1",
        sequenceNumber: 1,
        title: null,
        endedAtLabel: "",
        podiumNames: [],
        perfectCount: 0,
        likeCount: 0,
        commentCount: opts.commentCount,
      },
      {
        id: OTHER_RESULT_ID,
        liveId: "live-2",
        sequenceNumber: 2,
        title: null,
        endedAtLabel: "",
        podiumNames: [],
        perfectCount: 0,
        likeCount: 0,
        commentCount: opts.otherCommentCount ?? 0,
      },
    ],
    details: {
      [RESULT_ID]: {
        id: RESULT_ID,
        liveId: "live-1",
        sequenceNumber: 1,
        title: null,
        endedAtLabel: "",
        managerComment: null,
        // RA_IDのカードをpodium(rank1)とmanagerBestの両方に重複して持たせる。
        podium: [
          {
            rank: 1,
            participants: [{ participantId: "participant-1", authorId: "me", topics: [{ topicId: "topic-1", topicBody: "お題", totalScore: 5, cards: [card] }] }],
          },
        ],
        managerBest: card,
        perfect: [],
        comments: {
          [RA_ID]: [
            { id: "c1", resultAnswerId: RA_ID, authorId: "me", body: "c1本文", createdAtLabel: "たった今" },
            { id: "c2", resultAnswerId: RA_ID, authorId: "me", body: "c2本文", createdAtLabel: "たった今" },
          ],
        },
      },
      [OTHER_RESULT_ID]: {
        id: OTHER_RESULT_ID,
        liveId: "live-2",
        sequenceNumber: 2,
        title: null,
        endedAtLabel: "",
        managerComment: null,
        podium: [
          {
            rank: 1,
            participants: [{ participantId: "participant-2", authorId: "me", topics: [{ topicId: "topic-2", topicBody: "別のお題", totalScore: 3, cards: [otherCard] }] }],
          },
        ],
        managerBest: null,
        perfect: [],
        comments: {},
      },
    },
    commentPending: {},
    commentDeletePending: {},
  });
}

function getSummaryCommentCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  resultId: string,
): number | undefined {
  return store.getState().summaries.find((s: { id: string }) => s.id === resultId)?.commentCount;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuthStore } = require("@/store/useAuthStore") as typeof import("@/store/useAuthStore");
  await waitMicrotasks();
  assert.equal(useAuthStore.getState().loading, false, "テスト前提が崩れている（useAuthStoreがまだloading中）");
  assert.equal(useAuthStore.getState().user?.id, "userA", "テスト前提が崩れている（userAで確定していない）");

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSnsLiveResultsStore } = require("@/store/useSnsLiveResultsStore") as
    typeof import("@/store/useSnsLiveResultsStore");

  function setAuthUser(id: string | null) {
    useAuthStore.setState({
      user: id ? ({ id, is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
      loading: false,
    });
  }

  // ===== deleteComment =====

  // 1) 未ログインは削除できない（RPCを一切呼ばない、一覧の件数も変わらない）。
  // 注意：setAuthUser（アカウント切替）はdetailsをリセットする副作用を持つため、
  // 必ず「切替→待機→seedState（データ投入）」の順で行う。
  {
    setAuthUser(null);
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    rpcCallCount = 0;
    rpcMode = "success";
    const result = await useSnsLiveResultsStore.getState().deleteComment("c1");
    assert.equal(result.ok, false, "未ログインなのに削除できてしまった");
    assert.equal(rpcCallCount, 0, "未ログインなのにRPCが呼ばれた");
    assert.ok(
      useSnsLiveResultsStore.getState().details[RESULT_ID]?.comments[RA_ID]?.some((c) => c.id === "c1"),
      "未ログインでの失敗なのにコメントが消えてしまった",
    );
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 2, "未ログインでの失敗なのに一覧のcommentCountが変化した");
    console.log("PASS: deleteComment - 未ログインではRPCを呼ばずに拒否され、コメント・一覧の件数も変わらない");
  }

  // 2) 本人（ログイン済み）は削除でき、成功時だけ詳細・一覧とも1件減る。重複表示
  //    （podium・managerBestの両方に同じカード）があっても二重に減らない。無関係な
  //    別のライブ結果(OTHER_RESULT_ID)の件数は変化しない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2, otherCommentCount: 5 });
    rpcCallCount = 0;
    rpcMode = "success";
    const before = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID].length;
    const result = await useSnsLiveResultsStore.getState().deleteComment("c1");
    assert.equal(result.ok, true, `成功するはずの削除が失敗した: ${JSON.stringify(result)}`);
    assert.equal(rpcCallCount, 1, "RPCが1回だけ呼ばれていない");
    const after = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID];
    assert.equal(after.length, before - 1, "成功時にコメント件数が1件減っていない");
    assert.ok(!after.some((c) => c.id === "c1"), "削除したコメントがまだ残っている");
    assert.ok(after.some((c) => c.id === "c2"), "削除していない別のコメントまで消えてしまった");
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID),
      1,
      "一覧のcommentCountが1件だけ減っていない（重複表示カードの分だけ余分に減った可能性）",
    );
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, OTHER_RESULT_ID),
      5,
      "無関係な別のライブ結果の一覧commentCountまで変化した",
    );
    console.log(
      "PASS: deleteComment - 成功時だけ詳細・一覧とも1件減り、重複表示カードでも二重に減らず、無関係な一覧は変化しない",
    );
  }

  // 3) RPC失敗（例：他人のコメントでNOT_OWNER）時は、詳細・一覧とも件数を変更しない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    rpcCallCount = 0;
    rpcMode = "error";
    const before = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID].length;
    const result = await useSnsLiveResultsStore.getState().deleteComment("c1");
    assert.equal(result.ok, false, "RPCエラーなのに成功扱いになった");
    const after = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID];
    assert.equal(after.length, before, "失敗したのにコメント件数が変化した");
    assert.ok(after.some((c) => c.id === "c1"), "失敗したのにコメントが消えてしまった（他人のコメントは削除できない、の裏付け）");
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 2, "RPC失敗なのに一覧のcommentCountが変化した");
    console.log("PASS: deleteComment - RPC失敗時（他人のコメント等）は詳細・一覧とも件数を一切変更しない");
  }

  // 4) 削除対象がローカルstateに存在しない場合は、RPCが成功してもcommentCountを減らさない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    rpcCallCount = 0;
    rpcMode = "success";
    const result = await useSnsLiveResultsStore.getState().deleteComment("comment-not-in-local-state");
    assert.equal(result.ok, true, "RPC自体は成功する想定（サーバー側には存在するがローカルキャッシュに無いケース）");
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID),
      2,
      "ローカルstateに存在しない削除対象なのに、一覧のcommentCountが減ってしまった",
    );
    console.log("PASS: deleteComment - 削除対象がローカルstateに存在しない場合は一覧のcommentCountを減らさない");
  }

  // 5) 0未満にしない（commentCount=0の状態から削除が成功しても-1にならず0のまま）。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 0 });
    rpcCallCount = 0;
    rpcMode = "success";
    const result = await useSnsLiveResultsStore.getState().deleteComment("c1");
    assert.equal(result.ok, true);
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 0, "一覧のcommentCountが0未満になった");
    console.log("PASS: deleteComment - 一覧のcommentCountは0未満にならない");
  }

  // 6) 二重クリックでもRPCが重複実行されず、一覧のcommentCountも1回だけ減る。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    rpcCallCount = 0;
    rpcMode = "gated";
    const first = useSnsLiveResultsStore.getState().deleteComment("c1");
    await waitMicrotasks();
    assert.equal(useSnsLiveResultsStore.getState().commentDeletePending["c1"], true, "1回目の呼び出しでpendingが立っていない");
    const second = await useSnsLiveResultsStore.getState().deleteComment("c1"); // 連打（2回目）
    assert.equal(second.ok, false, "pending中の2回目の呼び出しがok:trueを返した（連打防止になっていない）");
    assert.equal(rpcCallCount, 1, `RPCが1回だけ呼ばれていない（連打で重複実行された、実際=${rpcCallCount}回）`);
    releaseGatedRpc();
    const firstResult = await first;
    assert.equal(firstResult.ok, true, "1回目の呼び出し自体は成功するはずだった");
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 1, "連打しても一覧のcommentCountは1回だけ減るはず");
    console.log("PASS: deleteComment - 二重クリックでもRPCは1回だけ実行され、一覧のcommentCountも1回だけ減る");
  }

  // 7) 削除中にアカウントが切り替わっても、古い結果を新しい利用者のstate・一覧へ反映しない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    rpcCallCount = 0;
    rpcMode = "gated";
    const pending = useSnsLiveResultsStore.getState().deleteComment("c1");
    await waitMicrotasks();

    setAuthUser("userB");
    await waitMicrotasks();
    assert.deepEqual(useSnsLiveResultsStore.getState().details, {}, "アカウント切替でdetailsがリセットされていない（テスト前提が崩れている）");

    releaseGatedRpc();
    const result = await pending;
    assert.equal(result.ok, false, "古い世代の削除結果が、世代ガードを無視してok:trueを返した");
    assert.deepEqual(
      useSnsLiveResultsStore.getState().details,
      {},
      "アカウント切替後に、古い世代の削除結果がdetailsへ反映されてしまった（新しい利用者の画面を汚染する）",
    );
    // summariesはアカウント切替でリセットされない仕様（誰が見ているかに依存しない情報のため）。
    // 古い世代の削除結果が、このsummariesへ反映されていないことを確認する。
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID),
      2,
      "アカウント切替後に、古い世代の削除結果が一覧のcommentCountへ反映されてしまった",
    );
    console.log("PASS: deleteComment - 削除中にアカウントが切り替わった場合、古い世代の結果は新しい利用者のstate・一覧へ反映されない");
  }

  // ===== addComment =====

  // 8) 本人（ログイン済み）は投稿でき、成功時だけ詳細・一覧とも1件増える。重複表示
  //    （podium・managerBestの両方に同じカード）があっても二重に増えない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2, otherCommentCount: 5 });
    insertCallCount = 0;
    insertMode = "success";
    const result = await useSnsLiveResultsStore.getState().addComment(RA_ID, "新しいコメント");
    assert.equal(result.ok, true, `成功するはずの投稿が失敗した: ${JSON.stringify(result)}`);
    assert.equal(insertCallCount, 1, "INSERTが1回だけ呼ばれていない");
    const comments = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID];
    assert.equal(comments.length, 3, "成功時にコメント件数が1件増えていない");
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID),
      3,
      "一覧のcommentCountが1件だけ増えていない（重複表示カードの分だけ余分に増えた可能性）",
    );
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, OTHER_RESULT_ID),
      5,
      "無関係な別のライブ結果の一覧commentCountまで変化した",
    );
    console.log(
      "PASS: addComment - 成功時だけ詳細・一覧とも1件増え、重複表示カードでも二重に増えず、無関係な一覧は変化しない",
    );
  }

  // 9) 投稿失敗時は、詳細・一覧とも件数を変更しない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    insertCallCount = 0;
    insertMode = "error";
    const before = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID].length;
    const result = await useSnsLiveResultsStore.getState().addComment(RA_ID, "失敗するコメント");
    assert.equal(result.ok, false, "INSERT失敗なのに成功扱いになった");
    const after = useSnsLiveResultsStore.getState().details[RESULT_ID].comments[RA_ID];
    assert.equal(after.length, before, "失敗したのにコメント件数が変化した");
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 2, "INSERT失敗なのに一覧のcommentCountが変化した");
    console.log("PASS: addComment - 投稿失敗時は詳細・一覧とも件数を一切変更しない");
  }

  // 10) 二重送信でもINSERTが重複実行されず、一覧のcommentCountも1回だけ増える。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    insertCallCount = 0;
    insertMode = "gated";
    const first = useSnsLiveResultsStore.getState().addComment(RA_ID, "連打1回目");
    await waitMicrotasks();
    assert.equal(useSnsLiveResultsStore.getState().commentPending[RA_ID], true, "1回目の呼び出しでcommentPendingが立っていない");
    const second = await useSnsLiveResultsStore.getState().addComment(RA_ID, "連打2回目");
    assert.equal(second.ok, false, "pending中の2回目の呼び出しがok:trueを返した（連打防止になっていない）");
    assert.equal(insertCallCount, 1, `INSERTが1回だけ呼ばれていない（連打で重複実行された、実際=${insertCallCount}回）`);
    releaseGatedInsert();
    const firstResult = await first;
    assert.equal(firstResult.ok, true, "1回目の呼び出し自体は成功するはずだった");
    assert.equal(getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID), 3, "連打しても一覧のcommentCountは1回だけ増えるはず");
    console.log("PASS: addComment - 二重送信でもINSERTは1回だけ実行され、一覧のcommentCountも1回だけ増える");
  }

  // 11) 投稿中にアカウントが切り替わっても、古い結果を新しい利用者のstate・一覧へ反映しない。
  {
    setAuthUser("userA");
    await waitMicrotasks();
    seedState({ commentCount: 2 });
    insertCallCount = 0;
    insertMode = "gated";
    const pending = useSnsLiveResultsStore.getState().addComment(RA_ID, "切替中の投稿");
    await waitMicrotasks();

    setAuthUser("userB");
    await waitMicrotasks();
    assert.deepEqual(useSnsLiveResultsStore.getState().details, {}, "アカウント切替でdetailsがリセットされていない（テスト前提が崩れている）");

    releaseGatedInsert();
    const result = await pending;
    assert.equal(result.ok, false, "古い世代の投稿結果が、世代ガードを無視してok:trueを返した");
    assert.deepEqual(
      useSnsLiveResultsStore.getState().details,
      {},
      "アカウント切替後に、古い世代の投稿結果がdetailsへ反映されてしまった",
    );
    assert.equal(
      getSummaryCommentCount(useSnsLiveResultsStore, RESULT_ID),
      2,
      "アカウント切替後に、古い世代の投稿結果が一覧のcommentCountへ反映されてしまった",
    );
    console.log("PASS: addComment - 投稿中にアカウントが切り替わった場合、古い世代の結果は新しい利用者のstate・一覧へ反映されない");
  }

  console.log("ALL USE_SNS_LIVE_RESULTS_STORE_COMMENT_DELETE CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
