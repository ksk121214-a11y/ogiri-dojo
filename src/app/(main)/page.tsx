"use client";

import SlowLoadingBanner from "@/components/app/SlowLoadingBanner";
import AccountSummary from "@/components/home/AccountSummary";
import BottomNavigation from "@/components/home/BottomNavigation";
import DarkIndieHero from "@/components/home/DarkIndieHero";
import JoinLiveButton from "@/components/home/JoinLiveButton";
import NextLiveTicket from "@/components/home/NextLiveTicket";
import StadiumAppShell from "@/components/home/StadiumAppShell";
import { useLiveJoinFlow } from "@/components/home/useLiveJoinFlow";
import { formatScheduleReception, toScheduleEntryDate } from "@/lib/liveDateFormat";
import { useLiveSchedulePlan } from "@/lib/useLiveSchedulePlan";
import { useAuthStore } from "@/store/useAuthStore";

// ホーム画面：地下の小さなお笑いライブハウス・インディーズイベントのフライヤーをイメージした
// トンマナにリデザイン（2026-08-27）。認証・状態管理・ライブ参加処理（/liveへの遷移）は
// 従来のまま変更せず、見た目と構成要素だけをStadium*コンポーネント群に置き換えている。
// 2026-08-28: 「遊び方」はモーダル（TutorialModal）を開く方式から専用ページ（/how-to-play）へ
// 遷移する方式に変更したため、ここで持っていたtutorialOpenの状態管理は不要になった。
// 2026-08-28（追記）：「次回ライブ」も専用ページ（/live-schedule）を新設したため、
// 日付データはsrc/data/liveScheduleData.tsに一本化し、こことページ側で共有している。
// 2026-08-29（追記）：「参加する」成功時に半券が切り離される演出のため、参加フローの
// 状態管理をuseLiveJoinFlowに切り出し、NextLiveTicket・JoinLiveButton両方に配る。
// 2026-08-30（追記）：運営者専用管理画面の追加（第2段階）。日付・番号のハードコード
// 定数(src/data/liveScheduleData.ts)をやめ、useLiveSchedule()経由でlivesテーブルの
// 実データを表示するようにした。
// 2026-08-30（さらに追記）：「前回/今回/次回/ホーム次回」の自動判定(useLiveSchedule)を
// やめ、運営が/admin/scheduleで手動割り当てるlive_schedule_entries（実際のゲーム進行用
// livesテーブルとは別の、表示専用データ）から取得するように変更した。
export default function Home() {
  const { status, error, handleJoinClick, handleAnimationEnd } = useLiveJoinFlow();
  const stubVisible = status !== "joined";
  const isDetaching = status === "detaching";
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const { homeUpcoming } = useLiveSchedulePlan();

  return (
    <StadiumAppShell bottomNav={<BottomNavigation />}>
      <SlowLoadingBanner isLoading={authLoading} />
      <DarkIndieHero />

      <div id="next-live" className="scroll-mt-4">
        <NextLiveTicket
          live={
            homeUpcoming
              ? {
                  ...toScheduleEntryDate(homeUpcoming.event_date, homeUpcoming.start_time),
                  ticketNo: homeUpcoming.ticket_no,
                  reception: formatScheduleReception(homeUpcoming.reception_time),
                }
              : null
          }
          stubVisible={stubVisible}
          isDetaching={isDetaching}
          onDetachAnimationEnd={handleAnimationEnd}
        />
      </div>

      <JoinLiveButton status={status} error={error} onClick={handleJoinClick} />

      <AccountSummary />

      {/* 2026-09-06:「X連携は本人確認にのみ使う」旨の補足文言。未ログイン時（authLoadingが
          終わっていて、かつ未ログインと確定した場合）だけ、名前カードのすぐ下に控えめに表示する。
          ログイン中はAccountSummary側で名前・段位が出るため、この案内自体が不要になる。 */}
      {/* 2026-09-07（不具合修正）：ホーム画面本体の背景はStadiumAppShellのdark面
          （contentThemeを渡していないためデフォルトのdark）で、--inkはgrainPaper等
          「明るいカード内」専用の濃色トークン（#171513）のため、ページ地の上に直接
          置くと暗い背景に暗い文字でほぼ見えなくなっていた。ページ地に直接置く控えめな
          文字は他の同ページコンポーネント（StadiumHeader等）と同じ--muted-on-dark
          （明るい背景色向けのトーンダウン済みの色）を使う。 */}
      {!authLoading && !authUser && (
        <p className="text-center font-sans text-[11px] leading-relaxed text-[var(--muted-on-dark)]">
          X連携はログイン確認にのみ使用します。
          <br />
          Xへの投稿・DM、タイムラインの取得・保存は行いません。
        </p>
      )}
    </StadiumAppShell>
  );
}
