"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { mapAuthErrorToMessage } from "@/lib/authErrorMessages";
import { clearLinkAttempt, readLinkAttempt } from "@/lib/linkAttempt";
import { validateLinkAttempt, verifyIdentityWasAdded } from "@/lib/linkFlowVerification";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// 静的エクスポート(output: "export")のためサーバー側Route Handlerが使えず、
// OAuth（X/Google/Apple）のリダイレクト先はこのクライアントページにしている。
// supabase-jsのdetectSessionInUrlがURL中の認可コードを自動検出してセッション交換するので、
// ここではその完了を待って適切な戻り先へ遷移するだけでよい。
//
// 2026-09-16（複数プロバイダー対応）：useAuthStore.linkProviderが呼ぶOAuthは
// redirectToへ「?flow=link」を付けて開始する。これは新規ログイン
// （signInWithProvider、query無し）と同じこのページを共用しつつ、
// 「連携が終わったらマイページのログイン方法画面へ戻す」ために使う
// （新規ログインは従来どおりホームへ戻す）。
//
// 2026-09-18（複数プロバイダー対応レビュー再修正・項目1）：flow=link時は
// 「Supabaseのセッションが存在する」だけでは連携成功と判定しない
// （ログイン済みユーザーがこのURLを直接開いただけでも成功扱いになっていた
// 不具合の修正）。useAuthStore.linkProvider側でsessionStorageへ保存した
// 一時情報（src/lib/linkAttempt.ts）と、実際にgetUserIdentities()で
// 取得したidentity一覧を突き合わせ（src/lib/linkFlowVerification.ts）、
// 「連携開始時と同じユーザーで、かつ対象providerのidentityが実際に
// 増えている」ことを確認できた場合だけ成功とする。判定に使うproviderは
// 常にsessionStorageに保存された値（＝linkProvider()の呼び出し元が渡した
// 値）であり、URLのクエリからprovider等を読み取ることは一切しない
// （そもそもredirectToにprovider情報を含めていないため、URL改ざんによる
// 詐称の余地が無い）。
// 一時情報は成功・失敗・期限切れ・別ユーザー・OAuthキャンセルのいずれの
// 結果でも、判定に使った直後に必ず削除する（同じ一時情報の再利用を防ぐ）。
//
// 失敗時（重複連携=identity_already_exists等、あるいは上記の連携確認NG）は
// 生のエラー・providerレスポンス・内部情報を一切表示せず、固定の日本語文言
// だけを表示する。
const LINK_VERIFICATION_FAILURE_MESSAGE =
  "ログイン方法の連携を確認できませんでした。マイページからもう一度お試しください。";

function readOAuthError(): { code: string | null } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("error_code") ?? params.get("error");
  if (!code) return null;
  return { code };
}

function isLinkFlow(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("flow") === "link";
}

// OAuthコード交換（detectSessionInUrl）の完了を待つ。SIGNED_IN以外にも
// USER_UPDATED/TOKEN_REFRESHEDで完了しうる（linkIdentity()は同じユーザーの
// セッションを更新するだけで、必ずしもSIGNED_INが飛ぶとは限らないため）。
// 呼び出し元がタイムアウトを制御するため、この関数自体は無限に待つ
// （呼び出し元のeffect cleanupでunsubscribeされれば購読も解除される）。
function waitForSessionSettled(): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  let resolveFn: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    if (settled) return;
    if ((event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") && session) {
      settled = true;
      listener.subscription.unsubscribe();
      resolveFn();
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    if (settled) return;
    if (data.session) {
      settled = true;
      listener.subscription.unsubscribe();
      resolveFn();
    }
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      listener.subscription.unsubscribe();
      resolveFn();
    },
  };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [isLink] = useState(isLinkFlow);
  const [rawError] = useState(readOAuthError);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (!rawError) return null;
    // 2026-09-18（レビュー再修正・項目1）：連携フローの失敗は理由を問わず
    // 常にこの1つの安全な文言にする（重複連携等の細かい理由も含め、
    // 生のエラー・provider固有の情報を画面へ出さない）。新規ログインの失敗は
    // 従来どおりmapAuthErrorToMessageの個別文言のままにする。
    return isLink ? LINK_VERIFICATION_FAILURE_MESSAGE : mapAuthErrorToMessage(rawError);
  });

  useEffect(() => {
    if (!rawError) return;
    // 生のエラーコード・descriptionは画面へは出さず、開発確認用にconsoleへのみ残す。
    console.warn("[auth/callback] OAuth error", rawError);
    if (isLink) {
      // OAuthをキャンセル・失敗した場合も、一時情報を消費して削除する
      // （再利用させない）。
      clearLinkAttempt();
    }
  }, [rawError, isLink]);

  useEffect(() => {
    if (errorMessage) return;
    let cancelled = false;
    const session = waitForSessionSettled();

    if (!isLink) {
      // 新規ログイン（従来どおり）：セッションが確立し次第ホームへ戻る。
      session.promise.then(() => {
        if (!cancelled) router.replace("/");
      });
    } else {
      // 2026-09-18（レビュー再修正・項目1）：連携フローの確認手順。
      // 1. flow=linkであることは呼び出し元（isLink）で確認済み。
      // 2. sessionStorageの一時情報を読み込む（形式検証込み、壊れていればnull）。
      const attempt = readLinkAttempt();
      session.promise
        .then(async () => {
          if (cancelled) return;
          // 3〜5. JSON形式・provider・開始時刻の妥当性、有効期限、
          //   現在のuser IDが連携開始時と同じかを確認する。
          const currentUserId = useAuthStore.getState().user?.id ?? null;
          const preCheck = validateLinkAttempt(attempt, Date.now(), currentUserId);
          if (!preCheck.ok) {
            clearLinkAttempt();
            if (!cancelled) setErrorMessage(LINK_VERIFICATION_FAILURE_MESSAGE);
            return;
          }

          // 6〜7. getUserIdentities()を実行し、対象providerのidentityが
          //   実際に増えているか確認する。
          await useAuthStore.getState().refreshIdentities();
          if (cancelled) return;
          const status = useAuthStore.getState().identitiesStatus;
          const identities = useAuthStore.getState().identities;
          const identitiesResult =
            status === "loaded" && identities ? ({ ok: true, identities } as const) : ({ ok: false } as const);

          const postCheck = verifyIdentityWasAdded(attempt!, identitiesResult);
          // 9. 成功・失敗いずれの結果でも一時情報を消費して削除する（再利用不可にする）。
          clearLinkAttempt();

          if (!postCheck.ok) {
            if (!cancelled) setErrorMessage(LINK_VERIFICATION_FAILURE_MESSAGE);
            return;
          }

          // 8. 確認できた場合だけ、マイページのログイン方法自動表示へ進む。
          if (!cancelled) router.replace("/mypage?loginMethods=1&link=success");
        })
        .catch(() => {
          clearLinkAttempt();
          if (!cancelled) setErrorMessage(LINK_VERIFICATION_FAILURE_MESSAGE);
        });
    }

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      if (isLink) clearLinkAttempt();
      setErrorMessage(
        (current) =>
          current ?? (isLink ? LINK_VERIFICATION_FAILURE_MESSAGE : "ログイン処理がタイムアウトしました。もう一度お試しください。"),
      );
    }, 10_000);

    return () => {
      cancelled = true;
      session.cancel();
      window.clearTimeout(timeout);
    };
  }, [router, errorMessage, isLink]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dojo-tatami-cream px-6 text-center">
      {errorMessage ? (
        <>
          <p className="font-sans text-sm text-dojo-ink">ログインに失敗しました：{errorMessage}</p>
          <button
            type="button"
            onClick={() => router.replace(isLink ? "/mypage" : "/")}
            className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white"
          >
            {isLink ? "マイページに戻る" : "ホームに戻る"}
          </button>
        </>
      ) : (
        <p className="font-sans text-sm text-dojo-dark-brown">ログイン処理中です…</p>
      )}
    </div>
  );
}
