"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

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

// 回答入力（舞台）画面の表示だけを担う共用部品。本番(StageAnsweringView)・体験版/撮影モード
// (StageScreen)はどちらもこれへpropsを渡すだけで、Supabase・本番ストア・デモストアには
// 依存しない。本番かデモかをここで判定して別のJSXを出すことはしない（違いはすべてpropsで表現する）。
//
// 回答送信音(answerSubmit)は、回答席が光り始めた瞬間を表すanswerSubmitCueが変わるたびに、
// 共通のsfxCueTracker（cueIdで1回だけ再生を保証）を通して1回だけ鳴らす。本番・デモのどちらの
// adapterも、送信者本人の分も含めてこの1本の合図経路だけを使う（二重再生防止はcueId基準）。

const EMPTY_AVATARS: Record<string, ParticipantAvatarInfo> = {};

export interface StageAnsweringTiming {
  answerMs: number;
  judgeMs: number;
  revealGraceMs: number;
  ballPopPauseMs: number;
}

export interface StageDisplayedAnswer {
  id: string;
  participantId: string;
  authorName: string;
  body: string;
  resolved: boolean;
}

export interface StageAnsweringPresentationProps {
  topicBody: string;
  roundLabel: string;
  maxBalls: number;
  scoreEvents: ScoreEvent[];
  boardResolved: boolean;
  confirmedPerfect: boolean | null;
  boardRoundKey: string | null;
  timing: StageAnsweringTiming;

  answeringRemainingMs: number;
  answeringSyncing?: boolean;
  busyWithOthers: boolean;

  stageMembers: { id: string; name: string }[];
  myParticipantId: string;
  participantAvatars?: Record<string, ParticipantAvatarInfo>;
  activeParticipantId: string | null;
  revealPendingParticipantId: string | null;
  seatScores: Record<string, number>;

  displayedAnswer: StageDisplayedAnswer | null;
  judgingRemainingMs: number;
  judgingSyncing?: boolean;

  // 回答席が光り始めた瞬間を表す合図。cueIdが変わるたびに1回だけanswerSubmit音を鳴らす。nullなら何もしない。
  answerSubmitCue: { cueId: string } | null;

  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  overLimit: boolean;
  submitDisabled: boolean;
  myAnswerCount: number;
  maxAnswersPerPlayer: number;
  errorMessage: string | null;
  // 送信成功後にソフトウェアキーボードを閉じるため、呼び出し元がblur()できるようにする参照の橋渡し。
  // 表示部品自身は「いつblurするか」を判断しない（それはadapter側の送信結果が持つ情報）。
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function StageAnsweringPresentation({
  topicBody,
  roundLabel,
  maxBalls,
  scoreEvents,
  boardResolved,
  confirmedPerfect,
  boardRoundKey,
  timing,
  answeringRemainingMs,
  answeringSyncing,
  busyWithOthers,
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
  draft,
  onDraftChange,
  onSubmit,
  overLimit,
  submitDisabled,
  myAnswerCount,
  maxAnswersPerPlayer,
  errorMessage,
  textareaRef,
}: StageAnsweringPresentationProps) {
  useEffect(() => {
    if (!answerSubmitCue) return;
    sfxCueTracker.once(answerSubmitCue.cueId, () => playSfx("answerSubmit"));
  }, [answerSubmitCue]);

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

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
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  syncing={answeringSyncing}
                  totalMs={timing.answerMs}
                  paused={busyWithOthers}
                  size={40}
                  darkText
                  palette="neon2"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          <StageCharactersView
            members={stageMembers}
            myParticipantId={myParticipantId}
            participantAvatars={participantAvatars}
            activeParticipantId={activeParticipantId}
            revealPendingParticipantId={revealPendingParticipantId}
            scoreReveals={seatScores}
          />
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
                    isJudge={false}
                    myScore={null}
                    resolved={displayedAnswer.resolved}
                    remainingMs={judgingRemainingMs}
                    syncing={judgingSyncing}
                    totalMs={timing.judgeMs}
                    scaleUp={false}
                  />
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

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 mx-auto w-full max-w-xl">
          <div className="mb-1.5 flex items-center justify-center gap-1.5">
            {Array.from({ length: maxAnswersPerPlayer }).map((_, i) => (
              <span
                key={i}
                className={`h-3 w-3 rounded-full border border-[#3b5bff] ${
                  i < myAnswerCount ? "bg-[#3b5bff]" : "bg-transparent"
                }`}
              />
            ))}
            <span className="ml-1 font-sans text-xs text-white/70">
              残り{Math.max(0, maxAnswersPerPlayer - myAnswerCount)}回
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            disabled={overLimit}
            placeholder={
              overLimit
                ? "回答できる回数の上限に達しました"
                : busyWithOthers
                  ? "他の回答を審査中です。書きためておけます（送信は少し待ってね）"
                  : "回答を入力……"
            }
            rows={2}
            className="w-full resize-none rounded-xl border-2 border-[#3b5bff]/40 bg-white px-4 py-2.5 font-sans text-lg text-[#1a1a3a] placeholder:text-[#6b6b90] focus:border-[#3b5bff] focus:outline-none disabled:bg-[#e4e6f5] disabled:text-[#8a8ab0] [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-base"
          />
          {errorMessage && <p className="mt-1 font-sans text-xs text-red-400">{errorMessage}</p>}
          <div className="mt-2 flex items-center justify-center gap-3">
            {busyWithOthers && <div className="w-10 shrink-0" aria-hidden />}
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitDisabled}
              className="w-1/2 max-w-[11rem] rounded-xl border-2 border-[#3b5bff] bg-[#3b5bff] px-4 py-2 font-sans text-base font-bold text-white transition hover:bg-[#2947e0] disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/60 [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-sm"
            >
              {busyWithOthers ? "審査中…" : "送信する"}
            </button>
            {busyWithOthers && (
              <TimerRing remainingMs={judgingRemainingMs} syncing={judgingSyncing} totalMs={timing.judgeMs} size={40} palette="neon2" />
            )}
          </div>
        </motion.div>
      </div>

      <TsukkomiDanmakuOverlay />
    </ScreenShell>
  );
}
