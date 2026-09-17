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

// 2026-09-17（複数プロバイダー対応レビュー修正・項目2）：identitiesの取得状態を
// booleanのidentitiesLoadingだけでなく4値で明示する。「未取得」と「取得失敗」を
// 区別できないと、失敗時に画面が「全プロバイダー未連携」のように誤って見えてしまう
// （実際には取得できていないだけで、連携状態は不明というのが正しい）。
export type IdentitiesStatus = "idle" | "loading" | "loaded" | "error";

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
  // 2026-09-17（レビュー修正・項目3）：unlinkProvider実行中の対象identity_id。
  unlinkingIdentityId: string | null;
  // 2026-09-17（レビュー修正・項目3）：link/unlinkのどちらか一方でも進行中なら
  // true。linkingProvider/unlinkingIdentityIdは「どれが」進行中かの表示用、
  // こちらは「link/unlinkのどれか1つしか同時に走らせない」ための共通ロック
  // （コンポーネント側のdisabledだけに頼らず、store側でも二重実行を防ぐ）。
  identityMutationInProgress: boolean;
  identities: UserIdentity[] | null;
  identitiesStatus: IdentitiesStatus;
  // 既存コンポーネント（LoginMethodsManageModal）を壊さないための後方互換フィールド。
  // identitiesStatus === "loading" の間だけtrueになる（新規コードはidentitiesStatusを見る）。
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
  // 2026-09-17（レビュー修正・項目3）：fail-closed化。identities一覧を正常取得
  // できていない場合・対象が最新一覧に存在しない場合も解除させない。
  unlinkProvider: (identity: UserIdentity) => Promise<AuthActionResult>;
  refreshIdentities: () => Promise<void>;
  signOut: () => Promise<void>;
}

// 2026-09-17（レビュー修正・項目1）：refreshIdentitiesの取得競合対策。
// 呼び出しごとに採番し、応答時点でこの値と一致する（＝最新の呼び出しである）
// 場合だけ結果をstateへ反映する。サインアウト・ゲスト切替・別アカウントへの
// 切替（＝user.idの変化）が起きるたびにも加算し、その時点で進行中だった
// 古いリクエストを（最終的にuser.idが偶然元に戻った場合でも）無効化する。
let identitiesRequestSeq = 0;

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  loading: true,
  guestSigningIn: false,
  signingInProvider: null,
  linkingProvider: null,
  unlinkingIdentityId: null,
  identityMutationInProgress: false,
  identities: null,
  identitiesStatus: "idle",
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
  // 2026-09-17（レビュー修正・項目3）：identityMutationInProgress（link/unlink共通
  // ロック）をsigningInProvider/linkingProviderと並べてここで確認する。setによる
  // ロック取得はawaitより前（同期的）に行うため、連打・同時クリックでも2回目以降は
  // 必ずこのガードで弾かれ、supabase.auth.linkIdentity()自体は1回しか呼ばれない。
  linkProvider: async (provider) => {
    if (get().signingInProvider || get().identityMutationInProgress) {
      return { ok: false, reason: "処理中です" };
    }
    if (!get().user) return { ok: false, reason: "ログインしてからお試しください。" };

    set({ identityMutationInProgress: true, linkingProvider: provider });
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
      set({ identityMutationInProgress: false, linkingProvider: null });
    }
  },

  // 2026-09-16（複数プロバイダー対応）：Supabase側にも「識別情報が1つしかない
  // 場合は解除不可（single_identity_not_deletable）」という制約があるが、
  // エラーになってから初めて気づくUXを避けるため、呼び出し前にクライアント側の
  // identitiesキャッシュでも同じ条件を確認する。confirmはこの関数の外側
  // （呼び出し元のUI）で行う想定とし、ここでは実際の解除処理のみを担う。
  // 2026-09-17（レビュー修正・項目3）：fail-closedの3段ガードを追加。
  // (1) identitiesStatusが"loaded"でない＝最新一覧を正常取得できていない間は
  //     一切解除させない（エラー時の代替として古い一覧を使わない）。
  // (2) 解除対象が、その最新一覧の中に実在するidentity_idと一致しない場合は
  //     解除させない（呼び出し元から渡されたidentityオブジェクトを鵜呑みにしない）。
  // (3) 一覧が1件のみの場合は解除させない（最後のログイン方法の保護）。
  // さらにidentityMutationInProgressで、link/unlinkを問わずどれか1つしか
  // 同時に走らせない（linkProviderと共有の排他ロック）。
  unlinkProvider: async (identity) => {
    if (get().identityMutationInProgress) return { ok: false, reason: "処理中です" };

    const status = get().identitiesStatus;
    const current = get().identities;
    if (status !== "loaded" || !current) {
      return { ok: false, reason: "ログイン方法を取得できませんでした。時間をおいて再度お試しください。" };
    }
    const target = current.find((i) => i.identity_id === identity.identity_id);
    if (!target) {
      return { ok: false, reason: "ログイン方法の情報が最新でないため解除できません。再読み込みしてお試しください。" };
    }
    if (current.length <= 1) {
      return { ok: false, reason: "最後のログイン方法は解除できません。" };
    }

    set({ identityMutationInProgress: true, unlinkingIdentityId: identity.identity_id });
    try {
      const { error } = await supabase.auth.unlinkIdentity(target);
      if (error) {
        return { ok: false, reason: mapAuthErrorToMessage(error) };
      }
      await get().refreshIdentities();
      return { ok: true };
    } catch {
      return { ok: false, reason: "連携の解除に失敗しました。時間をおいて再度お試しください。" };
    } finally {
      set({ identityMutationInProgress: false, unlinkingIdentityId: null });
    }
  },

  // 2026-09-17（レビュー修正・項目1）：取得開始時点のuser.idと採番したrequestIdを
  // 閉じ込め、応答時点で「まだ最新のリクエストで、かつuser.idが取得開始時から
  // 変わっていない」場合にのみidentities/identitiesStatusを更新する。
  // 途中でサインアウト・ゲスト切替・別アカウントへの切替が起きると
  // identitiesRequestSeqがそれらのタイミングでも加算される（下のonAuthStateChange
  // 参照）ため、遅れて届いた古いリクエストの結果が新しい利用者のstateへ混ざらない。
  refreshIdentities: async () => {
    const requestedUserId = get().user?.id ?? null;
    if (!requestedUserId) {
      identitiesRequestSeq += 1;
      set({ identities: null, identitiesStatus: "idle", identitiesLoading: false });
      return;
    }

    const requestId = ++identitiesRequestSeq;
    set({ identitiesLoading: true, identitiesStatus: "loading" });
    const isStillCurrent = () => requestId === identitiesRequestSeq && get().user?.id === requestedUserId;
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (!isStillCurrent()) return;
      if (error) {
        set({ identities: null, identitiesStatus: "error" });
      } else {
        set({ identities: data?.identities ?? null, identitiesStatus: "loaded" });
      }
    } catch {
      if (isStillCurrent()) set({ identities: null, identitiesStatus: "error" });
    } finally {
      // 古いリクエストのfinallyが、新しいリクエストのloadingをfalseに戻さないようにする。
      if (requestId === identitiesRequestSeq) {
        set({ identitiesLoading: false });
      }
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
  },
}));

// 2026-09-17（レビュー修正・項目1）：identitiesの無効化は、Supabaseの
// onAuthStateChange（ブラウザ限定・window依存）ではなく、ストア自身の
// user.id変化を見るsubscribeに切り出す。こうすることで、実際のOAuthイベント
// 経由であれ、テストコードによる直接のsetState({user:...})であれ、
// 「ログイン中の利用者が変わった」瞬間に必ず同じ経路で無効化される
// （useProfileStore.tsがuseAuthStoreを見る既存のsubscribeパターンと同じ考え方）。
// サインアウト・ゲスト切替・別アカウントへの切替はすべてuser.idの変化として
// ここを通る。「サインアウト→同じアカウントへ即再ログイン」のようにuser.idが
// 最終的に元へ戻るケースでも、途中で最低2回（null化・再設定）はこの分岐を
// 通るため、どちらのタイミングでも加算され、古いリクエストのrequestIdは
// 必ず古い世代のままになる。
useAuthStore.subscribe((state, prevState) => {
  const nextUserId = state.user?.id ?? null;
  const previousUserId = prevState.user?.id ?? null;
  if (nextUserId === previousUserId) return;
  identitiesRequestSeq += 1;
  useAuthStore.setState({ identities: null, identitiesStatus: "idle", identitiesLoading: false });
});

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
