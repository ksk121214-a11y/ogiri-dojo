"use client";

import ScreenShell from "@/components/live-demo/ScreenShell";
import TimerRing from "@/components/live-demo/TimerRing";
import { getLiveRoomTiming } from "@/data/liveRoomTiming";
import AudienceJoinPanel from "@/components/live-room/AudienceJoinPanel";
import { answeringRemaining } from "@/lib/liveRemaining";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// まだ参加登録していない人（観客参加の操作を経ずに進行中のライブへ来た人、または自動参加に
// 失敗した人）へ見せる待機画面。お題・残り時間の下（中央付近）に、明確な観客参加ボタンを置く。
// 観客参加ボタンを押した通常フローでは表示しない（参加登録完了まで「観客席へ入場中…」）。
export default function AudienceJoinPrompt() {
  const live = useLiveFollowerStore((s) => s.live);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const clock = useServerClockState(150);

  const remaining = live ? answeringRemaining(live, clock) : { ms: 0, syncing: false };

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-widest text-white/70">
        {live?.current_phase === "topic_reveal" ? "お題発表" : "回答受付中"}
      </p>
      {currentTopic && (
        <p className="mt-4 w-full max-w-xl break-words px-2 font-sans font-bold text-lg text-[#ffcf4a] sm:text-xl">
          {currentTopic.body}
        </p>
      )}
      {live?.current_phase === "answering" && (
      <div className="mt-8">
        <TimerRing
          remainingMs={remaining.ms}
          syncing={remaining.syncing}
          totalMs={getLiveRoomTiming(live?.timing_profile).answerMs}
          paused={!!live?.answering_paused}
          size={56}
          palette="neon2"
        />
      </div>
      )}
      <p className="mt-10 max-w-xs text-center font-sans text-sm text-white/80">
        観客として参加すると、この場で観戦できます。
      </p>
      <div className="mt-5 flex w-full justify-center pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AudienceJoinPanel />
      </div>
    </ScreenShell>
  );
}
