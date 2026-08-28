"use client";

import { useState } from "react";

import MyProfileEditModal from "@/components/app/MyProfileEditModal";
import MyStatsModal from "@/components/app/MyStatsModal";
import TutorialModal from "@/components/app/TutorialModal";
import BottomNavigation from "@/components/home/BottomNavigation";
import MyProfileTicket from "@/components/home/MyProfileTicket";
import StadiumAppShell from "@/components/home/StadiumAppShell";
import SnsFeedSection from "@/components/sns/SnsFeedSection";

// マイページ：自分の演者情報（アイコン・名前・一言コメント）と、
// 寄合帳（SNS）のフィードを1ページに統合したもの。
// 段位・ポイント・表彰実績は情報量が多いため演者名カード内の「段位・実績を見る」ボタンから
// モーダルで見る形にし、常時表示するのは名前まわりとフォロー数・寄合帳だけに絞っている
// （ガチャが無いため装備中・所有コレクションのセクションは廃止）。
//
// 2026-08-28: ホームと同じ地下ライブハウス風のトンマナ（StadiumAppShell）に統一。
// ヘッダー・下部ナビはホームと共通のコンポーネントをそのまま再利用し、本文の背景だけ
// 茶色いクラフト紙（contentTheme="kraft"）に切り替えている。演者名カードも
// 「次回ライブ」チケットと同じ切り欠き付きチケットのデザイン言語（MyProfileTicket）に揃えた。
export default function MyPage() {
  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  return (
    <>
      <StadiumAppShell
        contentTheme="kraft"
        bottomNav={<BottomNavigation onHowToPlay={() => setTutorialOpen(true)} />}
      >
        <MyProfileTicket onOpenStats={() => setStatsOpen(true)} onOpenEdit={() => setEditOpen(true)} />

        <div>
          <div className="flex items-center gap-3">
            <h2 className="shrink-0 font-sans text-2xl font-black text-[var(--ink)]">寄合帳</h2>
            <div className="h-px flex-1 bg-[var(--ink)]/20" aria-hidden />
          </div>
          <p className="mt-1.5 font-sans text-xs text-[var(--ink)]/70">
            道場の仲間たちが出したお題に回答して、いいねやツッコミを送り合う簡易版SNS（ダミーデータ）
          </p>
        </div>

        <SnsFeedSection variant="stadium" />
      </StadiumAppShell>

      <MyStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      {editOpen && <MyProfileEditModal onClose={() => setEditOpen(false)} />}
      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </>
  );
}
