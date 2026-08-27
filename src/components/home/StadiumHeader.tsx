"use client";

import Link from "next/link";
import { useState } from "react";

import PointHistoryModal from "@/components/app/PointHistoryModal";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

// ホーム専用ヘッダー：地下ライブハウス風の暗いトンマナに合わせた最小構成
// （タイトル＋ユーザー名／ポイントのみ。ホーム/マイページの切替タブは下部ナビ側にあるため置かない）。
// ポイントバッジは既存のPointHistoryModal（獲得履歴）を開く動線をそのまま引き継ぐ。
// 既存の認証（useAuthStore）はUIを変えずログイン/ログアウトの小さなリンクとして残す。
export default function StadiumHeader() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const displayName = profile?.displayName ?? user.displayName;
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <header className="border-b border-[var(--paper)]/70 bg-[var(--bg)]">
      <div className="mx-auto flex w-full max-w-[480px] items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <Link
          href="/"
          className="shrink-0 font-sans text-base font-bold tracking-tight text-[var(--text-on-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          爆笑スタジアム
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex min-w-0 items-center gap-1.5 rounded-full px-1 py-1 font-sans focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            aria-haspopup="dialog"
          >
            <span className="min-w-0 truncate text-[11px] text-[var(--muted-on-dark)]">
              {displayName}
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--accent)]">
              {user.points.toLocaleString()}
              <span className="ml-0.5 text-[10px] font-normal text-[var(--muted-on-dark)]">pt</span>
            </span>
          </button>

          {/*
            参考デザインはタイトル＋名前・ポイントのみのシンプルな構成のため、
            ログイン/ログアウトは枠付きボタンにせず、控えめな下線リンク程度の
            見た目に留める（機能・処理自体はuseAuthStoreのまま変更しない）。
          */}
          {!authLoading && (
            authUser ? (
              <button
                type="button"
                onClick={() => signOut()}
                className="shrink-0 font-sans text-[10px] text-[var(--muted-on-dark)] underline decoration-[var(--border-dark)] underline-offset-2 transition hover:text-[var(--text-on-dark)] hover:decoration-[var(--text-on-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                ログアウト
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signInWithX()}
                className="shrink-0 font-sans text-[10px] text-[var(--muted-on-dark)] underline decoration-[var(--border-dark)] underline-offset-2 transition hover:text-[var(--text-on-dark)] hover:decoration-[var(--text-on-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Xでログイン
              </button>
            )
          )}
        </div>
      </div>

      {historyOpen && <PointHistoryModal onClose={() => setHistoryOpen(false)} />}
    </header>
  );
}
