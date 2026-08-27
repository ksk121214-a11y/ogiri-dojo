"use client";

import { useState } from "react";

import AccountSummary from "@/components/home/AccountSummary";
import BottomNavigation from "@/components/home/BottomNavigation";
import DarkIndieHero from "@/components/home/DarkIndieHero";
import JoinLiveButton from "@/components/home/JoinLiveButton";
import NextLiveTicket, { type NextLiveInfo } from "@/components/home/NextLiveTicket";
import StadiumAppShell from "@/components/home/StadiumAppShell";
import TutorialModal from "@/components/app/TutorialModal";

// ダミーの次回ライブ開催予定（L0 相当）
const NEXT_LIVE: NextLiveInfo = {
  ticketNo: "#0720",
  year: "2026",
  month: "7",
  day: "20",
  weekday: "月",
  time: "21:00",
  reception: "20:55〜（定刻+5分まで）",
};

// ホーム画面：地下の小さなお笑いライブハウス・インディーズイベントのフライヤーをイメージした
// トンマナにリデザイン（2026-08-27）。認証・状態管理・ライブ参加処理（/liveへの遷移）は
// 従来のまま変更せず、見た目と構成要素だけをStadium*コンポーネント群に置き換えている。
export default function Home() {
  const [tutorialOpen, setTutorialOpen] = useState(false);

  return (
    <>
      <StadiumAppShell bottomNav={<BottomNavigation onHowToPlay={() => setTutorialOpen(true)} />}>
        <DarkIndieHero onHowToPlay={() => setTutorialOpen(true)} />

        <div id="next-live" className="scroll-mt-4">
          <NextLiveTicket live={NEXT_LIVE} />
        </div>

        <JoinLiveButton />

        <AccountSummary />
      </StadiumAppShell>

      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </>
  );
}
