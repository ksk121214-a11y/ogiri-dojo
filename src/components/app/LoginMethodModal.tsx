"use client";

import { useState } from "react";

import AuthProviderIcon from "@/components/app/AuthProviderIcon";
import type { AuthProviderId } from "@/lib/authProviders";
import { listEnabledAuthProviders } from "@/lib/authProviders";
import { useAuthStore } from "@/store/useAuthStore";
import { useLoginModalStore } from "@/store/useLoginModalStore";

// 2026-09-17（複数プロバイダー対応レビュー修正・項目7）：X/Google/Appleを
// すべて同じ赤色の独自ボタンにしない。Googleは白背景+グレー枠+公式4色ロゴ、
// Appleは黒背景+白文字+白リンゴロゴという、各社のサインインボタンの
// ブランドガイドラインに沿った配色にする（Xは既存の意匠を維持）。
const PROVIDER_BUTTON_CLASS: Record<AuthProviderId, string> = {
  x: "bg-dojo-curtain-red text-dojo-washi-white hover:opacity-90",
  google: "border border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f7f8f8]",
  apple: "bg-black text-white hover:opacity-90",
};

const PROVIDER_BUTTON_LABEL: Record<AuthProviderId, string> = {
  x: "Xでログイン",
  google: "Googleでログイン",
  apple: "Appleでログイン",
};

// 2026-09-16（複数プロバイダー対応）：これまで各画面が個別に持っていた
// 「Xでログイン」ボタン＋ローカルのエラー表示を、この1つの共通モーダルに
// 集約する。トリガー側（ヘッダー・ホームのプロフィールカード・/liveの
// 未ログイン画面・ゲスト参加中の案内・マイページ等）はuseLoginModalStoreの
// openLoginModal({isGuestSwitch})を呼ぶだけでよい。
//
// root layout（src/app/layout.tsx）に1つだけマウントする想定
// （どのページ・どのテーマ配下からでも同じモーダルが開けるようにするため）。
//
// ゲストからの切り替え確認ダイアログ（window.confirm）自体は
// useAuthStore.signInWithProvider内で行う（isGuestSwitchを渡した時のみ）ため、
// ここでは重複して確認を出さない。
export default function LoginMethodModal() {
  const open = useLoginModalStore((s) => s.open);
  const isGuestSwitch = useLoginModalStore((s) => s.isGuestSwitch);
  const closeLoginModal = useLoginModalStore((s) => s.closeLoginModal);
  const signInWithProvider = useAuthStore((s) => s.signInWithProvider);
  const signingInProvider = useAuthStore((s) => s.signingInProvider);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const enabledProviders = listEnabledAuthProviders();
  const busy = signingInProvider !== null;

  const handleSelect = async (provider: AuthProviderId) => {
    setError(null);
    const result = await signInWithProvider(provider, { isGuestSwitch });
    if (result.ok) {
      // OAuthはこの後ページ遷移（フルリダイレクト）するため、通常はここに
      // 到達する前に離脱する。到達した場合に備えてモーダルは閉じておく。
      closeLoginModal();
      return;
    }
    if (result.reason) setError(result.reason);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={() => {
        if (busy) return;
        setError(null);
        closeLoginModal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ログイン方法を選択"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-dojo-tatami-cream p-6 text-dojo-ink shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-black">ログイン方法を選択</h2>
          <button
            type="button"
            onClick={() => {
              if (busy) return;
              setError(null);
              closeLoginModal();
            }}
            aria-label="閉じる"
            disabled={busy}
            className="rounded-full px-2 py-1 font-sans text-sm text-dojo-ink/70 hover:bg-dojo-ink/5 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {isGuestSwitch && (
          <p className="font-sans text-xs text-dojo-ink/70">
            ログインすると、ゲスト参加中の記録は引き継がれません。
          </p>
        )}

        <div className="flex flex-col gap-2">
          {enabledProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              disabled={busy}
              onClick={() => handleSelect(provider)}
              className={`flex items-center justify-center gap-2.5 rounded-full px-4 py-3 font-sans text-sm font-bold transition disabled:opacity-50 ${PROVIDER_BUTTON_CLASS[provider]}`}
            >
              <AuthProviderIcon provider={provider} className="h-5 w-5 shrink-0" />
              {signingInProvider === provider ? "処理中…" : PROVIDER_BUTTON_LABEL[provider]}
            </button>
          ))}
        </div>

        {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}
      </div>
    </div>
  );
}
