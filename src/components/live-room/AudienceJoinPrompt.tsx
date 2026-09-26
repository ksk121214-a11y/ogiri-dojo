"use client";

import ScreenShell from "@/components/live-demo/ScreenShell";
import TimerRing from "@/components/live-demo/TimerRing";
import { getLiveRoomTiming } from "@/data/liveRoomTiming";
import { answeringRemaining } from "@/lib/liveRemaining";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 回答受付中(answering)に、まだ参加登録していない人（観客として途中参加しようと
// している人）へ見せる、没入画面（ダーク・ネオン配色）の待機画面。
// AudienceAnsweringView自体は「採点する自分」を前提にした複雑な演出（採点ボード・
// 舞台演出・タイミング調整）を多く抱えており、参加登録前の状態まで対応させると
// 既存のライブ進行ロジックを壊すリスクがあるため手を入れず、お題と残り時間だけを
// 見せるシンプルな専用画面として別に用意する。画面下のAudienceJoinButtonから
// 参加登録すると、次の再描画で自動的にAudienceAnsweringViewへ切り替わる。
export default function AudienceJoinPrompt() {
  const live = useLiveFollowerStore((s) => s.live);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const clock = useServerClockState(150);

  const remaining = live ? answeringRemaining(live, clock) : { ms: 0, syncing: false };

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-widest text-white/60">回答受付中</p>
      {currentTopic && (
        <p className="mt-4 w-full max-w-xl break-words px-2 font-sans font-bold text-lg text-[#ffcf4a] sm:text-xl">
          {currentTopic.body}
        </p>
      )}
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
      <p className="mt-10 max-w-xs text-center font-sans text-xs text-white/50">
        画面下のボタンから観客として参加すると、この場で観戦できます。
      </p>
    </ScreenShell>
  );
}
