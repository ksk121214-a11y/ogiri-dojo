// Supabase Auth(X/Twitter OAuth)のログイン状態を管理するストア。
// useUserStore(ダミーの演者データ)とは独立させ、実ログイン基盤の導入だけをまず切り出す。
import type { Session, User } from "@supabase/supabase-js";
import { create } from "zustand";

import { BASE_PATH } from "@/lib/basePath";
import { supabase } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithX: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(() => ({
  session: null,
  user: null,
  loading: true,

  signInWithX: async () => {
    const redirectTo = `${window.location.origin}${BASE_PATH}/auth/callback/`;
    await supabase.auth.signInWithOAuth({
      provider: "x",
      options: { redirectTo },
    });
  },

  signOut: async () => {
    await supabase.auth.signOut();
  },
}));

// クライアントでのみ購読する(静的エクスポートのビルド時にwindow/Supabaseの認証状態へアクセスしないため)。
if (typeof window !== "undefined") {
  supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({
      session: data.session,
      user: data.session?.user ?? null,
      loading: false,
    });
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({
      session,
      user: session?.user ?? null,
      loading: false,
    });
  });
}
