"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import LiveStageBackdrop from "@/components/live-demo/LiveStageBackdrop";
import ScoreButtons from "@/components/live-demo/ScoreButtons";
import ScoringPhysicsBoard, { type ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";
import StageHeaderBanner from "@/components/live-demo/StageHeaderBanner";
import TimerRing from "@/components/live-demo/TimerRing";
import { sfxCueTracker } from "@/lib/cuePlayback";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { playSfx } from "@/lib/sfx";
import type { ParticipantAvatarInfo } from "@/store/useLiveFollowerStore";
import AnswerRevealCard from "./AnswerRevealCard";
import LaughMarkOverlay from "./LaughMarkOverlay";
import StageCharactersView from "./StageCharactersView";
import TsukkomiDanmakuOverlay from "./TsukkomiDanmakuOverlay";

// 客席（舞台に出ていない人）の回答・採点画面の表示だけを担う共用部品。本番(AudienceAnsweringView)・
// 体験版/撮影モード(AudienceScreen)はどちらもこれへpropsを渡すだけで、Supabase・本番ストア・
// デモストアには依存しない。本番かデモかをここで判定して別のJSXを出すことはしない。
//
// 回答送信音(answerSubmit)の合図はStageAnsweringPresentationと同じ仕組み（cueIdベースの
// sfxCueTracker）を使い、1回だけ鳴らす。

const EMPTY_AVATARS: Record<string, ParticipantAvatarInfo> = {};

export interface AudienceAnsweringTiming {
  answerMs: number;
  judgeMs: number;
  revealGraceMs: number;
  ballPopPauseMs: number;
}

export interface AudienceDisplayedAnswer {
  id: string;
  participantId: string;
  authorName: string;
  body: string;
  resolved: boolean;
}

export interface AudienceAnsweringPresentationProps {
  topicBody: string;
  roundLabel: string;
  maxBalls: number;
  scoreEvents: ScoreEvent[];
  boardResolved: boolean;
  confirmedPerfect: boolean | null;
  boardRoundKey: string | null;
  timing: AudienceAnsweringTiming;

  answeringRemainingMs: number;
  answeringPaused: boolean;
  pausedLabel?: string;

  stageMembers: { id: string; name: string }[];
  myParticipantId: string;
  participantAvatars?: Record<string, ParticipantAvatarInfo>;
  activeParticipantId: string | null;
  revealPendingParticipantId: string | null;
  seatScores: Record<string, number>;

  displayedAnswer: AudienceDisplayedAnswer | null;
  judgingRemainingMs: number;
  judgingSyncing?: boolean;
  answerSubmitCue: { cueId: string } | null;

  canJudge: boolean;
  myScore: 0 | 1 | 2 | 3 | null;
  judgingDisabled: boolean;
  onScore: (points: 0 | 1 | 2 | 3) => void;
  scoreErrorMessage: string | null;

  judgingActive: boolean;
  tsukkomiTemplates: readonly string[];
  onTsukkomi: (kind: "stamp" | "clap", content: string) => void;
}

export default function AudienceAnsweringPresentation({
  topicBody,
  roundLabel,
  maxBalls,
  scoreEvents,
  boardResolved,
  confirmedPerfect,
  boardRoundKey,
  timing,
  answeringRemainingMs,
  answeringPaused,
  pausedLabel,
  stageMembers,
  myParticipantId,
  participantAvatars = EMPTY_AVATARS,
  activeParticipantId,
  revealPendingParticipantId,
  seatScores,
  displayedAnswer,
  judgingRemainingMs,
  judgingSyncing,
  answerSubmitCue,
  canJudge,
  myScore,
  judgingDisabled,
  onScore,
  scoreErrorMessage,
  judgingActive,
  tsukkomiTemplates,
  onTsukkomi,
}: AudienceAnsweringPresentationProps) {
  useEffect(() => {
    if (!answerSubmitCue) return;
    sfxCueTracker.once(answerSubmitCue.cueId, () => playSfx("answerSubmit"));
  }, [answerSubmitCue]);

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;
  const [showTsukkomiWords, setShowTsukkomiWords] = useState(false);

  return (
    <ScreenShell className="!items-stretch !justify-center !overflow-visible !px-3 !pt-1 !pb-1">
      <LiveStageBackdrop variant="neon2" />
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_auto_minmax(140px,1fr)_auto] gap-1 overflow-visible">
        <StageHeaderBanner variant="neon2" />
        <div className="relative z-20 -mt-[22px] flex min-h-0 flex-col items-center gap-2 overflow-visible sm:-mt-[32px]">
          <div
            ref={boardBoxRef}
            className="relative flex w-full justify-center"
            style={{ height: boardFitted ? boardFitted.height : "38vh" }}
          >
            <div
              className="relative"
              style={boardFitted ? { width: boardFitted.width, height: boardFitted.height } : undefined}
            >
              <ScoringPhysicsBoard
                variant="neon2"
                topicBody={topicBody}
                roundLabel={roundLabel}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={boardResolved}
                confirmedPerfect={confirmedPerfect}
                resolvedPopDelayMs={timing.revealGraceMs + timing.ballPopPauseMs}
                roundKey={boardRoundKey}
              />
              <div className="absolute right-8 top-5 flex flex-col items-center gap-0.5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  totalMs={timing.answerMs}
                  paused={answeringPaused}
                  size={40}
                  darkText
                  palette="neon2"
                />
                {answeringPaused && (
                  <span className="whitespace-nowrap rounded bg-black/40 px-1 text-[9px] font-bold text-white/90">
                    {pausedLabel ?? "審査中…"}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* 舞台視点には「残り○回」の行があり、客席視点にはそれがない。この行の有無で2行目の
              高さが変わると3行目(舞台)の位置が視点間でズレるため、同じ高さの不可視スペーサーで揃える。 */}
          <div className="invisible flex items-center gap-2" aria-hidden>
            <span className="h-4 w-4 rounded-full border border-[#3b5bff]" />
            <span className="ml-1 font-sans text-xs">残り0回</span>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          <div className="relative flex w-full flex-col items-center">
            <StageCharactersView
              members={stageMembers}
              myParticipantId={myParticipantId}
              participantAvatars={participantAvatars}
              activeParticipantId={activeParticipantId}
              revealPendingParticipantId={revealPendingParticipantId}
              scoreReveals={seatScores}
            />
          </div>
          <AnimatePresence>
            {displayedAnswer && (
              <motion.div
                key="judging"
                initial={{ opacity: 0, scale: 0.9, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -16 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 px-2 py-0"
              >
                <div className="flex h-full w-full flex-col items-center gap-2">
                  <div className="w-full min-h-[100px] flex-1">
                    <AnswerRevealCard
                      authorName={truncateLiveDisplayName(displayedAnswer.authorName)}
                      answerBody={displayedAnswer.body}
                      fillHeight
                      scaleUp={false}
                      hideAuthorName
                    />
                  </div>
                  <ScoreButtons
                    isJudge={canJudge}
                    myScore={myScore}
                    resolved={displayedAnswer.resolved}
                    disabled={judgingDisabled}
                    onScore={onScore}
                    remainingMs={judgingRemainingMs}
                    syncing={judgingSyncing}
                    totalMs={timing.judgeMs}
                    scaleUp={false}
                  />
                  {scoreErrorMessage && <p className="font-sans text-xs text-[#ff3b5b]">{scoreErrorMessage}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AudienceLayer
            fixedBottomPx={-45}
            zIndex={5}
            imageSrc="/images/live2/audience-2-crop.png"
            fixedRenderWidthPx={614}
            fixedRenderHeightPx={216}
            imageClassName="brightness-150 contrast-125"
          />
          <LaughMarkOverlay />
        </div>

        {showTsukkomiWords ? (
          <div className="relative z-10 mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                setShowTsukkomiWords(false);
              }}
              disabled={judgingActive}
              className="whitespace-nowrap rounded-xl border-2 border-[#7ab2ff] bg-[#0d0a1a] px-3 py-2 font-sans text-sm font-bold text-[#7ab2ff] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:text-white/70"
            >
              ツッコミ
            </button>
            {tsukkomiTemplates.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => {
                  playSfx("buttonPress");
                  onTsukkomi("stamp", word);
                }}
                disabled={judgingActive}
                className="whitespace-nowrap rounded-full border border-[#3b5bff] bg-[#3b5bff]/20 px-3 py-2 font-sans text-xs font-bold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {word}
              </button>
            ))}
          </div>
        ) : (
          <div className="relative z-10 mx-auto flex w-full max-w-xl items-center justify-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                setShowTsukkomiWords(true);
              }}
              disabled={judgingActive}
              className="flex-1 whitespace-nowrap rounded-xl border-2 border-[#3b5bff] bg-[#3b5bff] px-2 py-3 font-sans text-base font-bold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/70"
            >
              ツッコミ
            </button>
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                onTsukkomi("stamp", "爆笑");
              }}
              disabled={judgingActive}
              className="flex-1 whitespace-nowrap rounded-xl border-2 border-[#ff3b5b] bg-[#ff3b5b] px-2 py-3 font-sans text-base font-bold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/70"
            >
              爆笑
            </button>
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                onTsukkomi("clap", "👏");
              }}
              disabled={judgingActive}
              className="flex-1 whitespace-nowrap rounded-xl border-2 border-[#ffcf4a] bg-[#ffcf4a] px-2 py-3 font-sans text-base font-bold text-[#1a1a3a] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/70"
            >
              拍手
            </button>
          </div>
        )}
      </div>

      <TsukkomiDanmakuOverlay />
    </ScreenShell>
  );
}
