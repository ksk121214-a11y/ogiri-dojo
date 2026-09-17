"use client";

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import type { AuthProviderId } from "@/lib/authProviders";
import { AUTH_PROVIDER_ENABLED, AUTH_PROVIDER_LABELS } from "@/lib/authProviders";
import { useAuthStore } from "@/store/useAuthStore";

// 2026-09-16（複数プロバイダー対応）：マイページの「ログイン方法」から開く、
// X/Google/Appleの連携状況を確認・追加連携・解除するための画面。
// 表示は必ずgetUserIdentities()（＝Supabase Authの実際の状態）を基準にし、
// ローカルの推測やprofilesの列は使わない（要求どおり）。
//
// 「未設定のプロバイダーを本番に表示しない」対応：AUTH_PROVIDER_ENABLEDがfalseの
// プロバイダーは、まだ連携されていない限りボタン自体を出さない。ただし、
// 過去に連携済みのプロバイダーは（後で機能フラグをoffに戻した場合でも）
// 「連携済み」の事実を隠さず表示し続ける（解除はできるようにする）。
export default function LoginMethodsManageModal({ onClose }: { onClose: () => void }) {
  const identities = useAuthStore((s) => s.identities);
  const identitiesLoading = useAuthStore((s) => s.identitiesLoading);
  const refreshIdentities = useAuthStore((s) => s.refreshIdentities);
  const linkProvider = useAuthStore((s) => s.linkProvider);
  const unlinkProvider = useAuthStore((s) => s.unlinkProvider);
  const linkingProvider = useAuthStore((s) => s.linkingProvider);
  const [error, setError] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  useEffect(() => {
    refreshIdentities();
  }, [refreshIdentities]);

  const findIdentity = (provider: AuthProviderId): UserIdentity | undefined =>
    identities?.find((identity) => identity.provider === provider);

  // 直近でログインに使われた可能性が高い識別情報（last_sign_in_atが最も新しいもの）。
  // Supabaseはセッション単位の「今回どの識別情報でログインしたか」を返さないため、
  // 断定はせず「解除すると次回この方法でログインできなくなる」注意喚起の判断材料に留める。
  const mostRecentIdentityId = identities?.length
    ? identities.reduce((latest, current) =>
        new Date(current.last_sign_in_at ?? 0).getTime() >
        new Date(latest.last_sign_in_at ?? 0).getTime()
          ? current
          : latest,
      ).identity_id
    : null;

  const handleLink = async (provider: AuthProviderId) => {
    setError(null);
    const result = await linkProvider(provider);
    if (!result.ok && result.reason) setError(result.reason);
    // 成功時はこの後OAuthのフルリダイレクトが発生するため、以降の処理には進まない。
  };

  const handleUnlink = async (identity: UserIdentity) => {
    if ((identities?.length ?? 0) <= 1) {
      setError("最後のログイン方法は解除できません。");
      return;
    }
    const label = AUTH_PROVIDER_LABELS[identity.provider as AuthProviderId] ?? identity.provider;
    const isLikelyCurrent = identity.identity_id === mostRecentIdentityId;
    const confirmMessage = isLikelyCurrent
      ? `${label}での連携を解除しますか？現在この方法でログインしている可能性があります。解除すると次回以降はこの方法でログインできなくなります。`
      : `${label}での連携を解除しますか？次回以降はこの方法でログインできなくなります。`;
    if (!window.confirm(confirmMessage)) return;

    setError(null);
    setUnlinkingId(identity.identity_id);
    try {
      const result = await unlinkProvider(identity);
      if (!result.ok && result.reason) setError(result.reason);
    } finally {
      setUnlinkingId(null);
    }
  };

  const providerOrder: AuthProviderId[] = ["x", "google", "apple"];
  const visibleProviders = providerOrder.filter(
    (provider) => AUTH_PROVIDER_ENABLED[provider] || !!findIdentity(provider),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ログイン方法"
        onClick={(e) => e.stopPropagation()}
        className={`${stadiumStyles.grainPaper} flex w-full max-w-sm flex-col gap-4 rounded-3xl p-6 text-[var(--ink)] shadow-2xl`}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-black text-[var(--ink)]">ログイン方法</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full px-2 py-1 font-sans text-sm text-[var(--ink)]/70 hover:bg-[var(--ink)]/5"
          >
            ✕
          </button>
        </div>

        {identitiesLoading && !identities ? (
          <p className="p-2 text-center font-sans text-xs text-[var(--ink)]/60">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleProviders.map((provider) => {
              const identity = findIdentity(provider);
              const canUnlink = !!identity && (identities?.length ?? 0) > 1;
              return (
                <div
                  key={provider}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[var(--ink)]/5 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-bold text-[var(--ink)]">
                      {AUTH_PROVIDER_LABELS[provider]}
                    </p>
                    <p className="font-sans text-[10px] text-[var(--ink)]/60">
                      {identity ? "連携済み" : "未連携"}
                    </p>
                  </div>
                  {identity ? (
                    <button
                      type="button"
                      disabled={!canUnlink || unlinkingId === identity.identity_id}
                      onClick={() => handleUnlink(identity)}
                      title={canUnlink ? undefined : "最後のログイン方法のため解除できません"}
                      className="shrink-0 whitespace-nowrap rounded-lg border border-[var(--ink)]/40 px-3 py-1.5 font-sans text-xs font-bold text-[var(--ink)]/80 transition hover:bg-[var(--ink)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {unlinkingId === identity.identity_id ? "解除中…" : "解除する"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={linkingProvider !== null}
                      onClick={() => handleLink(provider)}
                      className={`${stadiumStyles.grainAccent} shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90 disabled:opacity-50`}
                    >
                      {linkingProvider === provider ? "処理中…" : "連携する"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="font-sans text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
