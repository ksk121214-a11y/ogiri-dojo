"use client";

import AccountSummary from "@/components/home/AccountSummary";
import BottomNavigation from "@/components/home/BottomNavigation";
import DarkIndieHero from "@/components/home/DarkIndieHero";
import JoinLiveButton from "@/components/home/JoinLiveButton";
import NextLiveTicket, { type NextLiveInfo } from "@/components/home/NextLiveTicket";
import StadiumAppShell from "@/components/home/StadiumAppShell";

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
// 2026-08-28: 「遊び方」はモーダル（TutorialModal）を開く方式から専用ページ（/how-to-play）へ
// 遷移する方式に変更したため、ここで持っていたtutorialOpenの状態管理は不要になった。
export default function Home() {
  return (
    <StadiumAppShell bottomNav={<BottomNavigation />}>
      <DarkIndieHero />

      <div id="next-live" className="scroll-mt-4">
        <NextLiveTicket live={NEXT_LIVE} />
      </div>

      <JoinLiveButton />

      <AccountSummary />
    </StadiumAppShell>
  );
}
