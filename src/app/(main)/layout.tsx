"use client";

import { usePathname } from "next/navigation";

import AppHeader from "@/components/app/AppHeader";
import DisplayNameSetupModal from "@/components/app/DisplayNameSetupModal";

// ホーム/ガチャ/ショップ/ランキング/マイページ共通のレイアウト（簡易ナビゲーション付き）。
// ライブ体験（/live-demo）はフルスクリーン演出のためこのグループの外に置く。
// 2026-08-27：ホーム（/）だけは地下ライブハウス風の専用ヘッダー・下部ナビ（StadiumAppShell）を
// 自前で持つようリデザインしたため、既存の共通AppHeader／余白付きmainはホーム以外にだけ適用する
// （ルーティング自体は変えず、チラミングだけをパス判定で出し分けている）。
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return (
      <>
        {children}
        <DisplayNameSetupModal />
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-dojo-tatami-cream">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <DisplayNameSetupModal />
    </div>
  );
}
