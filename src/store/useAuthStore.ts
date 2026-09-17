// Supabase Auth(X/Google/Apple OAuth + ゲスト匿名認証)のログイン状態を管理するストア。
// useUserStore(ダミーの演者データ)とは独立させ、実ログイン基盤の導入だけをまず切り出す。
import type { Session, User, UserIdentity } from "@supabase/supabase-js";
import { create } from "zustand";

import { mapAuthErrorToMessage } from "@/lib/authErrorMessages";
import type { AuthProviderId } from "@/lib/authProviders";
import { BASE_PATH } from "@/lib/basePath";
import { supabase } from "@/lib/supabase";

// SupabaseのProvider型（"x"|"google"|"apple"|...）に対する、このアプリが
// 実際に扱う3種類だけの対応表。AuthProviderId自体をそのままProviderへ渡せるが、
// 将来Providerの綴りが変わってもここ1箇所の変更で追従できるよう明示しておく。
const SUPABASE_PROVIDER: Record<AuthProviderId, "x" | "google" | "apple"> = {
  x: "x",
  google: "google",
  apple: "apple",
};

type AuthActionResult = { ok: true } | { ok: false; reason?: string };

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  // 2026-09-12（ゲスト参加）：ゲストとして参加ボタンの連打で複数回
  // signInAnonymously()を呼ばないようにするsingle-flightガード。
  guestSigningIn: boolean;
  // 2026-09-16（複数プロバイダー対応）：以前はxSigningIn(boolean)だけだったが、
  // 「今どのプロバイダーの新規ログインが進行中か」をUI側（LoginMethodModal）が
  // 出し分けられるよう、進行中のプロバイダーID自体を保持する形に変更。
  // signInWithProviderの呼び出し元を問わず、同時に1プロバイダーの処理しか
  // 走らないようにするsingle-flightガードを兼ねる。
  signingInProvider: AuthProviderId | null;
  // 2026-09-16（複数プロバイダー対応）：linkIdentity()による追加連携の進行中
  // プロバイダーID。新規ログイン(signingInProvider)とは別に管理し、
  // 「ログイン中のこの画面から連携を試みている」ことをUIが区別できるようにする。
  linkingProvider: AuthProviderId | null;
  identities: UserIdentity[] | null;
  identitiesLoading: boolean;
  signInWithProvider: (
    provider: AuthProviderId,
    options?: { isGuestSwitch?: boolean },
  ) => Promise<AuthActionResult>;
  // 既存呼び出し元（多数のコンポーネント）を壊さないための後方互換ラッパー。
  // 新規のUI（LoginMethodModal）はsignInWithProviderを直接使う。
  signInWithX: (options?: { isGuestSwitch?: boolean }) => Promise<AuthActionResult>;
  signInAsGuest: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  // 2026-09-16（複数プロバイダー対応）：Xログイン中の既存アカウントへApple/Googleを
  // 追加連携する。メールアドレス一致による自動統合には依存せず、Supabase Authの
  // linkIdentity()（＝Manual Identity Linking機能）を明示的に使う。これにより
  // auth.users.id・profiles.idは変わらないまま、同じアカウントに複数のログイン
  // 方法がぶら下がる（ポイント・段位・投稿等が引き継がれる要件を満たす）。
  linkProvider: (provider: AuthProviderId) => Promise<AuthActionResult>;
  // 2026-09-16（複数プロバイダー対応）：連携解除。Supabase Auth側でも
  // 「識別情報が2つ以上ないと解除できない」制約があるが、生のエラーを
  // 見せる前にクライアント側でも同じガードをかけ、確認ダイアログを必ず挟む。
  unlinkProvider: (identity: UserIdentity) => Promise<AuthActionResult>;
  refreshIdentities: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  loading: true,
  guestSigningIn: false,
  signingInProvider: null,
  linkingProvider: null,
  identities: null,
  identitiesLoading: false,

  // 2026-09-13（0070ゲスト参加レビュー対応）：以前は「匿名セッションが有効なまま
  // signInWithOAuthを開始すると、同じauth.uid()のまま匿名ユーザーが本アカウントへ
  // 『アップグレード』される（＝ゲストのprofiles行がそのまま本アカウント化される）
  // ことがある」という懸念から、呼び出し元を問わず常にsignOut()してから
  // OAuthを開始していた。しかしこれだと、既にログイン済みの利用者や
  // 未ログイン状態からの呼び出し（＝匿名セッションが存在しないケース）にも
  // 無意味なsignOut()が走ってしまう。
  // isGuestSwitch（呼び出し元が「現在ゲストから本ログインへ切り替えようとしている」
  // ことを分かっている場合だけtrue）が指定された時だけ、切り替え前に確認ダイアログを
  // 挟んだ上でsignOut()する。ゲストでない呼び出し（通常ログイン・admin/host
  // ログイン等）ではsignOut()を呼ばない。
  // 2026-09-16（複数プロバイダー対応）：プロバイダーをX固定から引数化。
  // signInWithXが担っていたロジックをそのまま移設しただけで、挙動は変えていない。
  signInWithProvider: async (provider, options) => {
    if (get().signingInProvider) return { ok: false, reason: "処理中です" };
    // 2026-09-13（再レビュー対応）：呼び出し元が渡すisGuestSwitchだけを信用しない。
    // ストア自身が持つ現在のセッション（get().user?.is_anonymous）が実際に匿名なら、
    // 呼び出し元がisGuestSwitchを渡し忘れていても（例：ゲスト対応を意識していない
    // 素のログインボタンから呼ばれた場合）確認ダイアログ→signOutを行う。
    // 通常ログイン利用者・未ログイン利用者（is_anonymousがfalse/undefined）では
    // 従来どおり不要なsignOutを行わない。
    const isGuestSwitch = get().user?.is_anonymous === true || (options?.isGuestSwitch ?? false);

    if (isGuestSwitch) {
      const confirmed = window.confirm(
        "ゲスト参加状態は終了し、今回の記録は引き継がれません。ログインを開始しますか？",
      );
      if (!confirmed) return { ok: false };
    }

    set({ signingInProvider: provider });
    try {
      if (isGuestSwitch) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          return { ok: false, reason: "ログインの切り替えに失敗しました。時間をおいて再度お試しください。" };
        }
      }

      const redirectTo = `${window.location.origin}${BASE_PATH}/auth/callback/`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: SUPABASE_PROVIDER[provider],
        options: { redirectTo },
      });
      if (error) {
        return { ok: false, reason: mapAuthErrorToMessage(error) };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "ログインを開始できませんでした。時間をおいて再度お試しください。" };
    } finally {
      set({ signingInProvider: null });
    }
  },

  signInWithX: (options) => get().signInWithProvider("x", options),

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

  // 2026-09-16（複数プロバイダー対応）：linkIdentity()もOAuthのリダイレクトを
  // 伴う（signInWithOAuthと同じPKCEフロー）ため、成功/失敗はこの呼び出し自体では
  // 分からず、/auth/callbackへ戻ってきた時点でURL中のerror/error_codeを見て
  // 判定する（callbackページ側の実装を参照）。ここでは「リダイレクト開始」に
  // 失敗した場合（未ログイン状態でlinkIdentityを呼んだ等）だけを扱う。
  linkProvider: async (provider) => {
    if (get().signingInProvider || get().linkingProvider) return { ok: false, reason: "処理中です" };
    if (!get().user) return { ok: false, reason: "ログインしてからお試しください。" };

    set({ linkingProvider: provider });
    try {
      const redirectTo = `${window.location.origin}${BASE_PATH}/auth/callback/?flow=link`;
      const { error } = await supabase.auth.linkIdentity({
        provider: SUPABASE_PROVIDER[provider],
        options: { redirectTo },
      });
      if (error) {
        return { ok: false, reason: mapAuthErrorToMessage(error) };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "連携を開始できませんでした。時間をおいて再度お試しください。" };
    } finally {
      set({ linkingProvider: null });
    }
  },

  // 2026-09-16（複数プロバイダー対応）：Supabase側にも「識別情報が1つしかない
  // 場合は解除不可（single_identity_not_deletable）」という制約があるが、
  // エラーになってから初めて気づくUXを避けるため、呼び出し前にクライアント側の
  // identitiesキャッシュでも同じ条件を確認する。confirmはこの関数の外側
  // （呼び出し元のUI）で行う想定とし、ここでは実際の解除処理のみを担う。
  unlinkProvider: async (identity) => {
    const current = get().identities;
    if (current && current.length <= 1) {
      return { ok: false, reason: "最後のログイン方法は解除できません。" };
    }
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) {
        return { ok: false, reason: mapAuthErrorToMessage(error) };
      }
      await get().refreshIdentities();
      return { ok: true };
    } catch {
      return { ok: false, reason: "連携の解除に失敗しました。時間をおいて再度お試しください。" };
    }
  },

  refreshIdentities: async () => {
    if (!get().user) {
      set({ identities: null });
      return;
    }
    set({ identitiesLoading: true });
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      set({ identities: error ? null : (data?.identities ?? null) });
    } finally {
      set({ identitiesLoading: false });
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
    const previousUserId = useAuthStore.getState().user?.id;
    useAuthStore.setState({
      session,
      user: session?.user ?? null,
      loading: false,
    });
    // 2026-09-16（複数プロバイダー対応）：ログイン方法一覧（identities）は
    // 「今ログイン中の利用者が誰か」に強く紐づくキャッシュのため、利用者が
    // 切り替わった（ログイン・ログアウト・別アカウントへの切り替え）タイミングで
    // 必ず古いキャッシュを捨てる。連携直後（同じ利用者のままidentitiesだけ増える
    // ケース）はlinkProvider呼び出し元がrefreshIdentities()を明示的に呼ぶ。
    if (session?.user?.id !== previousUserId) {
      useAuthStore.setState({ identities: null });
    }
  });
}
