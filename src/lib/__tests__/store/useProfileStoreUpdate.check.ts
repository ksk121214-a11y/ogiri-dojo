// useProfileStore.ts の updateDisplayName/updateAvatar/updateBio（2026-09-13、
// 0070ゲスト参加の再レビュー対応）を「本番と同じ実装のまま」呼び出して検証する
// スクリプト。実行方法はsrc/lib/__tests__/run.sh参照。
//
// 検証すること：
//   - ゲスト（authUser.is_anonymous=true）は拒否され、DBへリクエストしない。
//   - authUser.idとprofile.idが不一致（前の利用者のprofileが残っている想定）
//     の場合も拒否され、DBへリクエストしない。
//   - RLS等により実際には0件しか更新されなかった場合（.select().single()が
//     data:nullを返す想定）、成功扱いにせずローカル状態も変更しない。
//   - 失敗時は生のDBエラーを含まない固定の日本語文言を返す。
//   - 成功時はDBが実際に返した値でローカル状態を更新する。
//   - 2026-09-13（再々レビュー対応）：Supabase待機中にA→Bへ切り替わった場合、
//     Aの更新結果を現在のBのローカルstateへ反映しない（refreshProfileも同様）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

type FromResponse = { data: Record<string, unknown> | null; error: { message: string } | null };
let nextResponse: FromResponse = { data: null, error: null };
let fromCallCount = 0;
let lastUpdatePayload: unknown = null;

// 2026-09-13（再々レビュー対応）：「Supabase待機中にA→Bへ切り替わる」競合を再現する
// ための保留機構。armDeferredResponse()を呼んだ後の.single()呼び出しは、
// resolveDeferred(...)を明示的に呼ぶまで解決しない。
let deferredMode = false;
let pendingResolvers: Array<(r: FromResponse) => void> = [];
function armDeferredResponse() {
  deferredMode = true;
}
function resolveDeferred(response: FromResponse) {
  deferredMode = false;
  const resolvers = pendingResolvers;
  pendingResolvers = [];
  resolvers.forEach((r) => r(response));
}

(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  assert.equal(table, "profiles");
  fromCallCount += 1;
  const chain = {
    update: (payload: unknown) => {
      lastUpdatePayload = payload;
      return chain;
    },
    eq: () => chain,
    select: () => chain,
    single: async () => {
      if (deferredMode) {
        return await new Promise<FromResponse>((resolve) => pendingResolvers.push(resolve));
      }
      return nextResponse;
    },
  };
  return chain;
};

function makeProfile(overrides: Partial<ReturnType<typeof useProfileStore.getState>["profile"]> = {}) {
  return {
    id: "u1",
    displayName: "もとの名前",
    displayNameSet: true,
    xUsername: null,
    avatarUrl: null,
    isHost: false,
    avatarIcon: "default",
    avatarColor: "#c8320c",
    isGuest: false,
    bio: "もとのbio",
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
    ...overrides,
  };
}

function setAuthUser(id: string | null, isAnonymous = false) {
  useAuthStore.setState({
    user: id ? ({ id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
    loading: false,
  });
}

async function main() {
  // ---- テスト1: 未ログイン（profile自体が無い）は拒否され、DBへリクエストしない。----
  setAuthUser(null);
  useProfileStore.setState({ profile: null, loading: false });
  fromCallCount = 0;
  const r1 = await useProfileStore.getState().updateDisplayName("新しい名前");
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.reason, "ログインしていません");
  assert.equal(fromCallCount, 0, "未ログインなのにsupabase.fromが呼ばれた");
  console.log("PASS: 未ログインはupdateDisplayNameを拒否し、DBへリクエストしない");

  // ---- テスト2: ゲスト（authUser.is_anonymous=true）は拒否され、DBへリクエストしない。----
  setAuthUser("guest-1", true);
  useProfileStore.setState({ profile: makeProfile({ id: "guest-1", isGuest: false }), loading: false });
  fromCallCount = 0;
  const r2 = await useProfileStore.getState().updateDisplayName("ゲストの新しい名前");
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, "ゲストはプロフィールを変更できません");
  assert.equal(fromCallCount, 0, "ゲストなのにsupabase.fromが呼ばれた（authUser.is_anonymousだけでprofile.isGuestがfalseの組み合わせでも弾けていない）");
  console.log("PASS: authUser.is_anonymous=true（profile.isGuest=falseでも）はupdateDisplayNameを拒否し、DBへリクエストしない");

  // ---- テスト3: authUser.idとprofile.idが不一致（前の利用者のprofileが残っている
  //      想定）の場合も拒否され、DBへリクエストしない。----
  setAuthUser("userB", false);
  useProfileStore.setState({ profile: makeProfile({ id: "userA-stale" }), loading: false });
  fromCallCount = 0;
  const r3 = await useProfileStore.getState().updateAvatar("cat", "#ff0000");
  assert.equal(r3.ok, false, "authUserとprofileのid不一致なのにupdateAvatarが成功してしまった");
  assert.equal(fromCallCount, 0, "id不一致なのにsupabase.fromが呼ばれた");
  console.log("PASS: authUser.idとprofile.idが不一致な間はupdateAvatarを拒否し、DBへリクエストしない");

  // ---- テスト4: RLS等で実際には0件しか更新されなかった場合
  //      （.select().single()がdata:nullを返す）、成功扱いにせずローカル状態も
  //      変更しない。----
  setAuthUser("u1", false);
  useProfileStore.setState({ profile: makeProfile(), loading: false });
  nextResponse = { data: null, error: { message: 'PGRST116: JSON object requested, multiple (or no) rows returned' } };
  fromCallCount = 0;
  const r4 = await useProfileStore.getState().updateBio("新しいbio");
  assert.equal(r4.ok, false, "0件更新（RLSで弾かれた）のに成功扱いになってしまった");
  if (!r4.ok) {
    assert.ok(!r4.reason.includes("PGRST116"), "生のPostgRESTエラーがそのまま理由に含まれている");
    assert.equal(r4.reason, "更新に失敗しました。時間をおいて再度お試しください");
  }
  assert.equal(useProfileStore.getState().profile?.bio, "もとのbio", "0件更新なのにローカル状態のbioが書き換わってしまった");
  console.log("PASS: RLSで0件しか更新されなかった場合、成功扱いにせずローカル状態も変更しない（生のエラーも出さない）");

  // ---- テスト5: 正常系。DBが実際に返した値でローカル状態を更新する。----
  nextResponse = { data: { bio: "DBが返した新しいbio" }, error: null };
  const r5 = await useProfileStore.getState().updateBio("新しいbio");
  assert.equal(r5.ok, true);
  assert.equal(useProfileStore.getState().profile?.bio, "DBが返した新しいbio", "DBが実際に返した値でローカル状態が更新されていない");
  assert.deepEqual(lastUpdatePayload, { bio: "新しいbio" });
  console.log("PASS: 正常系ではDBが実際に返した値でローカル状態を更新する");

  // ---- テスト6（再々レビュー対応）：updateBio実行中（Supabase待機中）にA→Bへ
  //      切り替わった場合、Aの更新結果を現在のBのローカルstateへ反映しない。----
  setAuthUser("u1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "u1", bio: "Aのもとのbio" }), loading: false });
  armDeferredResponse();
  const updatePromiseA = useProfileStore.getState().updateBio("Aが入力した新しいbio");
  // ここまでの時点でupdateBioは.single()の内部await（保留中Promise）で止まっている
  // はず（guardOwnProfileUpdateはSupabase呼び出し前の同期チェックのため、この時点では
  // まだ"u1"を本人としてガードを通過済み）。この状態のままB（あるいはゲスト）へ
  // 切り替える。
  setAuthUser("userB", false);
  useProfileStore.setState({ profile: makeProfile({ id: "userB", displayName: "Bの名前", bio: "Bのもとのbio" }), loading: false });
  // Aの更新が遅れてDBから成功結果を受け取る。
  resolveDeferred({ data: { bio: "DBに保存されたAのbio" }, error: null });
  const resultA = await updatePromiseA;
  assert.equal(resultA.ok, false, "await中にA→Bへ切り替わったのに、Aの更新が成功扱いになってしまった");
  if (!resultA.ok) {
    assert.equal(
      resultA.reason,
      "アカウントが切り替わったため、この操作は反映されませんでした",
      "アカウント切り替え時の理由文言が想定と違う",
    );
  }
  assert.equal(useProfileStore.getState().profile?.id, "userB", "Bのprofileのままであるべきなのに変わっている");
  assert.equal(
    useProfileStore.getState().profile?.bio,
    "Bのもとのbio",
    "await中に切り替わったAの更新結果がBのbioへ反映されてしまっている（アカウント取り違え）",
  );
  console.log("PASS: updateBio実行中にA→Bへ切り替わった場合、Aの更新結果は現在のBのローカルstateへ反映されない");

  // ---- テスト7（再々レビュー対応）：refreshProfile実行中にA→Bへ切り替わった場合も
  //      同様に、遅れて届いたAの取得結果をBのローカルstateへ反映しない。----
  setAuthUser("u1", false);
  useProfileStore.setState({ profile: makeProfile({ id: "u1", displayName: "Aの名前" }), loading: false });
  armDeferredResponse();
  const refreshPromiseA = useProfileStore.getState().refreshProfile();
  setAuthUser("userB", false);
  useProfileStore.setState({ profile: makeProfile({ id: "userB", displayName: "Bの名前" }), loading: false });
  resolveDeferred({
    data: {
      id: "u1",
      display_name: "Aの名前（DBから遅れて届いた）",
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
  });
  await refreshPromiseA;
  assert.equal(useProfileStore.getState().profile?.id, "userB", "refreshProfile競合後もBのprofileのままであるべき");
  assert.equal(
    useProfileStore.getState().profile?.displayName,
    "Bの名前",
    "await中に切り替わったAのrefreshProfile結果がBの表示名を上書きしてしまっている",
  );
  console.log("PASS: refreshProfile実行中にA→Bへ切り替わった場合も、遅れて届いたAの取得結果はBのローカルstateへ反映されない");

  console.log("ALL USE_PROFILE_STORE_UPDATE CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
