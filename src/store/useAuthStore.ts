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
  // userId：signInAnonymouslyの結果から確定したゲストのuser id（useAuthStoreへの反映より先に
  // 返る）。同意記録など、確定したuserIdが必要な処理がこれを使う。
  signInAsGuest: () => Promise<{ ok: true; userId?: string | null } | { ok: false; reason: string }>;
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
  // OAuthを開始していた。
  // 2026-09-27（ゲスト番号増殖バグの修正）：上記のsignOut()は、OAuth開始前
  // （＝ログインが成功するかどうかまだ分からない時点）で匿名セッションを消していた。
  // X側でログインをキャンセルする・callbackでエラーになる・ブラウザで戻る、
  // いずれの場合もこのsignOut()は既に実行済みのため、元の匿名ユーザー（ゲスト01）の
  // セッションが失われ、次にゲスト参加すると新しい匿名ユーザー（ゲスト02…）が
  // 作られてしまっていた。
  // このプロジェクトのsupabase-js（src/lib/supabase.ts）はflowTypeを指定しておらず、
  // 使用中のバージョン(2.110.2)の既定であるimplicitフローを使っている（PKCEではない）。
  // signInWithOAuthによるリダイレクトが成功してcallbackへ戻ってきた場合、
  // access_token/refresh_tokenはURLのフラグメントで返る。セッションの確立は
  // /auth/callbackページが明示的に行う（src/lib/authCallback.ts）。supabase-jsの
  // URL自動検出は無効（src/lib/supabase.ts）なので、ここでは自動保存に依存しない。
  // 保存に成功すると、既存の匿名セッションはXのセッションへ置き換わる。OAuthを
  // キャンセル・失敗した場合は、URLにトークンが無いか、キャンセルとして扱われ、
  // 元の匿名セッションにはsetSessionもsignOutも行われないため、そのまま残る。
  // そのため、OAuth開始前のsignOut()は廃止する。
  // isGuestSwitch（呼び出し元が「現在ゲストからXログインへ切り替えようとしている」
  // ことを分かっている場合だけtrue）が指定された時、または現在のセッションが実際に
  // 匿名の場合だけ、切り替え前に確認ダイアログを挟む（signOut()は行わない）。
  signInWithX: async (options) => {
    if (get().xSigningIn) return { ok: false, reason: "処理中です" };
    // 2026-09-13（再レビュー対応）：呼び出し元が渡すisGuestSwitchだけを信用しない。
    // ストア自身が持つ現在のセッション（get().user?.is_anonymous）が実際に匿名なら、
    // 呼び出し元がisGuestSwitchを渡し忘れていても（例：ゲスト対応を意識していない
    // 素の「Xでログイン」ボタンから呼ばれた場合）確認ダイアログを出す。
    // 通常のXログイン利用者・未ログイン利用者（is_anonymousがfalse/undefined）では
    // 従来どおり確認ダイアログを出さない。
    const isGuestSwitch = get().user?.is_anonymous === true || (options?.isGuestSwitch ?? false);

    if (isGuestSwitch) {
      const confirmed = window.confirm(
        "Xログインに成功した場合、ゲスト参加状態は終了し、今回のゲスト記録は引き継がれません。Xログインを開始しますか？",
      );
      if (!confirmed) return { ok: false };
    }

    set({ xSigningIn: true });
    try {
      // 2026-09-27：ここでsupabase.auth.signOut()は呼ばない（上のコメント参照）。
      // OAuthが実際に成功した場合だけ、新しいセッションの保存により自然にゲスト状態が終わる。
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
      // 既に有効な匿名セッションがあれば、それを再利用する（signInAnonymously()を
      // 再実行せず、新しい匿名アカウント＝新しいゲスト番号を作らない）。ボタンの
      // 無効化（guestSigningIn）だけに頼らず、ここでも二重作成を防ぐ。まずストアの
      // キャッシュ（同期・高速）を見て、無ければ実際のセッション
      // （supabase.auth.getSession()）を確認する。
      const cachedUser = get().user;
      if (cachedUser) {
        if (cachedUser.is_anonymous === true) {
          return { ok: true, userId: cachedUser.id };
        }
        // 2026-09-27（レビュー対応）：Xログイン済みのセッションがあるのに、
        // UIの想定外の経路や競合でsignInAsGuestが呼ばれてしまった場合、新しい
        // 匿名アカウントを作ってXセッションを上書きしてはならない。何もせず、
        // 現在のXセッションを維持したまま失敗を返す。
        return { ok: false, reason: "すでにXでログインしています。" };
      }

      let sessionData: { session: { user: { id: string; is_anonymous?: boolean } } | null };
      try {
        const result = await supabase.auth.getSession();
        if (result.error) {
          // getSession自体が失敗した場合、既存セッションの有無を判断できない。
          // 「セッションが無い」と決めつけて匿名認証へ進むと、実際には残っていた
          // 匿名セッションを見失わせる恐れがあるため、新規匿名認証へは進まない。
          return { ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" };
        }
        sessionData = result.data;
      } catch {
        // getSession自体が例外を投げた場合も同様に、新規匿名認証へは進まない。
        return { ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" };
      }

      const existingUser = sessionData.session?.user;
      if (existingUser) {
        if (existingUser.is_anonymous === true) {
          return { ok: true, userId: existingUser.id };
        }
        return { ok: false, reason: "すでにXでログインしています。" };
      }

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        return { ok: false, reason: "ゲスト参加に失敗しました。時間をおいて再度お試しください。" };
      }
      return { ok: true, userId: data?.user?.id ?? data?.session?.user?.id ?? null };
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
