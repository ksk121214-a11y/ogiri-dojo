// 2026-09-22（レビュー対応・項目2）：useLiveFollowerStore.joinLive成功後に
// useProfileStore.refreshProfileを呼ぶようになった変更の検証。
// 実行方法はsrc/lib/__tests__/run.sh参照（useLiveFollowerStore.tsが"@/..."
// エイリアス・実際のSupabaseクライアント生成を含むため、他のcheck.tsと同じ
// 素のtsc起動では解決できず、専用tsconfig経由でコンパイル・実行する）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { LiveRow, ParticipantRow } from "@/lib/liveRoomTypes";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

type RpcResponse = { data: unknown; error: { message: string } | null };
let nextRpcResponse: RpcResponse = { data: null, error: null };
let rpcCallCount = 0;
(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<RpcResponse> }).rpc = async () => {
  rpcCallCount += 1;
  return nextRpcResponse;
};

function makeLive(id: string): LiveRow {
  return { id, current_phase: "opening" } as unknown as LiveRow;
}

function makeParticipant(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: "participant-1",
    live_id: "live-1",
    user_id: "user-1",
    group_id: null,
    role: "audience",
    preferred_role: "audience",
    joined_at: new Date().toISOString(),
    host_message: null,
    host_message_sent_at: null,
    kicked_at: null,
    is_guest: false,
    guest_number: null,
    referral_source: null,
    ...overrides,
  } as ParticipantRow;
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    displayName: "テスト会員",
    displayNameSet: true,
    xUsername: null,
    avatarUrl: null,
    isHost: false,
    avatarIcon: "default",
    avatarColor: "#c8320c",
    isGuest: false,
    bio: "",
    masteryMeter: 0,
    totalPoints: 0,
    pointsBalance: 0,
    liveCount: 0,
    awardCountFirst: 0,
    awardCountSecond: 0,
    awardCountThird: 0,
    bestAnswerCount: 0,
    ticketsCount: 5,
    ticketsNextRecoveryAt: null,
    referralSource: null,
    referralSourceAnsweredAt: null,
    ...overrides,
  } as unknown as ReturnType<typeof useProfileStore.getState>["profile"];
}

function setAuthUser(id: string, isAnonymous: boolean) {
  useAuthStore.setState({
    user: { id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
}

async function main() {
  // ---- テスト1: 通常会員が流入元を選んで参加成功した後、refreshProfileが呼ばれる。----
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1", referralSource: null, referralSourceAnsweredAt: null }) });
  useLiveFollowerStore.setState({ live: makeLive("live-1"), myParticipant: null, error: null });
  nextRpcResponse = { data: makeParticipant({ referral_source: "x" }), error: null };
  let refreshCallCount = 0;
  useProfileStore.setState({
    refreshProfile: async () => {
      refreshCallCount += 1;
    },
  });
  await useLiveFollowerStore.getState().joinLive("audience", "x");
  // joinLive内部でrefreshProfileをawaitせず投げっぱなしにしているため、
  // マイクロタスクの完了を待ってから確認する。
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(useLiveFollowerStore.getState().myParticipant?.id, "participant-1", "参加成功でmyParticipantがセットされていない");
  assert.equal(refreshCallCount, 1, "流入元を選んで参加成功したのにrefreshProfileが呼ばれていない");
  console.log("PASS: 通常会員が流入元を選んで参加成功した後、refreshProfileが呼ばれる");

  // ---- テスト2:「選択しない」（null）で参加成功した場合も、refreshProfile自体は
  //      呼ばれる（未回答判定はDBの値に委ねるだけで、ここでローカルに
  //      「回答済み」を作り出したりはしない）。 ----
  useLiveFollowerStore.setState({ live: makeLive("live-2"), myParticipant: null, error: null });
  nextRpcResponse = { data: makeParticipant({ id: "participant-2", live_id: "live-2", referral_source: null }), error: null };
  refreshCallCount = 0;
  await useLiveFollowerStore.getState().joinLive("audience", null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(refreshCallCount, 1, "「選択しない」で参加成功してもrefreshProfileは呼ばれるべき");
  // joinLive自身はprofile.referralSourceAnsweredAtを直接書き換えない
  // （refreshProfileが実際にDBから取得した結果でしか変わらない）ことを確認する。
  assert.equal(useProfileStore.getState().profile?.referralSourceAnsweredAt, null, "未回答なのにjoinLiveがローカルで回答済みを作り出した");
  console.log("PASS: 「選択しない」で参加してもrefreshProfileは呼ばれ、joinLive自身はローカルで回答済み状態を作り出さない");

  // ---- テスト3: ゲスト（is_guest_userと判定される）が参加成功しても、
  //      refreshProfileは呼ばれない。 ----
  setAuthUser("guest-1", true);
  useProfileStore.setState({ profile: makeProfile({ id: "guest-1", isGuest: true }) });
  useLiveFollowerStore.setState({ live: makeLive("live-3"), myParticipant: null, error: null });
  nextRpcResponse = { data: makeParticipant({ id: "participant-3", live_id: "live-3", user_id: "guest-1", is_guest: true }), error: null };
  refreshCallCount = 0;
  await useLiveFollowerStore.getState().joinLive("audience", "x");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(refreshCallCount, 0, "ゲストの参加成功でrefreshProfileが呼ばれてしまった");
  console.log("PASS: ゲストが参加成功してもrefreshProfileは呼ばれない");

  // ---- テスト4: RPC自体が失敗した場合はrefreshProfileを呼ばず、
  //      生のerror.messageをerrorへ格納しない。 ----
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-4"), myParticipant: null, error: null });
  nextRpcResponse = { data: null, error: { message: "duplicate key value violates unique constraint \"participants_pkey\"" } };
  refreshCallCount = 0;
  await useLiveFollowerStore.getState().joinLive("audience", "x");
  await Promise.resolve();
  assert.equal(refreshCallCount, 0, "join_live失敗なのにrefreshProfileが呼ばれた");
  const failReason = useLiveFollowerStore.getState().error;
  assert.ok(failReason && !failReason.includes("constraint") && !failReason.includes("duplicate key"), "生のPostgreSQLエラーがそのままerrorに入っている");
  console.log("PASS: join_live失敗時はrefreshProfileを呼ばず、生のDBエラーもerrorへ入らない");

  // ---- テスト5: refreshProfile自体が例外を投げても、参加処理の結果
  //      （myParticipant・error）には影響しない。 ----
  useLiveFollowerStore.setState({ live: makeLive("live-5"), myParticipant: null, error: null });
  nextRpcResponse = { data: makeParticipant({ id: "participant-5", live_id: "live-5", referral_source: "app" }), error: null };
  useProfileStore.setState({
    refreshProfile: async () => {
      throw new Error("想定外のネットワークエラー");
    },
  });
  await assert.doesNotReject(
    () => useLiveFollowerStore.getState().joinLive("audience", "app"),
    "refreshProfileの失敗でjoinLive自体がrejectされてしまった",
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(useLiveFollowerStore.getState().myParticipant?.id, "participant-5", "refreshProfile失敗の影響で参加結果が反映されなかった");
  assert.equal(useLiveFollowerStore.getState().error, null, "refreshProfile失敗が参加自体のerrorに漏れてしまった");
  console.log("PASS: refreshProfileが例外を投げても、参加処理自体は成功したまま影響を受けない");

  // rpcが最低限呼ばれていること自体の健全性チェック（回帰確認）。
  assert.ok(rpcCallCount >= 5, "join_liveのRPCモック自体が呼ばれていない");

  console.log("ALL USE_LIVE_FOLLOWER_STORE_JOIN_REFERRAL CHECKS PASSED");
}

main();
