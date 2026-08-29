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
}

function toDojoProfile(row: {
  id: string;
  display_name: string;
  display_name_set: boolean;
  x_username: string | null;
  avatar_url: string | null;
  is_host: boolean;
  avatar_icon: string;
  avatar_color: string;
}): DojoProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    displayNameSet: row.display_name_set,
    xUsername: row.x_username,
    avatarUrl: row.avatar_url,
    isHost: row.is_host,
    avatarIcon: row.avatar_icon,
    avatarColor: row.avatar_color,
  };
}

async function fetchProfile(userId: string): Promise<DojoProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, display_name_set, x_username, avatar_url, is_host, avatar_icon, avatar_color")
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
