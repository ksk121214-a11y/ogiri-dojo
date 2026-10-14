// Supabaseの public.profiles と連携するストア。
// useAuthStore(ログイン状態)の変化を購読し、ログイン中ユーザーのプロフィールを取得・更新する。
import { create } from "zustand";

import { isGuestUser } from "@/lib/guestStatus";
import { isStoredReferralSourceValue } from "@/lib/referralSurveySummary";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useUserStore } from "@/store/useUserStore";

export const DISPLAY_NAME_MAX_LENGTH = 10;

export interface DojoProfile {
  id: string;
  displayName: string;
  displayNameSet: boolean;
  xUsername: string | null;
  avatarUrl: string | null;
  isHost: boolean;
  // 2026-08-29: マイページで選ぶアイコンの絵柄・色（src/lib/avatarIcons.ts・
  // avatarColors.tsのプリセットid/hex）。他の参加者にライブ中も自分の見た目が
  // 正しく伝わるよう、useUserStore（ローカルのみ）ではなくprofilesに保存する。
  avatarIcon: string;
  avatarColor: string;
  // 2026-09-12（ゲスト参加）：profiles.is_guestをそのまま反映する。ゲストは
  // 名前設定モーダルを出さない・プロフィール編集UIを無効化する等の判定に使う
  // （DB側のRLS/RPCが最終防御。ここはUI層の分かりやすさのための表示用）。
  isGuest: boolean;
  // 2026-08-31（段位・ポイント・実績の実データ化）：一言コメントと、ライブ終了時に
  // apply_live_rank_rewards()（security definer関数）が加算する各種実績値。
  // これらはクライアントから直接updateできない列（bioのみ本人が自由に編集可）。
  bio: string;
  masteryMeter: number;
  totalPoints: number;
  pointsBalance: number;
  liveCount: number;
  awardCountFirst: number;
  awardCountSecond: number;
  awardCountThird: number;
  bestAnswerCount: number;
  // 2026-09-02（寄合券のサーバー管理化）：これまでuseTicketStore.ts（localStorageのみ）
  // で管理していた寄合券の残数・次回回復時刻を、サーバー側の実データに一本化した。
  ticketsCount: number;
  ticketsNextRecoveryAt: string | null;
  // 2026-09-22追加（流入アンケートの1アカウント1回化）：nullなら未回答（今回も
  // アンケートを表示してよい）、値が入っていれば回答済み（以後は表示しない）。
  // 直接updateする手段は無く、join_live（SECURITY DEFINER）が最初の1回だけ書く。
  referralSource: string | null;
  referralSourceAnsweredAt: string | null;
  // 2026-09-27（称号・初期ライブ限定特典）：装備中の称号(titles.slug)・限定アイコン
  // (現状'first-witness'のみ)。どちらも直接updateはできない列（set_equipped_title/
  // set_equipped_limited_iconというSECURITY DEFINER RPC経由のみ、supabase/migrations/
  // 0081参照）。未選択はnull。
  equippedTitleSlug: string | null;
  equippedLimitedIconSlug: string | null;
}

interface ProfileState {
  profile: DojoProfile | null;
  loading: boolean;
  updateDisplayName: (
    name: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  updateAvatar: (
    icon: string,
    color: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  updateBio: (bio: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  // 2026-09-02: 寄合券の消費（submit_sns_topic/submit_sns_answer）等、他のRPCが
  // profilesを更新した後にクライアント側の表示を最新化するための汎用リフレッシュ。
  refreshProfile: () => Promise<void>;
  // 2026-09-22（レビュー対応・問題2）：join_live成功時にDB側で確定した
  // effective_referral_source（ParticipantRow.referral_source）を、DBへの
  // 追加UPDATEなしでローカルprofileへ即座に反映する。refreshProfileの完了を
  // 待たずに「回答済み」表示へ切り替えられるようにするための専用アクション。
  applyReferralAnswerFromJoin: (userId: string, referralSource: string) => void;
  // 2026-09-27（称号・初期ライブ限定特典）：装備の変更はset_equipped_title/
  // set_equipped_limited_icon（SECURITY DEFINER、所有権をDB内で検証）経由のみ。
  // nullを渡すと解除する。
  setEquippedTitle: (titleSlug: string | null) => Promise<{ ok: true } | { ok: false; reason: string }>;
  setEquippedLimitedIcon: (iconSlug: string | null) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

function toDojoProfile(row: {
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
  referral_source: string | null;
  referral_source_answered_at: string | null;
  equipped_title_slug: string | null;
  equipped_limited_icon_slug: string | null;
}): DojoProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    displayNameSet: row.display_name_set,
    xUsername: row.x_username,
    avatarUrl: row.avatar_url,
    // 2026-08-30: 運営者専用管理画面の追加に伴い、判定の正はis_host列(boolean)から
    // role列(text、'user'|'admin')に移した（is_host()というDB関数名・
    // DojoProfile.isHostというフロントのフィールド名は既存呼び出し箇所を
    // 壊さないためそのまま維持し、中身の判定元だけ差し替える）。
    isHost: row.role === "admin",
    avatarIcon: row.avatar_icon,
    avatarColor: row.avatar_color,
    bio: row.bio ?? "",
    masteryMeter: row.mastery_meter,
    totalPoints: row.total_points,
    pointsBalance: row.points_balance,
    liveCount: row.live_count,
    awardCountFirst: row.award_count_first,
    awardCountSecond: row.award_count_second,
    awardCountThird: row.award_count_third,
    bestAnswerCount: row.best_answer_count,
    ticketsCount: row.tickets_count,
    ticketsNextRecoveryAt: row.tickets_next_recovery_at,
    isGuest: row.is_guest,
    referralSource: row.referral_source,
    referralSourceAnsweredAt: row.referral_source_answered_at,
    equippedTitleSlug: row.equipped_title_slug,
    equippedLimitedIconSlug: row.equipped_limited_icon_slug,
  };
}

// 2026-09-22追加：join_live側のCHECK制約と同じ値域。2026-10-14（0090）以降は
// DBに保存され得る値（旧選択肢appを含む）で判定する。ここで受け取るのは
// クライアントの選択値ではなくjoin_liveがDB側で確定した値のため、過去にapp
// と回答済みの会員の値も正しく反映できる必要がある。

const PROFILE_UPDATE_GENERIC_ERROR = "更新に失敗しました。時間をおいて再度お試しください";
// 2026-09-13（再々レビュー対応）：Supabase待機中にA→Bへ切り替わっていた場合、
// Aの更新結果を現在のB（あるいはゲスト）のローカルstateへ反映しない。DB自体には
// 既にAの行として正しく保存されている（guard.userIdはawait開始時点で固定した
// 本人のidのため、書き込み先自体は誤らない）ため、これは「表示のすり替わり」を
// 防ぐためだけの追加ガードであり、生のDBエラーではない専用の文言にする。
const PROFILE_UPDATE_STALE_ACCOUNT_ERROR = "アカウントが切り替わったため、この操作は反映されませんでした";

// updateDisplayName/updateAvatar/updateBio共通の事前チェック。
// 2026-09-13（再レビュー対応）：
// - ゲスト判定はauthUser.is_anonymousも併せて見る共通関数（src/lib/guestStatus.ts）を使う
//   （profile.isGuestだけでは、ここに来る前にprofileが古い利用者のまま一瞬残っていた
//   場合に判定を誤りうるため）。
// - authUser.idとprofile.idが一致することも必須にする。ログイン切り替え直後、
//   useProfileStoreのprofileがまだ前の利用者のものである間にこれらのアクションが
//   呼ばれても、他人のprofiles行を書き換えてしまわないようにする最後の砦。
function guardOwnProfileUpdate(): { ok: true; userId: string } | { ok: false; reason: string } {
  const authUser = useAuthStore.getState().user;
  const profile = useProfileStore.getState().profile;
  if (!authUser || !profile) return { ok: false, reason: "ログインしていません" };
  if (isGuestUser(authUser, profile)) return { ok: false, reason: "ゲストはプロフィールを変更できません" };
  if (authUser.id !== profile.id) return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
  return { ok: true, userId: profile.id };
}

// 2026-09-13（再々レビュー対応）：updateDisplayName/updateAvatar/updateBioが
// Supabase待機中（await中）にA→Bへ切り替わっていないかを、await後にも確認する
// ためのヘルパー。guardOwnProfileUpdateは開始時点の確認のみのため、これと
// 組み合わせて使う（開始時・完了時の両方で本人確認する多層防御）。
function isStillSameOwner(startedForUserId: string): boolean {
  return (
    useAuthStore.getState().user?.id === startedForUserId &&
    useProfileStore.getState().profile?.id === startedForUserId
  );
}

async function fetchProfile(userId: string): Promise<DojoProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, display_name_set, x_username, avatar_url, role, avatar_icon, avatar_color, bio, mastery_meter, total_points, points_balance, live_count, award_count_first, award_count_second, award_count_third, best_answer_count, tickets_count, tickets_next_recovery_at, is_guest, referral_source, referral_source_answered_at, equipped_title_slug, equipped_limited_icon_slug",
    )
    .eq("id", userId)
    .single();
  if (error || !data) return null;
  return toDojoProfile(data);
}

export const useProfileStore = create<ProfileState>()((set, get) => ({
  profile: null,
  loading: true,

  updateDisplayName: async (name) => {
    const guard = guardOwnProfileUpdate();
    if (!guard.ok) return guard;
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: "名前を入力してください" };
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return { ok: false, reason: `名前は${DISPLAY_NAME_MAX_LENGTH}文字以内にしてください` };
    }

    // 2026-09-13（再レビュー対応）：RLS（profiles_update_own）が対象行を1件も
    // 更新しなかった場合（本人以外の行を指してしまった・その間にゲスト化された等）、
    // 従来はerrorがnullのまま「0件更新」を成功扱いにしてしまっていた。
    // .select().single()で実際に更新された行を取得できた場合にのみ成功とし、
    // 生のDB/Supabaseエラーはローカル状態にもUIにも一切出さない。
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed, display_name_set: true })
      .eq("id", guard.userId)
      .select("display_name, display_name_set")
      .single();
    if (error || !data) return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
    // 2026-09-13（再々レビュー対応）：await中にA→Bへ切り替わっていたら、Aの
    // 更新結果を現在のB（あるいはゲスト）のprofile/useUserStoreへ反映しない。
    if (!isStillSameOwner(guard.userId)) return { ok: false, reason: PROFILE_UPDATE_STALE_ACCOUNT_ERROR };

    set((s) =>
      s.profile
        ? { profile: { ...s.profile, displayName: data.display_name, displayNameSet: data.display_name_set } }
        : s,
    );
    // ranking/寄合帳など、まだuseProfileStoreを直接見ていない箇所とも名前がズレないよう、
    // ダミーのuseUserStore側にも同じ名前を反映しておく。
    useUserStore.setState((s) => ({ user: { ...s.user, displayName: data.display_name } }));
    return { ok: true };
  },

  updateAvatar: async (icon, color) => {
    const guard = guardOwnProfileUpdate();
    if (!guard.ok) return guard;

    const { data, error } = await supabase
      .from("profiles")
      .update({ avatar_icon: icon, avatar_color: color })
      .eq("id", guard.userId)
      .select("avatar_icon, avatar_color")
      .single();
    if (error || !data) return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
    if (!isStillSameOwner(guard.userId)) return { ok: false, reason: PROFILE_UPDATE_STALE_ACCOUNT_ERROR };

    set((s) =>
      s.profile ? { profile: { ...s.profile, avatarIcon: data.avatar_icon, avatarColor: data.avatar_color } } : s,
    );
    return { ok: true };
  },

  updateBio: async (bio) => {
    const guard = guardOwnProfileUpdate();
    if (!guard.ok) return guard;

    const { data, error } = await supabase
      .from("profiles")
      .update({ bio })
      .eq("id", guard.userId)
      .select("bio")
      .single();
    if (error || !data) return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
    if (!isStillSameOwner(guard.userId)) return { ok: false, reason: PROFILE_UPDATE_STALE_ACCOUNT_ERROR };

    set((s) => (s.profile ? { profile: { ...s.profile, bio: data.bio } } : s));
    return { ok: true };
  },

  refreshProfile: async () => {
    const userId = get().profile?.id;
    if (!userId) return;
    const profile = await fetchProfile(userId);
    if (!profile) return;
    // 2026-09-13（再々レビュー対応）：取得中に別ユーザーへ切り替わっていたら、
    // 遅れて届いたこの結果（古い利用者のprofile）を反映しない
    // （loadForUserの世代ガードと同じ考え方）。
    if (!isStillSameOwner(userId)) return;
    set({ profile });
  },

  // 2026-09-22（レビュー対応・問題2）：join_live成功直後、DBが返した
  // effective_referral_source（クライアント値ではなくDB側で確定した値）を
  // 使ってローカルprofileを回答済み状態へ更新する。DBへの書き込みは行わない
  // （join_liveが既にDBで完了済みの結果をローカルへ反映するだけ）。
  // 呼び出し元（useLiveFollowerStore.joinLive）がアカウント切り替えの世代
  // ガードを行っていても、ここでも独立して本人確認・ゲスト確認・値の検証を
  // 行う（他の場所から呼ばれても安全な自己完結型のアクションにするため）。
  applyReferralAnswerFromJoin: (userId, referralSource) => {
    const authUser = useAuthStore.getState().user;
    const profile = get().profile;
    if (!authUser || authUser.id !== userId) return;
    if (!profile || profile.id !== userId) return;
    if (isGuestUser(authUser, profile)) return;
    if (!isStoredReferralSourceValue(referralSource)) return;

    set((s) =>
      s.profile
        ? {
            profile: {
              ...s.profile,
              referralSource,
              // 既にDBから取得済みの正式なanswered_atがあればそれを維持し、
              // まだ無ければ暫定的に現在時刻を入れる（後続のrefreshProfileが
              // 完了すればDBの正式な値へ置き換わる）。
              referralSourceAnsweredAt: s.profile.referralSourceAnsweredAt ?? new Date().toISOString(),
            },
          }
        : s,
    );
  },

  setEquippedTitle: async (titleSlug) => {
    const guard = guardOwnProfileUpdate();
    if (!guard.ok) return guard;

    const { error } = await supabase.rpc("set_equipped_title", { p_title_slug: titleSlug });
    if (error) {
      if (error.message.includes("TITLE_NOT_OWNED") || error.message.includes("TITLE_NOT_FOUND") || error.message.includes("TITLE_NOT_ACTIVE")) {
        return { ok: false, reason: "この称号は選択できません" };
      }
      if (error.message.includes("NOT_X_LOGIN")) {
        return { ok: false, reason: "この操作はXログイン会員のみご利用いただけます" };
      }
      return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
    }
    if (!isStillSameOwner(guard.userId)) return { ok: false, reason: PROFILE_UPDATE_STALE_ACCOUNT_ERROR };

    set((s) => (s.profile ? { profile: { ...s.profile, equippedTitleSlug: titleSlug } } : s));
    return { ok: true };
  },

  setEquippedLimitedIcon: async (iconSlug) => {
    const guard = guardOwnProfileUpdate();
    if (!guard.ok) return guard;

    const { error } = await supabase.rpc("set_equipped_limited_icon", { p_icon_slug: iconSlug });
    if (error) {
      if (error.message.includes("ICON_NOT_OWNED")) {
        return { ok: false, reason: "この限定アイコンは選択できません" };
      }
      if (error.message.includes("NOT_X_LOGIN")) {
        return { ok: false, reason: "この操作はXログイン会員のみご利用いただけます" };
      }
      return { ok: false, reason: PROFILE_UPDATE_GENERIC_ERROR };
    }
    if (!isStillSameOwner(guard.userId)) return { ok: false, reason: PROFILE_UPDATE_STALE_ACCOUNT_ERROR };

    set((s) => (s.profile ? { profile: { ...s.profile, equippedLimitedIconSlug: iconSlug } } : s));
    useUserStore.setState((s) => ({ user: { ...s.user, equippedLimitedIconSlug: iconSlug } }));
    return { ok: true };
  },
}));

if (typeof window !== "undefined") {
  const loadForUser = (userId: string | null) => {
    // 2026-09-13（再レビュー対応）：別のuserId（ログイン切り替え・ゲストへの
    // 切り替え・ログアウト）を読み込み始める時点で、古いprofileを即座にnullへ
    // 戻す。fetchProfile()の完了を待つ間、前の利用者のprofile（名前・ポイント・
    // 段位・寄合券等）がそのまま残り続け、別アカウントやゲストへ切り替えた
    // 直後に一瞬（取得が遅ければもっと長く）他人の情報が見えてしまっていた問題
    // への対応。isConfirmedMember側のid一致チェックと合わせた多層防御。
    useProfileStore.setState({ profile: null, loading: !!userId });
    if (!userId) return;
    fetchProfile(userId).then((profile) => {
      // 2026-09-13（再レビュー対応）：fetchProfile実行中にさらに別のuserIdへ
      // 切り替わっていた場合（連続切り替え・素早い連打）、遅れて届いたこの結果を
      // 反映しない（新しい方の切り替えを、古い方の取得結果で上書きしない）。
      if (useAuthStore.getState().user?.id !== userId) return;
      useProfileStore.setState({ profile, loading: false });
      if (!profile) return;
      useUserStore.setState((s) => ({
        user: { ...s.user, displayName: profile.displayName, equippedLimitedIconSlug: profile.equippedLimitedIconSlug },
      }));

      // 2026-08-29: avatar_icon/avatar_colorをprofilesに追加する前から、この端末の
      // useUserStore（localStorage）に既にアイコン設定を持っているユーザーがいる。
      // 何もしないとprofiles側の初期値（"default"）で上書きされ、既存の見た目が
      // リセットされてしまうため、profiles側がまだ初期値のままで、かつローカル側に
      // それと異なる設定があれば、ローカルの設定を一度だけSupabaseへ移行する
      // （以降はSupabase側が正の情報源になり、他の参加者からも正しく見える）。
      const localUser = useUserStore.getState().user;
      const isProfileAvatarDefault = profile.avatarIcon === "default" && profile.avatarColor === "#c8320c";
      const isLocalAvatarCustomized =
        localUser.avatarIcon !== "default" || localUser.avatarColor !== "#c8320c";
      if (isProfileAvatarDefault && isLocalAvatarCustomized) {
        useProfileStore.getState().updateAvatar(localUser.avatarIcon, localUser.avatarColor);
      } else {
        useUserStore.setState((s) => ({
          user: { ...s.user, avatarIcon: profile.avatarIcon, avatarColor: profile.avatarColor },
        }));
      }
    });
  };

  loadForUser(useAuthStore.getState().user?.id ?? null);

  useAuthStore.subscribe((state, prevState) => {
    const userId = state.user?.id ?? null;
    const prevUserId = prevState.user?.id ?? null;
    if (userId === prevUserId) return;
    loadForUser(userId);
  });
}
