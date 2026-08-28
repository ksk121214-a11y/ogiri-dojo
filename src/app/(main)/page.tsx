"use client";

import AccountSummary from "@/components/home/AccountSummary";
import BottomNavigation from "@/components/home/BottomNavigation";
import DarkIndieHero from "@/components/home/DarkIndieHero";
import JoinLiveButton from "@/components/home/JoinLiveButton";
import NextLiveTicket from "@/components/home/NextLiveTicket";
import StadiumAppShell from "@/components/home/StadiumAppShell";
import { CURRENT_LIVE, CURRENT_LIVE_RECEPTION } from "@/data/liveScheduleData";

// ホーム画面：地下の小さなお笑いライブハウス・インディーズイベントのフライヤーをイメージした
// トンマナにリデザイン（2026-08-27）。認証・状態管理・ライブ参加処理（/liveへの遷移）は
// 従来のまま変更せず、見た目と構成要素だけをStadium*コンポーネント群に置き換えている。
// 2026-08-28: 「遊び方」はモーダル（TutorialModal）を開く方式から専用ページ（/how-to-play）へ
// 遷移する方式に変更したため、ここで持っていたtutorialOpenの状態管理は不要になった。
// 2026-08-28（追記）：「次回ライブ」も専用ページ（/live-schedule）を新設したため、
// 日付データはsrc/data/liveScheduleData.tsに一本化し、こことページ側で共有している。
export default function Home() {
  return (
    <StadiumAppShell bottomNav={<BottomNavigation />}>
      <DarkIndieHero />

      <div id="next-live" className="scroll-mt-4">
        <NextLiveTicket live={{ ...CURRENT_LIVE, reception: CURRENT_LIVE_RECEPTION }} />
      </div>

      <JoinLiveButton />

      <AccountSummary />
    </StadiumAppShell>
  );
}
