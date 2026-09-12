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
  // 2026-09-13（0070ゲスト参加レビュー対応）：Xログインボタンの連打で複数回
  // signInWithOAuth()を呼ばないようにするsingle-flightガード（signInAsGuestと同じ考え方）。
  xSigningIn: boolean;
  signInWithX: (
    options?: { isGuestSwitch?: boolean },
  ) => Promise<{ ok: true } | { ok: false; reason?: string }>;
  signInAsGuest: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  loading: true,
  guestSigningIn: false,
  xSigningIn: false,

  // 2026-09-13（0070ゲスト参加レビュー対応）：以前は「匿名セッションが有効なまま
  // signInWithOAuthを開始すると、同じauth.uid()のまま匿名ユーザーが本アカウントへ
  // 『アップグレード』される（＝ゲストのprofiles行がそのまま本アカウント化される）
  // ことがある」という懸念から、呼び出し元を問わず常にsignOut()してから
  // OAuthを開始していた。しかしこれだと、既にXログイン済みの利用者や
  // 未ログイン状態からの呼び出し（＝匿名セッションが存在しないケース）にも
  // 無意味なsignOut()が走ってしまう。
  // isGuestSwitch（呼び出し元が「現在ゲストからXログインへ切り替えようとしている」
  // ことを分かっている場合だけtrue）が指定された時だけ、切り替え前に確認ダイアログを
  // 挟んだ上でsignOut()する。ゲストでない呼び出し（通常のXログイン・admin/host
  // ログイン等）ではsignOut()を呼ばない。
  signInWithX: async (options) => {
    if (get().xSigningIn) return { ok: false, reason: "処理中です" };
    const isGuestSwitch = options?.isGuestSwitch ?? false;

    if (isGuestSwitch) {
      const confirmed = window.confirm(
        "ゲスト参加状態は終了し、今回の記録は引き継がれません。Xログインを開始しますか？",
      );
      if (!confirmed) return { ok: false };
    }

    set({ xSigningIn: true });
    try {
      if (isGuestSwitch) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          return { ok: false, reason: "ログインの切り替えに失敗しました。時間をおいて再度お試しください。" };
        }
      }

      const redirectTo = `${window.location.origin}${BASE_PATH}/auth/callback/`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "x",
        options: { redirectTo },
      });
      if (error) {
        return { ok: false, reason: "Xログインを開始できませんでした。時間をおいて再度お試しください。" };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "Xログインを開始できませんでした。時間をおいて再度お試しください。" };
    } finally {
      set({ xSigningIn: false });
    }
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
