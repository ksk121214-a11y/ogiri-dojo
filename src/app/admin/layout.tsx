"use client";

import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

// 運営者専用管理画面(/admin配下)の共通ガード。role==='admin'（DojoProfile.isHost）
// のユーザーだけが開ける。/live/host/page.tsxと同じ判定ロジックを踏襲している
// （どちらも同じprofile.isHostを見るため、二重実装だが挙動は完全に一致する）。
// サーバー側の保護は各テーブルのRLS（is_host()）・RPCが別途担っており、
// ここはあくまでUI表示のガードという位置づけ。
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);

  if (authLoading || profileLoading) {
    return <CenterMessage>読み込み中…</CenterMessage>;
  }

  if (!authUser) {
    return (
      <CenterMessage>
        <p className="mb-4">管理画面を開くにはXログインが必要です。</p>
        <button
          type="button"
          onClick={() => signInWithX()}
          className="rounded-full bg-dojo-ink px-5 py-2.5 font-sans text-sm font-bold text-dojo-washi-white"
        >
          Xでログイン
        </button>
      </CenterMessage>
    );
  }

  if (!profile?.isHost) {
    return <CenterMessage>この画面を開く権限がありません（運営者アカウントではありません）。</CenterMessage>;
  }

  return <>{children}</>;
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center px-4 text-center font-sans text-sm text-dojo-dark-brown">
      {children}
    </div>
  );
}
