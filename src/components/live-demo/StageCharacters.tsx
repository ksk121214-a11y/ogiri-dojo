"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";

import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { getParticipantName } from "@/lib/liveDemoSelectors";
import { BASE_PATH } from "@/lib/basePath";
import type { LiveDemoState } from "@/store/useLiveDemoStore";

// 中央の「舞台」ビジュアルエリア：組の回答者を横並びに配置し、
// 審査サイクルに乗っている1人だけスポットライトを浴びて前に出る（デザイン方針§4.3）。
// 舞台（回答者）画面・客席（観客）画面のどちらからも共通で使う。
// design-preview-2（隠しURL /live/design-preview-2）の見た目に合わせ、舞台の
// 丸い土台は背景（LiveStageBackdropのstage-bg-2.png）側に描き込まれているため、
// ここでは演壇・アイコンの列だけを画面下部に固定表示する（fixed）。
export default function StageCharacters({
  state,
  memberIds,
  activeParticipantId,
  revealPendingParticipantId = null,
  scoreRevealParticipantId = null,
  scoreRevealValue = null,
  compact = false,
}: {
  state: LiveDemoState;
  memberIds: string[];
  activeParticipantId: string | null;
  // 送信直後の「一呼吸」中（まだ回答フリップは出ていない）の対象者。この間は
  // 回答フリップがまだ画面を覆っていないため、回答席の光る演出が実際に見える
  // 唯一のタイミング（審査中は回答フリップが回答席を覆い隠すため見えない）。
  revealPendingParticipantId?: string | null;
  // 採点が確定した直後、その人の回答席の真ん中に得点をデジタル表示するための対象者・点数。
  // nullなら何も表示しない（呼び出し側が確定を検知しない限り渡さない＝既定は今まで通り）。
  scoreRevealParticipantId?: string | null;
  scoreRevealValue?: number | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-end justify-center ${
        compact
          ? "relative w-full max-w-4xl gap-x-1 gap-y-1 px-2 pb-1"
          : "fixed inset-x-0 bottom-[calc(19vh+20px)] z-10 mx-auto max-w-4xl gap-x-0 px-1 pb-3 sm:bottom-[19vh]"
      }`}
    >
      {memberIds.map((id) => {
        const isActive = id === activeParticipantId;
        const isGlowingSeat = isActive || id === revealPendingParticipantId;
        const isMe = id === MY_PARTICIPANT_ID;
        const name = getParticipantName(state, id);
        const showScore = id === scoreRevealParticipantId && scoreRevealValue !== null;
        return (
          <motion.div
            key={id}
            className={`relative flex flex-col items-center ${
              compact ? "w-12 sm:w-14" : "w-[min(19vw,95px)] -translate-y-[58px]"
            }`}
            style={{ zIndex: isGlowingSeat || showScore ? 30 : 20 }}
          >
            {compact ? (
              <div className="relative z-10 h-8 w-8 sm:h-10 sm:w-10">
                <Image
                  src={`${BASE_PATH}/images/live2/avatar-2-crop.png`}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-contain"
                />
              </div>
            ) : (
              <>
                <div
                  className="relative aspect-[164/194] w-full"
                  style={
                    isGlowingSeat
                      ? {
                          filter:
                            "drop-shadow(0 0 20px rgba(160,210,255,1)) drop-shadow(0 0 44px rgba(59,91,255,1)) drop-shadow(0 0 72px rgba(59,91,255,0.8))",
                        }
                      : undefined
                  }
                >
                  {isGlowingSeat && (
                    <motion.div
                      className="pointer-events-none absolute inset-0 -z-10 rounded-[30%]"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(210,228,255,0.95), rgba(59,91,255,0.65) 55%, transparent 78%)",
                      }}
                      animate={{ opacity: [0.65, 1, 0.65], scale: [1, 1.1, 1] }}
                      transition={{ duration: 0.85, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  <Image
                    src={`${BASE_PATH}/images/live2/podium-2-crop.png`}
                    alt=""
                    fill
                    sizes="150px"
                    className="object-contain"
                  />
                  <AnimatePresence>
                    {showScore && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={{ type: "spring", stiffness: 260, damping: 16 }}
                        className="pointer-events-none absolute left-1/2 top-[48%] z-40 -translate-x-1/2 -translate-y-1/2"
                      >
                        <span className="font-sans text-3xl font-black tabular-nums text-black sm:text-5xl">
                          {scoreRevealValue}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="absolute left-1/2 top-0 z-10 w-[88%] -translate-x-1/2 -translate-y-[92%]">
                  <p
                    className={`absolute -top-3 left-1/2 z-20 max-w-full -translate-x-1/2 whitespace-nowrap truncate text-center font-sans text-xs ${
                      isActive ? "font-bold text-[#7ab2ff]" : "text-white/70"
                    }`}
                  >
                    {name}
                    {isMe ? "（あなた）" : ""}
                  </p>
                  <div
                    className="relative aspect-square w-full"
                    style={
                      isActive
                        ? { filter: "drop-shadow(0 0 14px rgba(122,178,255,0.85))" }
                        : undefined
                    }
                  >
                    <Image
                      src={`${BASE_PATH}/images/live2/avatar-2-crop.png`}
                      alt=""
                      fill
                      sizes="150px"
                      className="object-contain"
                    />
                  </div>
                </div>
              </>
            )}
            {isActive && !compact && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute -top-8 z-20 whitespace-nowrap rounded-full bg-[#3b5bff] px-2 py-0.5 font-sans text-[9px] font-bold text-white"
              >
                審査中
              </motion.span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
