// useSnsStore.ts の deleteTopic/deleteAnswer/deleteComment を「本番と同じ実装のまま」
// 呼び出して、親子カスケードのローカルstate反映・連打防止・失敗時の非破壊・
// エラー文言の日本語化を検証するスクリプト。実行方法はsrc/lib/__tests__/run.sh参照
// （useLiveFollowerStoreRace.check.tsと同様、専用tsconfig＋requireフック経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useSnsStore } from "@/store/useSnsStore";

// ---- supabase.rpc(...) の最小限のモック ----
// 呼び出し履歴を記録しつつ、テストごとに差し替え可能な応答を返す。
type RpcCall = { name: string; args: unknown };
let rpcCalls: RpcCall[] = [];
let rpcResponse: { error: { message: string } | null } = { error: null };
let rpcDeferred: { promise: Promise<void>; resolve: () => void } | null = null;

(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ error: unknown }> }).rpc = async (
  name,
  args,
) => {
  rpcCalls.push({ name, args });
  if (rpcDeferred) await rpcDeferred.promise;
  return rpcResponse;
};

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ログイン中のユーザーとして扱う（deleteTopic等はauth.uid()相当のログイン確認をまず行う）。
useAuthStore.setState({
  user: { id: "u1" } as never,
  loading: false,
});

async function main() {
  // ---- テスト1: deleteTopicの成功で、お題・その回答・その回答へのツッコミ・
  //      likedAnswerIdsの該当分がまとめてローカルstateから消える。無関係な
  //      投稿（別の投稿者・別のお題系列）は無傷。RPCはp_topic_idを渡して1回だけ。 ----
  useSnsStore.setState({
    topics: [
      { id: "t1", body: "t1本文", authorId: "me", createdAtLabel: "たった今" },
      { id: "t2", body: "t2本文", authorId: "other-user", createdAtLabel: "たった今" },
    ],
    answers: [
      { id: "a1", topicId: "t1", authorId: "me", body: "a1本文", likes: 0, createdAtLabel: "たった今" },
      { id: "a2", topicId: "t2", authorId: "other-user", body: "a2本文", likes: 0, createdAtLabel: "たった今" },
    ],
    comments: [
      { id: "c1", answerId: "a1", authorId: "other-user", body: "c1本文", createdAtLabel: "たった今" },
      { id: "c2", answerId: "a2", authorId: "me", body: "c2本文", createdAtLabel: "たった今" },
    ],
    likedAnswerIds: ["a1", "a2"],
    deletePending: {},
  });
  rpcCalls = [];
  rpcResponse = { error: null };

  const r1 = await useSnsStore.getState().deleteTopic("t1");
  assert.equal(r1.ok, true, "deleteTopicの成功がokを返さなかった");
  assert.equal(rpcCalls.length, 1, "delete_own_sns_topicの呼び出し回数が1回ではない");
  assert.deepEqual(rpcCalls[0], { name: "delete_own_sns_topic", args: { p_topic_id: "t1" } });

  {
    const s = useSnsStore.getState();
    assert.ok(!s.topics.some((t) => t.id === "t1"), "削除したt1がtopicsに残っている");
    assert.ok(s.topics.some((t) => t.id === "t2"), "無関係なt2まで消えた");
    assert.ok(!s.answers.some((a) => a.id === "a1"), "お題削除でカスケードされるはずのa1が残っている");
    assert.ok(s.answers.some((a) => a.id === "a2"), "無関係なa2まで消えた");
    assert.ok(!s.comments.some((c) => c.id === "c1"), "お題削除でカスケードされるはずのc1が残っている");
    assert.ok(s.comments.some((c) => c.id === "c2"), "無関係なc2まで消えた");
    assert.ok(!s.likedAnswerIds.includes("a1"), "削除されたa1のいいね状態(likedAnswerIds)が残っている");
    assert.ok(s.likedAnswerIds.includes("a2"), "無関係なa2のいいね状態まで消えた");
  }
  console.log("PASS: deleteTopic成功で、お題・その回答・そのツッコミ・likedAnswerIdsがまとめて消え、無関係な投稿は無傷");

  // ---- テスト2: deleteAnswerの成功で、回答・そのツッコミ・likedAnswerIdsの
  //      該当分が消える。親のお題（t2）には影響しない。 ----
  rpcCalls = [];
  rpcResponse = { error: null };
  const r2 = await useSnsStore.getState().deleteAnswer("a2");
  assert.equal(r2.ok, true, "deleteAnswerの成功がokを返さなかった");
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0], { name: "delete_own_sns_answer", args: { p_answer_id: "a2" } });
  {
    const s = useSnsStore.getState();
    assert.ok(!s.answers.some((a) => a.id === "a2"), "削除したa2がanswersに残っている");
    assert.ok(!s.comments.some((c) => c.id === "c2"), "回答削除でカスケードされるはずのc2が残っている");
    assert.ok(!s.likedAnswerIds.includes("a2"), "削除されたa2のいいね状態が残っている");
    assert.ok(s.topics.some((t) => t.id === "t2"), "回答削除で親のお題t2まで消えた");
  }
  console.log("PASS: deleteAnswer成功で、回答・そのツッコミ・likedAnswerIdsが消え、親のお題には影響しない");

  // ---- テスト3: RPCが失敗（NOT_OWNER）した場合、対象はローカルstateから消えず、
  //      画面へ返す理由は日本語に変換済み（生のNOT_OWNERを出さない）。 ----
  useSnsStore.setState((s) => ({
    comments: [...s.comments, { id: "c3", answerId: "a-none", authorId: "me", body: "c3本文", createdAtLabel: "たった今" }],
  }));
  rpcCalls = [];
  rpcResponse = { error: { message: "NOT_OWNER" } };
  const r3 = await useSnsStore.getState().deleteComment("c3");
  assert.equal(r3.ok, false, "本来失敗するはずのdeleteCommentが成功してしまった");
  if (!r3.ok) {
    assert.equal(r3.reason, "自分の投稿だけ削除できます", "生のエラーコードがそのまま画面向けの理由になっている");
  }
  assert.ok(
    useSnsStore.getState().comments.some((c) => c.id === "c3"),
    "失敗したのにc3がローカルstateから消えてしまった（表示を消してはいけない）",
  );
  console.log("PASS: RPC失敗時は対象がstateに残り、理由は日本語に変換済み（生のエラーコードを出さない）");

  // ---- テスト4: 連打防止。1回目が完了する前に2回目を呼んでも、RPCは1回しか
  //      呼ばれない（2回目はdeletePendingガードで即座にok:falseを返す）。 ----
  useSnsStore.setState((s) => ({
    topics: [...s.topics, { id: "t4", body: "t4本文", authorId: "me", createdAtLabel: "たった今" }],
    deletePending: {},
  }));
  rpcCalls = [];
  rpcResponse = { error: null };
  rpcDeferred = makeDeferred();

  const p1 = useSnsStore.getState().deleteTopic("t4");
  const p2 = useSnsStore.getState().deleteTopic("t4"); // 1回目がまだ保留中のうちに呼ぶ（連打相当）
  const r2b = await p2;
  assert.equal(r2b.ok, false, "保留中の2回目の呼び出しがokを返してしまった（連打防止が効いていない）");

  rpcDeferred.resolve();
  const r1b = await p1;
  assert.equal(r1b.ok, true, "1回目の呼び出しが正しく完了しなかった");
  assert.equal(rpcCalls.length, 1, "連打（保留中の再呼び出し）でRPCが2回以上呼ばれた");
  rpcDeferred = null;
  console.log("PASS: 保留中に連打してもRPCは1回だけ呼ばれる（2回目は即座にok:falseで弾かれる）");

  console.log("ALL USE_SNS_STORE_DELETE CHECKS PASSED");
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
