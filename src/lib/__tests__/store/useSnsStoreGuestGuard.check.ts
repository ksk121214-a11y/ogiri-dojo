// useSnsStore.ts の全変更系アクション（お題投稿・回答投稿・ツッコミ投稿・削除・
// いいね・フォロー）が、ゲスト（匿名ユーザー）に対しては「本番と同じ実装のまま」
// 呼び出しても、Supabase（supabase.rpc / supabase.from）へ一切リクエストしない
// ことを検証するスクリプト。DB側（RLS/RPCのGUEST_NOT_ALLOWED等）は既に
// supabase/tests/0070・0071の各SQLテストで確認済みのため、ここではフロント側の
// 事前ガード（共通のisGuestUser判定）そのものを検証する。
// 実行方法はsrc/lib/__tests__/run.sh参照（useSnsStoreDelete.check.tsと同様、
// 専用tsconfig＋requireフック経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";

let rpcCallCount = 0;
let fromCallCount = 0;

(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ error: unknown }> }).rpc = async () => {
  rpcCallCount += 1;
  return { error: null, data: { id: "should-not-be-used" } };
};

(supabase as unknown as { from: (table: string) => unknown }).from = () => {
  fromCallCount += 1;
  const chain = {
    insert: () => chain,
    delete: () => chain,
    eq: () => chain,
    select: () => chain,
    single: async () => ({ data: null, error: { message: "should not be called" } }),
    then: (resolve: (v: { error: unknown }) => void) => resolve({ error: null }),
  };
  return chain;
};

function resetCallCounts() {
  rpcCallCount = 0;
  fromCallCount = 0;
}

async function main() {
  // ---- ゲスト（匿名ユーザー）としてストアの状態を用意する。----
  useAuthStore.setState({
    user: { id: "guest-1", is_anonymous: true } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
  useProfileStore.setState({
    profile: {
      id: "guest-1",
      displayName: "ゲスト",
      displayNameSet: true,
      xUsername: null,
      avatarUrl: null,
      isHost: false,
      avatarIcon: "default",
      avatarColor: "#171513",
      isGuest: true,
      bio: "",
      masteryMeter: 0,
      totalPoints: 0,
      pointsBalance: 0,
      liveCount: 0,
      awardCountFirst: 0,
      awardCountSecond: 0,
      awardCountThird: 0,
      bestAnswerCount: 0,
      ticketsCount: 0,
      ticketsNextRecoveryAt: null,
      referralSource: null,
      referralSourceAnsweredAt: null,
    },
    loading: false,
  });

  useSnsStore.setState({
    topics: [{ id: "t1", body: "t1本文", authorId: "other-user", createdAtLabel: "たった今" }],
    answers: [{ id: "a1", topicId: "t1", authorId: "other-user", body: "a1本文", likes: 0, createdAtLabel: "たった今" }],
    comments: [],
    likedAnswerIds: [],
    followingAuthorIds: [],
    deletePending: {},
    likePending: {},
    followPending: {},
  });

  // ---- addTopic/addAnswer/addComment：ゲストはDBへリクエストせず即座に拒否される。----
  resetCallCounts();
  const rTopic = await useSnsStore.getState().addTopic("ゲストが投稿しようとするお題");
  assert.equal(rTopic.ok, false, "ゲストのaddTopicが成功してしまった");
  if (!rTopic.ok) assert.ok(/ゲスト/.test(rTopic.reason), "addTopicの拒否理由がゲスト向けの案内になっていない");
  assert.equal(rpcCallCount, 0, "ゲストのaddTopicでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのaddTopicはDBへリクエストせず即座に拒否される");

  resetCallCounts();
  const rAnswer = await useSnsStore.getState().addAnswer("t1", "ゲストが投稿しようとする回答");
  assert.equal(rAnswer.ok, false, "ゲストのaddAnswerが成功してしまった");
  if (!rAnswer.ok) assert.ok(/ゲスト/.test(rAnswer.reason));
  assert.equal(rpcCallCount, 0, "ゲストのaddAnswerでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのaddAnswerはDBへリクエストせず即座に拒否される");

  resetCallCounts();
  const rComment = await useSnsStore.getState().addComment("a1", "ゲストが投稿しようとするツッコミ");
  assert.equal(rComment.ok, false, "ゲストのaddCommentが成功してしまった");
  if (!rComment.ok) assert.ok(/ゲスト/.test(rComment.reason));
  assert.equal(rpcCallCount, 0, "ゲストのaddCommentでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのaddCommentはDBへリクエストせず即座に拒否される");

  // ---- deleteTopic/deleteAnswer/deleteComment：同様。----
  resetCallCounts();
  const rDelTopic = await useSnsStore.getState().deleteTopic("t1");
  assert.equal(rDelTopic.ok, false, "ゲストのdeleteTopicが成功してしまった");
  if (!rDelTopic.ok) assert.ok(/ゲスト/.test(rDelTopic.reason));
  assert.equal(rpcCallCount, 0, "ゲストのdeleteTopicでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのdeleteTopicはDBへリクエストせず即座に拒否される");

  resetCallCounts();
  const rDelAnswer = await useSnsStore.getState().deleteAnswer("a1");
  assert.equal(rDelAnswer.ok, false, "ゲストのdeleteAnswerが成功してしまった");
  assert.equal(rpcCallCount, 0, "ゲストのdeleteAnswerでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのdeleteAnswerはDBへリクエストせず即座に拒否される");

  resetCallCounts();
  const rDelComment = await useSnsStore.getState().deleteComment("c1");
  assert.equal(rDelComment.ok, false, "ゲストのdeleteCommentが成功してしまった");
  assert.equal(rpcCallCount, 0, "ゲストのdeleteCommentでsupabase.rpcが呼ばれてしまった");
  console.log("PASS: ゲストのdeleteCommentはDBへリクエストせず即座に拒否される");

  // ---- toggleLike/toggleFollow：supabase.fromへも一切リクエストしない。----
  resetCallCounts();
  const rLike = await useSnsStore.getState().toggleLike("a1");
  assert.equal(rLike.ok, false, "ゲストのtoggleLikeが成功してしまった");
  if (!rLike.ok) assert.ok(rLike.message && /ゲスト/.test(rLike.message));
  assert.equal(fromCallCount, 0, "ゲストのtoggleLikeでsupabase.fromが呼ばれてしまった");
  console.log("PASS: ゲストのtoggleLikeはDBへリクエストせず即座に拒否される");

  resetCallCounts();
  const rFollow = await useSnsStore.getState().toggleFollow("other-user");
  assert.equal(rFollow.ok, false, "ゲストのtoggleFollowが成功してしまった");
  if (!rFollow.ok) assert.ok(rFollow.message && /ゲスト/.test(rFollow.message));
  assert.equal(fromCallCount, 0, "ゲストのtoggleFollowでsupabase.fromが呼ばれてしまった");
  console.log("PASS: ゲストのtoggleFollowはDBへリクエストせず即座に拒否される");

  // ---- 回帰確認：通常のXユーザー（is_anonymous=false・profile.isGuest=false）
  //      では、これらのガードに引っかからずDBへリクエストが行われる。----
  useAuthStore.setState({
    user: { id: "xuser-1", is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
  useProfileStore.setState((s) => ({
    profile: s.profile ? { ...s.profile, id: "xuser-1", isGuest: false } : s.profile,
  }));
  resetCallCounts();
  const rTopicMember = await useSnsStore.getState().addTopic("通常会員のお題投稿");
  assert.equal(rTopicMember.ok, true, "通常のXユーザーのaddTopicが失敗してしまった（過剰ブロック）");
  assert.equal(rpcCallCount, 1, "通常のXユーザーのaddTopicでsupabase.rpcが呼ばれていない（過剰ブロック）");
  console.log("PASS: 通常のXユーザーはガードに引っかからず従来どおりDBへリクエストされる（回帰確認）");

  console.log("ALL USE_SNS_STORE_GUEST_GUARD CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
