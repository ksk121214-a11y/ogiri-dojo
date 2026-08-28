"use client";

import { usePathname } from "next/navigation";

import AppHeader from "@/components/app/AppHeader";
import DisplayNameSetupModal from "@/components/app/DisplayNameSetupModal";

// ホーム/ガチャ/ショップ/ランキング/マイページ共通のレイアウト（簡易ナビゲーション付き）。
// ライブ体験（/live-demo）はフルスクリーン演出のためこのグループの外に置く。
// 2026-08-27：ホーム（/）だけは地下ライブハウス風の専用ヘッダー・下部ナビ（StadiumAppShell）を
// 自前で持つようリデザインしたため、既存の共通AppHeader／余白付きmainはホーム以外にだけ適用する
// （ルーティング自体は変えず、チラミングだけをパス判定で出し分けている）。
// 2026-08-28：マイページ（/mypage）も同じStadiumAppShellを自前で持つようにしたため、
// ここでの出し分けにマイページも加えた。
// 2026-08-28（追記）：「お題を投稿する」「お題に回答する」の各サブページ（/sns/new、
// お題詳細/sns/[topicId]、回答詳細/sns/answers/[answerId]）も旧デザインのまま残っていたため
// 同様にStadium側へ。寄合帳トップ（/sns）自体と演者プロフィール系（/sns/u/...）は
// 現状のナビ（AppHeader）からリンクされておらず旧デザインのまま据え置くため対象外にしている。
// next.config側でtrailingSlash: trueのため実際のpathnameは"/sns"ではなく"/sns/"になる。
// これを考慮せず`startsWith("/sns/")`だけで判定すると寄合帳トップ自身（"/sns/"）まで
// Stadium側に誤って含まれてしまうため、"/sns/"ちょうど（トップ自身）は明示的に除外する。
// 2026-08-28（追記）：下部ナビ「遊び方」をモーダルから専用ページ（/how-to-play）に
// 変更したため、こちらもStadium側に追加。
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isSnsSubPage =
    pathname.startsWith("/sns/") &&
    pathname !== "/sns/" &&
    !pathname.startsWith("/sns/u/");
  const isStadiumPage =
    pathname === "/" ||
    pathname.startsWith("/mypage") ||
    pathname.startsWith("/how-to-play") ||
    isSnsSubPage;

  if (isStadiumPage) {
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
