// Supabaseの public.profiles と連携するストア。
// useAuthStore(ログイン状態)の変化を購読し、ログイン中ユーザーのプロフィールを取得・更新する。
import { create } from "zustand";

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
  };
}

async function fetchProfile(userId: string): Promise<DojoProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, display_name_set, x_username, avatar_url, role, avatar_icon, avatar_color, bio, mastery_meter, total_points, points_balance, live_count, award_count_first, award_count_second, award_count_third, best_answer_count, tickets_count, tickets_next_recovery_at",
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
    const userId = get().profile?.id;
    if (!userId) return { ok: false, reason: "ログインしていません" };
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, reason: "名前を入力してください" };
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return { ok: false, reason: `名前は${DISPLAY_NAME_MAX_LENGTH}文字以内にしてください` };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed, display_name_set: true })
      .eq("id", userId);
    if (error) return { ok: false, reason: error.message };

    set((s) =>
      s.profile
        ? { profile: { ...s.profile, displayName: trimmed, displayNameSet: true } }
        : s,
    );
    // ranking/寄合帳など、まだuseProfileStoreを直接見ていない箇所とも名前がズレないよう、
    // ダミーのuseUserStore側にも同じ名前を反映しておく。
    useUserStore.setState((s) => ({ user: { ...s.user, displayName: trimmed } }));
    return { ok: true };
  },

  updateAvatar: async (icon, color) => {
    const userId = get().profile?.id;
    if (!userId) return { ok: false, reason: "ログインしていません" };

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_icon: icon, avatar_color: color })
      .eq("id", userId);
    if (error) return { ok: false, reason: error.message };

    set((s) => (s.profile ? { profile: { ...s.profile, avatarIcon: icon, avatarColor: color } } : s));
    return { ok: true };
  },

  updateBio: async (bio) => {
    const userId = get().profile?.id;
    if (!userId) return { ok: false, reason: "ログインしていません" };

    const { error } = await supabase.from("profiles").update({ bio }).eq("id", userId);
    if (error) return { ok: false, reason: error.message };

    set((s) => (s.profile ? { profile: { ...s.profile, bio } } : s));
    return { ok: true };
  },

  refreshProfile: async () => {
    const userId = get().profile?.id;
    if (!userId) return;
    const profile = await fetchProfile(userId);
    if (profile) set({ profile });
  },
}));

if (typeof window !== "undefined") {
  const loadForUser = (userId: string | null) => {
    if (!userId) {
      useProfileStore.setState({ profile: null, loading: false });
      return;
    }
    useProfileStore.setState({ loading: true });
    fetchProfile(userId).then((profile) => {
      useProfileStore.setState({ profile, loading: false });
      if (!profile) return;
      useUserStore.setState((s) => ({ user: { ...s.user, displayName: profile.displayName } }));

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
