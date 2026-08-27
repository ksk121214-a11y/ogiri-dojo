"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEMO_TIMING,
  MY_PARTICIPANT_ID,
  SCORE_REVEAL_DELAY_MS,
  TSUKKOMI_TEMPLATES,
} from "@/data/liveDemoData";
import AnswerRevealCard from "@/components/live-room/AnswerRevealCard";
import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { playSfx } from "@/lib/sfx";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import AudienceLayer from "./AudienceLayer";
import LaughMarkOverlay from "./LaughMarkOverlay";
import LiveStageBackdrop from "./LiveStageBackdrop";
import ScoreButtons from "./ScoreButtons";
import ScoringPhysicsBoard, { type ScoreEvent } from "./ScoringPhysicsBoard";
import ScreenShell from "./ScreenShell";
import StageCharacters from "./StageCharacters";
import TimerRing from "./TimerRing";
import StageHeaderBanner from "./StageHeaderBanner";
import TsukkomiDanmakuOverlay from "./TsukkomiDanmakuOverlay";

// ライブ観戦（客席/審査員）画面 L3
// 客席のランダム拍手演出は舞台画面でも同じ客席の熱量が伝わるよう画面共通のpage.tsx側で発生させている（§9）
// 画面はビューポート内に完全固定し（仕様書§4.5・デザイン方針§4.2）、過去の回答一覧は持たず、
// 「今まさに審査されている1件」だけを中央のスポットライトカードで使い捨て表示する。
// お題表示・採点演出はStageScreenと同じくScoringPhysicsBoard + AnswerRevealCard +
// ScoreButtons方式（本番のlive-room・design-preview-2と同じ構成）。
export default function AudienceScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyScore = useLiveDemoStore((s) => s.submitMyScore);
  const sendTsukkomi = useLiveDemoStore((s) => s.sendTsukkomi);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const judging = state.judging;

  const activeAnswer = judging
    ? state.answers.find((a) => a.id === judging.answerId) ?? null
    : null;
  const displayedAnswer = useJudgingDisplay(activeAnswer, state.answers, DEMO_TIMING.revealGraceMs);
  const resolved = judging === null;
  const myScore = displayedAnswer
    ? state.scores.find(
        (s) => s.answerId === displayedAnswer.id && s.judgeParticipantId === MY_PARTICIPANT_ID,
      )?.points ?? null
    : null;
  const judgingRemainingMs = judging
    ? Math.max(0, judging.endsAt - (state.lastTickAt ?? judging.endsAt))
    : 0;

  // 回答フリップが消えたあと(猶予表示が切れたあと)にその人の回答席で見えるように、
  // 回答フリップの猶予(useJudgingDisplayの既定3600ms)より長く持たせる。
  const [seatScore, setSeatScore] = useState<{ participantId: string; value: number } | null>(
    null,
  );
  const prevJudgingIdRef = useRef<string | null>(null);
  // ツッコミボタンを押すたびにトグルし、開いている間は爆笑・拍手ボタンの代わりに
  // ツッコミワードの候補を並べる(押しても閉じない。もう一度ツッコミボタンを
  // 押した時だけ閉じて元の3ボタンに戻る)。
  const [showTsukkomiWords, setShowTsukkomiWords] = useState(false);

  useEffect(() => {
    const prevId = prevJudgingIdRef.current;
    // 「直前どのanswerIdを見ていたか」は、この下の分岐で早期returnしても必ず
    // 更新する（前回、returnより後ろに置いていたせいで最初の1件目より後は
    // 一切更新されず、2件目以降もずっと1件目のスコアを1件目の回答席に出し
    // 続けてしまうバグがあった）。
    prevJudgingIdRef.current = judging?.answerId ?? null;
    if (prevId && judging?.answerId !== prevId) {
      const resolvedAnswer = state.answers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        // 回答フリップが消えて→少し間を置いて→採点ボードの玉が弾けて消え終わる
        // (SCORE_REVEAL_DELAY_MS後)まで待ってから回答席に得点を表示する
        // （StageScreenと同じ理由・同じ待ち時間）。
        const revealTimer = setTimeout(() => {
          setSeatScore({ participantId: resolvedAnswer.participantId, value: resolvedAnswer.scoreTotal });
          setTimeout(() => setSeatScore(null), DEMO_TIMING.scoreDisplayMs);
        }, SCORE_REVEAL_DELAY_MS);
        return () => clearTimeout(revealTimer);
      }
    }
  }, [judging, state.answers]);

  // 採点ボードが表示する「今の1件」は回答フリップ(displayedAnswer)より長く生き続ける必要が
  // あるため、専用のroundIdで別管理する（StageScreenと同じ理由）。
  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  // レンダー中にstateを調整する公式パターン(useEffectではなくレンダー本体で直接setState)。
  if (judging?.answerId && judging.answerId !== boardRoundId) {
    setBoardRoundId(judging.answerId);
  }
  const boardAnswer = boardRoundId ? state.answers.find((a) => a.id === boardRoundId) ?? null : null;
  const spotlightSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (boardRoundId && boardRoundId !== spotlightSeenRef.current) {
      spotlightSeenRef.current = boardRoundId;
      playSfx("spotlightIn");
    }
  }, [boardRoundId]);
  // 回答送信音は誰が送信しても鳴らしたいので、件数の増加を監視する
  // （StageScreenと同じ理由・同じ仕組み）。
  const answerCountSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (answerCountSeenRef.current !== null && state.answers.length > answerCountSeenRef.current) {
      playSfx("answerSubmit");
    }
    answerCountSeenRef.current = state.answers.length;
  }, [state.answers.length]);

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? state.scores
            .filter((s) => s.answerId === boardAnswer.id)
            .map((s) => ({ id: `${s.answerId}-${s.judgeParticipantId}`, points: s.points }))
        : [],
    [state.scores, boardAnswer],
  );

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

  if (!turn || !stageGroup) return null;
  const topicBody = getTopicBody(state, turn.topicId);
  const activeParticipantId = activeAnswer?.participantId ?? null;
  const eligibleJudgeCount = state.participants.filter(
    (p) => !stageGroup.memberIds.includes(p.id),
  ).length;
  const maxBalls = Math.max(3, eligibleJudgeCount * 3);

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
                roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={resolved}
                resolvedPopDelayMs={DEMO_TIMING.revealGraceMs + DEMO_TIMING.ballPopPauseMs}
                roundKey={boardRoundId}
              />
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={state.answeringRemainingMs}
                  totalMs={DEMO_TIMING.answerMs}
                  paused={
                    judging !== null ||
                    state.revealPending !== null ||
                    (state.lastTickAt ?? 0) < state.revealGateUntil
                  }
                  size={40}
                  darkText
                  palette="neon2"
                />
              </div>
            </div>
          </div>
          {/* 舞台視点には「残り○回」の行があり、客席視点にはそれがない。この行の
              有無で2行目の高さが変わると3行目(舞台)の位置が視点間でズレるため、
              同じ高さの不可視スペーサーで高さだけ揃える(design-preview-2と同じ理由)。 */}
          <div className="invisible flex items-center gap-2" aria-hidden>
            <span className="h-4 w-4 rounded-full border border-[#3b5bff]" />
            <span className="ml-1 font-sans text-xs">残り0回</span>
          </div>
        </div>

        {/*
          舞台・アイコンは審査中でも消さず常時表示する。回答フリップはその手前に
          absoluteで重ねる「ドカンと出る」演出にし、スペースを奪い合って
          どちらかが消える・縮む構成を避ける。
        */}
        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          <div className="relative flex w-full flex-col items-center">
            <StageCharacters
              state={state}
              memberIds={stageGroup.memberIds}
              activeParticipantId={activeParticipantId}
              revealPendingParticipantId={state.revealPending?.participantId ?? null}
              scoreRevealParticipantId={seatScore?.participantId ?? null}
              scoreRevealValue={seatScore?.value ?? null}
            />
            {!displayedAnswer && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute -bottom-16 z-20 font-sans text-xs text-white/70"
              >
                次の登壇を待っています……
              </motion.p>
            )}
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
                      authorName={getParticipantName(state, displayedAnswer.participantId)}
                      answerBody={displayedAnswer.body}
                      fillHeight
                      scaleUp={false}
                    />
                  </div>
                  <ScoreButtons
                    isJudge
                    myScore={myScore}
                    resolved={resolved}
                    onScore={submitMyScore}
                    remainingMs={judgingRemainingMs}
                    totalMs={DEMO_TIMING.judgeMs}
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

        {showTsukkomiWords ? (
          <div className="relative z-10 mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                setShowTsukkomiWords(false);
              }}
              disabled={!!judging}
              className="whitespace-nowrap rounded-xl border-2 border-[#7ab2ff] bg-[#0d0a1a] px-3 py-2 font-sans text-sm font-bold text-[#7ab2ff] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:text-white/70"
            >
              ツッコミ
            </button>
            {TSUKKOMI_TEMPLATES.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => {
                  playSfx("buttonPress");
                  sendTsukkomi("stamp", word);
                }}
                disabled={!!judging}
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
              disabled={!!judging}
              className="flex-1 whitespace-nowrap rounded-xl border-2 border-[#3b5bff] bg-[#3b5bff] px-2 py-3 font-sans text-base font-bold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/70"
            >
              ツッコミ
            </button>
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                sendTsukkomi("stamp", "爆笑");
              }}
              disabled={!!judging}
              className="flex-1 whitespace-nowrap rounded-xl border-2 border-[#ff3b5b] bg-[#ff3b5b] px-2 py-3 font-sans text-base font-bold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/70"
            >
              爆笑
            </button>
            <button
              type="button"
              onClick={() => {
                playSfx("buttonPress");
                sendTsukkomi("clap", "👏");
              }}
              disabled={!!judging}
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
