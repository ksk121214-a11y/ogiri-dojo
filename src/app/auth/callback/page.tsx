"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AUTH_CALLBACK_MESSAGES,
  createAuthCallbackRunner,
  withTimeout,
  type ApiKeyProbeResult,
  type AuthCallbackEnvironment,
  type AuthCallbackOutcome,
} from "@/lib/authCallback";
import { supabase } from "@/lib/supabase";

// X OAuthの戻り先。静的エクスポート(output: "export")のため、サーバー側のRoute Handlerは使えない。
// implicitフローのため、成功時のアクセストークン・リフレッシュトークンはURLのフラグメントで戻る。
// supabase-jsのdetectSessionInUrlは無効にしてあり（src/lib/supabase.ts）、セッションの確立は
// このページが明示的に行う（src/lib/authCallback.tsのprocessAuthCallback）。
// 読み取った直後にURLから認証情報を取り除く。
const CALLBACK_TIMEOUT_MS = 15_000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// 公開キーだけで応答する設定エンドポイントを確認する（トークンは送らない。キーは出力しない）。
async function probeApiKey(): Promise<ApiKeyProbeResult> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (response.ok) return "valid";
    return response.status === 401 || response.status === 403 ? "rejected" : "unreachable";
  } catch {
    return "unreachable";
  }
}

function createBrowserEnvironment(): AuthCallbackEnvironment {
  return {
    readLocation: () => ({
      href: window.location.href,
      hash: window.location.hash,
      search: window.location.search,
    }),
    replaceLocation: (url) => window.history.replaceState(window.history.state, "", url),
    // エラーオブジェクトはそのまま返す（分類にだけ使い、表示・出力はしない）
    getSession: async () => {
      const { data, error } = await supabase.auth.getSession();
      return { session: data.session, error };
    },
    setSession: async (tokens) => {
      const { data, error } = await supabase.auth.setSession(tokens);
      return { session: data.session, error };
    },
    probeApiKey,
  };
}

// 同じフラグメントの二重実行（React Strict Mode）は一度だけ処理し、新しいOAuth試行の結果は
// 別の処理として扱う（src/lib/authCallback.tsのcreateAuthCallbackRunner）。
const runCallback = createAuthCallbackRunner(createBrowserEnvironment());

const TIMEOUT_OUTCOME: AuthCallbackOutcome = {
  ok: false,
  reason: "timeout",
  message: AUTH_CALLBACK_MESSAGES.timeout,
};

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failure, setFailure] = useState<{ message: string; cancelled: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    withTimeout(runCallback(), CALLBACK_TIMEOUT_MS, TIMEOUT_OUTCOME).then((outcome) => {
      if (!active) return;
      if (outcome.ok) {
        // 履歴にコールバックのURLを残さない。
        router.replace("/");
        return;
      }
      // 失敗の分類と、安全な構造情報（名前・HTTP状態・コード・分類）だけを記録する。
      // トークン・キー・エラーのmessage・URLは出さない。
      console.warn("[auth-callback] failed", outcome.ok ? null : { reason: outcome.reason, diagnostic: outcome.diagnostic });
      setFailure({ message: outcome.message, cancelled: outcome.reason === "cancelled" });
    });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dojo-surface px-6 text-center">
      {failure ? (
        <>
          <p className="font-sans text-sm text-dojo-ink">
            {failure.cancelled ? failure.message : `ログインに失敗しました：${failure.message}`}
          </p>
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-on-dark"
          >
            ホームに戻る
          </button>
        </>
      ) : (
        <p className="font-sans text-sm text-dojo-ink-soft">ログイン処理中です…</p>
      )}
    </div>
  );
}
