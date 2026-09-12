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
  // 2026-09-12（ゲスト参加）：ゲストとして参加ボタンの連打で複数回
  // signInAnonymously()を呼ばないようにするsingle-flightガード。
  guestSigningIn: boolean;
  signInWithX: () => Promise<void>;
  signInAsGuest: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  loading: true,
  guestSigningIn: false,

  signInWithX: async () => {
    // 匿名セッションが有効なままsignInWithOAuthを開始すると、Supabase Authの
    // 実装によっては同じauth.uid()のまま匿名ユーザーが本アカウントへ
    // 「アップグレード」される（＝ゲストのprofiles行がそのまま本アカウント化
    // される）ことがある。「ゲストのポイントを後付けしない」という要件と
    // 衝突するため、必ず一度signOut()してからOAuthを開始し、匿名セッションとの
    // 暗黙のリンクを起こさないようにする（Xログインは常に無関係な新規/別アカウント
    // として扱う）。
    await supabase.auth.signOut();
    const redirectTo = `${window.location.origin}${BASE_PATH}/auth/callback/`;
    await supabase.auth.signInWithOAuth({
      provider: "x",
      options: { redirectTo },
    });
  },

  signInAsGuest: async () => {
    if (get().guestSigningIn) return { ok: false, reason: "処理中です" };
    set({ guestSigningIn: true });
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        return { ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" };
    } finally {
      set({ guestSigningIn: false });
    }
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
