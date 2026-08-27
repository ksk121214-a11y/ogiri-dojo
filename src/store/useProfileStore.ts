// Supabaseの public.profiles と連携するストア。
// useAuthStore(ログイン状態)の変化を購読し、ログイン中ユーザーのプロフィールを取得・更新する。
import { create } from "zustand";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useUserStore } from "@/store/useUserStore";

export interface DojoProfile {
  id: string;
  displayName: string;
  displayNameSet: boolean;
  xUsername: string | null;
  avatarUrl: string | null;
  isHost: boolean;
}

interface ProfileState {
  profile: DojoProfile | null;
  loading: boolean;
  updateDisplayName: (
    name: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

function toDojoProfile(row: {
  id: string;
  display_name: string;
  display_name_set: boolean;
  x_username: string | null;
  avatar_url: string | null;
  is_host: boolean;
}): DojoProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    displayNameSet: row.display_name_set,
    xUsername: row.x_username,
    avatarUrl: row.avatar_url,
    isHost: row.is_host,
  };
}

async function fetchProfile(userId: string): Promise<DojoProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, display_name_set, x_username, avatar_url, is_host")
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
      if (profile) {
        useUserStore.setState((s) => ({ user: { ...s.user, displayName: profile.displayName } }));
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
