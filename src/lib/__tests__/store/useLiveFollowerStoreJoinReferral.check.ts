// 2026-09-22（レビュー対応・再修正）：useLiveFollowerStore.joinLiveの
// (1)アカウント/ライブ切り替え中の古いRPC結果を破棄する世代ガード、
// (2)join_liveが返したeffective_referral_sourceをuseProfileStore.
// applyReferralAnswerFromJoin経由でDB更新を待たずにローカル反映する処理、
// を「本番と同じ実装のまま」検証するスクリプト。実行方法は
// src/lib/__tests__/run.sh参照（useLiveFollowerStore.ts/useProfileStore.tsが
// "@/..."エイリアス・実際のSupabaseクライアント生成を含むため、他のcheck.tsと
// 同じ素のtsc起動では解決できず、専用tsconfig経由でコンパイル・実行する）。
//
// 単に関数の呼び出し回数だけを見るのではなく、実際に「開始→(必要なら)
// アカウント/ライブ切り替え→RPC応答を遅延解決」という順序をdeferred Promiseで
// 再現し、その結果としてstateがどうなったかを検証する。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { LiveRow, ParticipantRow } from "@/lib/liveRoomTypes";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

type RpcResponse = { data: unknown; error: { message: string } | null };
type PendingRpc = { resolve: (r: RpcResponse) => void };

const pendingRpcs: PendingRpc[] = [];
let rpcCallCount = 0;
(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<RpcResponse> }).rpc = (name) => {
  assert.equal(name, "join_live");
  rpcCallCount += 1;
  return new Promise<RpcResponse>((resolve) => {
    pendingRpcs.push({ resolve });
  });
};

// 直前のjoin_live呼び出しが積んだ「保留中の応答」を解決する。
// 呼び出し順とawaitのタイミングがズレていないかの前提チェックも兼ねる。
function resolvePendingRpc(response: RpcResponse) {
  const pending = pendingRpcs.shift();
  if (!pending) throw new Error("解決すべき保留中のjoin_live呼び出しが無い");
  pending.resolve(response);
}

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

type Profile = NonNullable<ReturnType<typeof useProfileStore.getState>["profile"]>;

function makeProfile(overrides: Partial<Profile> & { id: string }): Profile {
  return {
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
  } as Profile;
}

function setAuthUser(id: string, isAnonymous: boolean) {
  useAuthStore.setState({
    user: { id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
}

// 実プロフィール取得(fetchProfile)を経由させないための、呼び出し回数だけを
// 記録するrefreshProfileスパイ（テスト1〜4・6〜8用）。
function installCountingRefreshProfileSpy(): { count: () => number } {
  let count = 0;
  useProfileStore.setState({
    refreshProfile: async () => {
      count += 1;
    },
  });
  return { count: () => count };
}

async function main() {
  // ============================================================
  // テスト1: 通常会員がxを選択してjoinLive成功。
  // ============================================================
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-1"), myParticipant: null, error: null });
  const spy1 = installCountingRefreshProfileSpy();

  const p1 = useLiveFollowerStore.getState().joinLive("audience", "x");
  resolvePendingRpc({ data: makeParticipant({ id: "participant-1", live_id: "live-1", referral_source: "x" }), error: null });
  await p1;

  assert.equal(useLiveFollowerStore.getState().myParticipant?.id, "participant-1", "参加成功でmyParticipantがセットされていない");
  const profileAfter1 = useProfileStore.getState().profile;
  assert.equal(profileAfter1?.referralSource, "x", "joinLive完了時点でprofile.referralSourceがxになっていない");
  assert.ok(profileAfter1?.referralSourceAnsweredAt, "profile.referralSourceAnsweredAtがnullのまま");
  // OpeningViewの表示条件と同じロジック（両方nullの時だけ表示）で、
  // 次回ライブ相当の表示判定でアンケートが表示されないことを確認する。
  const showSurveyAfter1 = profileAfter1?.referralSource == null && profileAfter1?.referralSourceAnsweredAt == null;
  assert.equal(showSurveyAfter1, false, "回答済みなのに次回もアンケートが表示される判定になっている");
  assert.equal(spy1.count(), 1, "参加成功後にrefreshProfileが呼ばれていない");
  console.log("PASS: 通常会員がxを選択して参加成功すると、DB完了を待たずprofileが回答済み(x)になり、次回の表示判定もfalseになる");

  // ============================================================
  // テスト2: 過去に回答済み（x・既存answered_at）の通常会員が
  //          p_referral_source=nullで参加。RPC返却値はDBの保存済み値(x)。
  // ============================================================
  const existingAnsweredAt = "2026-01-01T00:00:00.000Z";
  useProfileStore.setState({ profile: makeProfile({ id: "user-1", referralSource: "x", referralSourceAnsweredAt: existingAnsweredAt }) });
  useLiveFollowerStore.setState({ live: makeLive("live-2"), myParticipant: null, error: null });
  const spy2 = installCountingRefreshProfileSpy();

  const p2 = useLiveFollowerStore.getState().joinLive("audience", null);
  resolvePendingRpc({ data: makeParticipant({ id: "participant-2", live_id: "live-2", referral_source: "x" }), error: null });
  await p2;

  const profileAfter2 = useProfileStore.getState().profile;
  assert.equal(profileAfter2?.referralSource, "x", "保存済み値(x)がローカルへ反映されていない");
  assert.equal(profileAfter2?.referralSourceAnsweredAt, existingAnsweredAt, "既存のanswered_atが不要に上書きされた");
  assert.equal(spy2.count(), 1, "引き継ぎのケースでもrefreshProfileは呼ばれるべき");
  console.log("PASS: 過去に回答済みの会員がnullで参加しても、DBが返したx（RPC返却値）で回答済み状態を維持する");

  // ============================================================
  // テスト3:「選択しない」で参加し、RPC返却値もnull（未回答のまま）。
  // ============================================================
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-3"), myParticipant: null, error: null });
  const spy3 = installCountingRefreshProfileSpy();

  const p3 = useLiveFollowerStore.getState().joinLive("audience", null);
  resolvePendingRpc({ data: makeParticipant({ id: "participant-3", live_id: "live-3", referral_source: null }), error: null });
  await p3;

  const profileAfter3 = useProfileStore.getState().profile;
  assert.equal(profileAfter3?.referralSource, null, "未回答なのにreferralSourceが設定された");
  assert.equal(profileAfter3?.referralSourceAnsweredAt, null, "未回答なのにreferralSourceAnsweredAtが設定された");
  assert.equal(spy3.count(), 1, "未回答でもrefreshProfile自体は呼ばれるべき");
  console.log("PASS: 「選択しない」で参加しRPC返却値もnullなら、referralSource/answeredAtとも未回答のまま（次回も回答可能）");

  // ============================================================
  // テスト4: ゲスト参加。ローカルprofileを回答済みにせず、
  //          refreshProfile・回答反映アクションのいずれも実行しない。
  // ============================================================
  setAuthUser("guest-1", true);
  const guestProfileBefore = makeProfile({ id: "guest-1", isGuest: true });
  useProfileStore.setState({ profile: guestProfileBefore });
  useLiveFollowerStore.setState({ live: makeLive("live-4"), myParticipant: null, error: null });
  const spy4 = installCountingRefreshProfileSpy();

  const p4 = useLiveFollowerStore.getState().joinLive("audience", "x");
  resolvePendingRpc({
    data: makeParticipant({ id: "participant-4", live_id: "live-4", user_id: "guest-1", is_guest: true, referral_source: null }),
    error: null,
  });
  await p4;

  assert.equal(spy4.count(), 0, "ゲストの参加成功でrefreshProfileが呼ばれてしまった");
  assert.deepEqual(useProfileStore.getState().profile, guestProfileBefore, "ゲストのローカルprofileが変更されてしまった");
  console.log("PASS: ゲストが参加成功しても、ローカルprofileは変更されずrefreshProfileも呼ばれない");

  // ============================================================
  // テスト5: refreshProfileが例外を投げても、参加処理は成功したまま。
  //          先に同期反映した回答済みローカル状態も維持される。
  // ============================================================
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-5"), myParticipant: null, error: null });
  useProfileStore.setState({
    refreshProfile: async () => {
      throw new Error("想定外のネットワークエラー");
    },
  });

  const p5 = useLiveFollowerStore.getState().joinLive("audience", "app");
  resolvePendingRpc({ data: makeParticipant({ id: "participant-5", live_id: "live-5", referral_source: "app" }), error: null });
  await assert.doesNotReject(() => p5, "refreshProfileの失敗でjoinLive自体がrejectされてしまった");
  // joinLive内部でrefreshProfileの拒否をcatchしているPromiseチェーンが
  // 完了するのを待つ（joinLive自体は既にresolve済みでも、内部のcatch()は
  // 別のマイクロタスクで走るため）。
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(useLiveFollowerStore.getState().myParticipant?.id, "participant-5", "refreshProfile失敗の影響で参加結果が反映されなかった");
  assert.equal(useLiveFollowerStore.getState().error, null, "refreshProfile失敗が参加自体のerrorに漏れてしまった");
  assert.equal(useProfileStore.getState().profile?.referralSource, "app", "refreshProfile失敗で、先に反映した回答済みローカル状態が消えた");
  console.log("PASS: refreshProfileが例外を投げても参加処理自体・先に反映した回答済み状態のどちらも維持される");

  // ============================================================
  // テスト6: ユーザーAのRPC待機中にユーザーBへ切り替える。
  // ============================================================
  setAuthUser("user-a", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-a" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-6"), myParticipant: null, error: null });
  const spy6 = installCountingRefreshProfileSpy();

  const p6 = useLiveFollowerStore.getState().joinLive("audience", "x");
  // Aの応答が返ってくる前に、Bへアカウントが切り替わる（Bのprofile・
  // participant状態を明確な別物にしておき、Aの結果で上書きされていないか
  // 確認できるようにする）。
  const profileBBefore = makeProfile({ id: "user-b", displayName: "会員B" });
  setAuthUser("user-b", false);
  useProfileStore.setState({ profile: profileBBefore });
  useLiveFollowerStore.setState({ myParticipant: null, error: null });

  resolvePendingRpc({ data: makeParticipant({ id: "participant-a", live_id: "live-6", user_id: "user-a", referral_source: "x" }), error: null });
  await p6;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(useLiveFollowerStore.getState().myParticipant, null, "Aの遅延結果がBの画面のmyParticipantへ設定されてしまった");
  assert.equal(useLiveFollowerStore.getState().error, null, "Aの結果でBのerrorが変化した");
  assert.deepEqual(useProfileStore.getState().profile, profileBBefore, "Aの遅延結果でBのprofileが変更されてしまった");
  assert.equal(spy6.count(), 0, "Aの遅延結果でB向けにrefreshProfileが誤って呼ばれた");
  console.log("PASS: ユーザーAのRPC待機中にBへ切り替えても、Aの遅延結果はBの画面へ一切反映されない");

  // ============================================================
  // テスト7: ライブAのRPC待機中にライブBへ切り替える（同一ユーザー）。
  // ============================================================
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-7a"), myParticipant: null, error: null });
  const spy7 = installCountingRefreshProfileSpy();

  const p7 = useLiveFollowerStore.getState().joinLive("audience", "x");
  const participantBSentinel = makeParticipant({ id: "participant-liveB-existing", live_id: "live-7b" });
  useLiveFollowerStore.setState({ live: makeLive("live-7b"), myParticipant: participantBSentinel, error: null });

  resolvePendingRpc({ data: makeParticipant({ id: "participant-liveA", live_id: "live-7a", referral_source: "x" }), error: null });
  await p7;
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(useLiveFollowerStore.getState().myParticipant, participantBSentinel, "ライブAの遅延結果がライブBのmyParticipantへ反映されてしまった");
  assert.equal(useLiveFollowerStore.getState().error, null, "ライブAの結果でライブBのerrorが変化した");
  assert.equal(spy7.count(), 0, "ライブ切り替え後にrefreshProfileが誤って呼ばれた");
  console.log("PASS: ライブAのRPC待機中にライブBへ切り替えても、ライブAの遅延結果はライブBの状態へ反映されない");

  // ============================================================
  // テスト8: RPCが返したparticipant.user_id/live_idが開始時の値と異なる
  //          （異常応答）場合はローカル状態へ反映しない。
  // ============================================================
  setAuthUser("user-1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "user-1" }) });
  useLiveFollowerStore.setState({ live: makeLive("live-8"), myParticipant: null, error: null });
  const spy8 = installCountingRefreshProfileSpy();

  const p8 = useLiveFollowerStore.getState().joinLive("audience", "x");
  // user_id/live_idのどちらも開始時と異なる、あり得ないはずの応答。
  resolvePendingRpc({
    data: makeParticipant({ id: "participant-bogus", live_id: "live-999", user_id: "user-999", referral_source: "x" }),
    error: null,
  });
  await p8;
  await Promise.resolve();

  assert.equal(useLiveFollowerStore.getState().myParticipant, null, "開始時と異なるuser_id/live_idのparticipantがmyParticipantへ設定されてしまった");
  assert.equal(useLiveFollowerStore.getState().error, null, "異常応答でerrorが変化した");
  assert.equal(spy8.count(), 0, "異常応答なのにrefreshProfileが呼ばれた");
  console.log("PASS: RPCが開始時と異なるuser_id/live_idのparticipantを返した場合、ローカル状態へ反映しない");

  assert.ok(rpcCallCount >= 8, "join_liveのRPCモック自体が呼ばれていない");
  assert.equal(pendingRpcs.length, 0, "解決し忘れたjoin_live呼び出しが残っている（テストの前提が崩れている）");

  console.log("ALL USE_LIVE_FOLLOWER_STORE_JOIN_REFERRAL CHECKS PASSED");
}

main();
