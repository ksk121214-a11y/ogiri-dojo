"use client";

import Link from "next/link";

import NotificationBell from "@/components/app/NotificationBell";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

import SoundSettingsToggle from "./SoundSettingsToggle";
import styles from "./StadiumHome.module.css";

// 名前表示に使える幅がヘッダーでは特に限られているため、文字数に応じて段階的に
// フォントサイズを落とし、10文字（表示名の最大長）でも省略(...)にならないようにする。
function nameSizeClass(name: string): string {
  if (name.length <= 6) return "text-sm";
  return "text-xs";
}

// ホーム専用ヘッダー：地下ライブハウス風の暗いトンマナに合わせた最小構成
// （タイトル＋ユーザー名のみ。ホーム/マイページの切替タブは下部ナビ側にあるため置かない）。
// 2026-08-28: 「上のポイントは消して、ホーム下部のポイント残高を押すと履歴が出るように」の
// 要望で、ポイント表示と獲得履歴モーダルを開く動線をヘッダーから撤去し、AccountSummary側に
// 移した（表示名だけは引き続きここに残す）。
// 既存の認証（useAuthStore）はUIを変えずログイン/ログアウトの小さなリンクとして残す。
export default function StadiumHeader() {
  const profile = useProfileStore((s) => s.profile);
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const signOut = useAuthStore((s) => s.signOut);
  // 2026-09-01: 未ログイン時にローカルのダミー名（useUserStore）が実データであるかの
  // ように表示されていた問題を修正。ログインしている場合のみ名前を出す。
  const displayName = authUser ? (profile?.displayName ?? "…") : null;

  return (
    <header className={`${styles.grainDark} border-b border-[var(--paper)]/70`}>
      <div className="mx-auto flex w-full max-w-[480px] items-center justify-between gap-2 px-4 py-2">
        <Link
          href="/"
          data-sfx="home"
          className={`${styles.titleTexture} shrink-0 font-sans text-xl font-black tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
        >
          爆笑スタジアム
        </Link>

        <div className="flex min-w-0 items-center gap-1.5">
          {/* 2026-08-28: 「名前を10文字にしても...で切れず見れるように」の要望で、
              長い名前ほど自動的にフォントサイズを一段階ずつ落として省略されないようにする。 */}
          {displayName && (
            <span className={`min-w-0 truncate text-[var(--muted-on-dark)] ${nameSizeClass(displayName)}`}>
              {displayName}
            </span>
          )}

          <NotificationBell />
          <SoundSettingsToggle />

          {/*
            参考デザインはタイトル＋名前のみのシンプルな構成のため、
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
                ログイン
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
