"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { mapAuthErrorToMessage } from "@/lib/authErrorMessages";
import { supabase } from "@/lib/supabase";

// 静的エクスポート(output: "export")のためサーバー側Route Handlerが使えず、
// OAuth（X/Google/Apple）のリダイレクト先はこのクライアントページにしている。
// supabase-jsのdetectSessionInUrlがURL中の認可コードを自動検出してセッション交換するので、
// ここではその完了(SIGNED_IN)を待って適切な戻り先へ遷移するだけでよい。
//
// 2026-09-16（複数プロバイダー対応）：useAuthStore.linkProviderが呼ぶOAuthは
// redirectToへ「?flow=link」を付けて開始する。これは新規ログイン
// （signInWithProvider、query無し）と同じこのページを共用しつつ、
// 「連携が終わったらマイページのログイン方法画面へ戻す」ために使う
// （新規ログインは従来どおりホームへ戻す）。
//
// 失敗時（重複連携=identity_already_exists等）はSupabase側がこのURLへ
// error/error_codeを付けて返す。生のエラーは画面に出さず、mapAuthErrorToMessageで
// 必ず日本語の案内文へ変換する。
//
// 2026-09-17（複数プロバイダー対応レビュー修正・項目5）：連携成功時の戻り先を
// 単なる"/mypage"から"/mypage?loginMethods=1&link=success"へ変更した。
// これはこのページの中だけで組み立てる固定のクエリであり、URLから受け取った
// 値をそのまま遷移先に使う（＝任意のreturn URLへ飛ばす）ことはしていない。
// マイページ側（loginMethodsReturnFlow.ts）がこのクエリを見て、ログイン方法
// モーダルの自動オープンと成功表示を行う。連携失敗時も、この直前のsuccessと
// 同様にmypageへ戻す（"ホームに戻る"ボタンの遷移先も含む）ことで、利用者が
// 元々やろうとしていた操作（ログイン方法の管理）へ迷わず戻れるようにする
// （エラー内容自体は引き続きerrorMessageとしてこの画面上に表示するのみで、
// 生のSupabaseエラーはmapAuthErrorToMessage経由でしか渡らない）。
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

export default function AuthCallbackPage() {
  const router = useRouter();
  const [rawError] = useState(readOAuthError);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    rawError ? mapAuthErrorToMessage(rawError) : null,
  );

  useEffect(() => {
    if (rawError) {
      // 生のエラーコード・descriptionは画面へは出さず、開発確認用にconsoleへのみ残す。
      console.warn("[auth/callback] OAuth error", rawError);
    }
  }, [rawError]);

  useEffect(() => {
    if (errorMessage) return;
    const destination = isLinkFlow() ? "/mypage?loginMethods=1&link=success" : "/";

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session) {
        router.replace(destination);
      }
    });

    // すでにセッション交換が完了済みの場合に備えて即時チェックもしておく
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(destination);
      }
    });

    const timeout = window.setTimeout(() => {
      setErrorMessage((current) => current ?? "ログイン処理がタイムアウトしました。もう一度お試しください。");
    }, 10_000);

    return () => {
      listener.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [router, errorMessage]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dojo-tatami-cream px-6 text-center">
      {errorMessage ? (
        <>
          <p className="font-sans text-sm text-dojo-ink">ログインに失敗しました：{errorMessage}</p>
          <button
            type="button"
            onClick={() => router.replace(isLinkFlow() ? "/mypage" : "/")}
            className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white"
          >
            {isLinkFlow() ? "マイページに戻る" : "ホームに戻る"}
          </button>
        </>
      ) : (
        <p className="font-sans text-sm text-dojo-dark-brown">ログイン処理中です…</p>
      )}
    </div>
  );
}
