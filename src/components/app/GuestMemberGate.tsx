"use client";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import { isGuestUser } from "@/lib/guestStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { useLoginModalStore } from "@/store/useLoginModalStore";
import { useProfileStore } from "@/store/useProfileStore";

// 会員専用ページ・機能（フォロー中/フォロワー一覧、投稿・操作系UI等）のうち、
// ページ全体を丸ごと差し替えれば済む箇所で使う共通ゲート。
// 2026-09-13（0070ゲスト参加レビュー対応）：ゲスト（profile.isGuest）には
// 中身をそのまま見せず、「ゲスト参加中」＋ログイン導線に差し替える。
// 未ログイン利用者（profileが無い）はここでは弾かない
// （読み取り専用の公開ページと同待遇でよい、という要件のため）。
export default function GuestMemberGate({
  children,
  message = "ゲスト参加中です。ログインするとご利用いただけます。",
}: {
  children: React.ReactNode;
  message?: string;
}) {
  const profile = useProfileStore((s) => s.profile);
  const authUser = useAuthStore((s) => s.user);
  const openLoginModal = useLoginModalStore((s) => s.openLoginModal);

  if (!isGuestUser(authUser, profile)) return <>{children}</>;

  return (
    <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-3 p-8 text-center text-[var(--ink)]`}>
      <p className="font-sans text-sm text-[var(--ink)]/80">{message}</p>
      <button
        type="button"
        onClick={() => openLoginModal({ isGuestSwitch: true })}
        className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} rounded-xl px-6 py-2.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90`}
      >
        ログイン
      </button>
    </div>
  );
}
