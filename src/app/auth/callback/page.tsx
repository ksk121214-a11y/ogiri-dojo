"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

// 静的エクスポート(output: "export")のためサーバー側Route Handlerが使えず、
// X OAuthのリダイレクト先はこのクライアントページにしている。
// supabase-jsのdetectSessionInUrlがURL中の認可コードを自動検出してセッション交換するので、
// ここではその完了(SIGNED_IN)を待ってトップへ戻すだけでよい。
function readOAuthError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("error_description") ?? params.get("error");
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(readOAuthError);

  useEffect(() => {
    if (errorMessage) return;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        router.replace("/");
      }
    });

    // すでにセッション交換が完了済みの場合に備えて即時チェックもしておく
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/");
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
            onClick={() => router.replace("/")}
            className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white"
          >
            ホームに戻る
          </button>
        </>
      ) : (
        <p className="font-sans text-sm text-dojo-dark-brown">ログイン処理中です…</p>
      )}
    </div>
  );
}
