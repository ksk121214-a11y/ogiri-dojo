"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import LiveStageBackdrop from "@/components/live-demo/LiveStageBackdrop";
import ScoreButtons from "@/components/live-demo/ScoreButtons";
import StageHeaderBanner from "@/components/live-demo/StageHeaderBanner";
import ScoringPhysicsBoard, { type ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";
import TimerRing from "@/components/live-demo/TimerRing";
import { TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import { LIVE_ROOM_TIMING, SCORE_REVEAL_DELAY_MS } from "@/data/liveRoomTiming";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { playSfx } from "@/lib/sfx";
import { useTickingNow } from "@/lib/useTickingNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import AnswerRevealCard from "./AnswerRevealCard";
import LaughMarkOverlay from "./LaughMarkOverlay";
import StageCharactersView from "./StageCharactersView";
import TsukkomiDanmakuOverlay from "./TsukkomiDanmakuOverlay";

// ライブ観戦（客席/審査員）画面の実バックエンド版。src/components/live-demo/AudienceScreen.tsxと
// 同じ見た目の考え方だが、useLiveDemoStoreではなく実際のDB/Realtimeを見るuseLiveFollowerStoreを使う。
export default function AudienceAnsweringView() {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const participantAvatars = useLiveFollowerStore((s) => s.participantAvatars);
  const groups = useLiveFollowerStore((s) => s.groups);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const activeAnswer = useLiveFollowerStore((s) => s.activeAnswer);
  const turnAnswers = useLiveFollowerStore((s) => s.turnAnswers);
  const activeAnswerScores = useLiveFollowerStore((s) => s.activeAnswerScores);
  const myScore = useLiveFollowerStore((s) => s.myScore);
  const submitMyScore = useLiveFollowerStore((s) => s.submitMyScore);
  const sendTsukkomi = useLiveFollowerStore((s) => s.sendTsukkomi);

  const now = useTickingNow(150);
  // 表示中の回答のIDと紐づけて持つことで、次の回答に切り替わったら
  // 自動的に(このエフェクト無しで)前の回答へのエラー表示を出さなくなる。
  const [scoreError, setScoreError] = useState<{ answerId: string; message: string } | null>(
    null,
  );
  // ツッコミボタンを押すたびにトグルし、開いている間は爆笑・拍手ボタンの代わりに
  // ツッコミワードの候補を並べる(押しても閉じない。もう一度ツッコミボタンを
  // 押した時だけ閉じて元の3ボタンに戻る)。
  const [showTsukkomiWords, setShowTsukkomiWords] = useState(false);

  // 確定した瞬間も回答カード・採点ボタンを表示し続ける猶予ぶんだけ残す
  // （activeAnswerは確定と同時にnullになるため）。revealGraceMsを明示的に渡し、
  // 玉が弾け始める・得点が出るタイミングと揃える。
  const displayedAnswer = useJudgingDisplay(activeAnswer, turnAnswers, LIVE_ROOM_TIMING.revealGraceMs);

  // 回答フリップが消えたあと(猶予表示が切れたあと)にその人の回答席で見えるように、
  // 回答フリップの猶予より長く持たせる。参加者ID→点数のマップにしている理由・
  // タイマーをuseEffectのクリーンアップで巻き込みキャンセルしない理由は
  // StageAnsweringView.tsxと同じ（確定が立て続けに起きた場合に「点数が出る時と
  // 出ない時がある」不具合になっていたため）。
  const [seatScores, setSeatScores] = useState<Record<string, number>>({});
  const prevActiveIdRef = useRef<string | null>(null);
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const prevId = prevActiveIdRef.current;
    prevActiveIdRef.current = activeAnswer?.id ?? null;
    if (prevId && activeAnswer?.id !== prevId) {
      const resolvedAnswer = turnAnswers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        const participantId = resolvedAnswer.participant_id;
        const value = resolvedAnswer.score_total;
        // 回答フリップが消えて→少し間を置いて→採点ボードの玉が弾けて消え終わる
        // (SCORE_REVEAL_DELAY_MS後)まで待ってから回答席に得点を表示する
        // （StageAnsweringViewと同じ理由・同じ待ち時間）。
        const revealTimer = setTimeout(() => {
          pendingTimersRef.current.delete(revealTimer);
          setSeatScores((prev) => ({ ...prev, [participantId]: value }));
          const hideTimer = setTimeout(() => {
            pendingTimersRef.current.delete(hideTimer);
            setSeatScores((prev) => {
              if (prev[participantId] !== value) return prev;
              const next = { ...prev };
              delete next[participantId];
              return next;
            });
          }, LIVE_ROOM_TIMING.scoreDisplayMs);
          pendingTimersRef.current.add(hideTimer);
        }, SCORE_REVEAL_DELAY_MS);
        pendingTimersRef.current.add(revealTimer);
      }
    }
  }, [activeAnswer, turnAnswers]);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // 採点ボードが表示する「今の1件」は回答フリップ(displayedAnswer)より長く生き続ける必要が
  // あるため、専用のroundIdで別管理する（StageAnsweringViewと同じ理由）。
  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  // レンダー中にstateを調整する公式パターン(useEffectではなくレンダー本体で直接setState)。
  if (activeAnswer?.id && activeAnswer.id !== boardRoundId) {
    setBoardRoundId(activeAnswer.id);
  }
  const boardAnswer = boardRoundId ? turnAnswers.find((a) => a.id === boardRoundId) ?? null : null;
  const spotlightSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (boardRoundId && boardRoundId !== spotlightSeenRef.current) {
      spotlightSeenRef.current = boardRoundId;
      playSfx("spotlightIn");
    }
  }, [boardRoundId]);
  // 回答送信音は誰が送信しても鳴らしたいので、turnAnswersの件数増加を監視する
  // （StageAnsweringViewと同じ理由・同じ仕組み）。
  const answerCountSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (answerCountSeenRef.current !== null && turnAnswers.length > answerCountSeenRef.current) {
      playSfx("answerSubmit");
    }
    answerCountSeenRef.current = turnAnswers.length;
  }, [turnAnswers.length]);

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? activeAnswerScores
            .filter((s) => s.answer_id === boardAnswer.id)
            .map((s) => ({ id: `${s.answer_id}-${s.judge_participant_id}`, points: s.points }))
        : [],
    [activeAnswerScores, boardAnswer],
  );

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

  if (!live || !currentTurn || !currentTopic || !myParticipant) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants
    .filter((p) => p.role === "player" && p.group_id === currentTurn.group_id)
    .map((p) => ({ id: p.id, name: participantNames[p.id] ?? "（名前未設定）" }));

  const activeParticipantId = activeAnswer?.participant_id ?? null;
  // 送信直後・司会がまだ表示していない「一呼吸」中(revealDelayMs)の対象者
  // （StageAnsweringViewと同じ理由・同じ選び方）。
  const revealPendingParticipantId = activeAnswer
    ? null
    : [...turnAnswers]
        .filter((a) => !a.revealed_at)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
        ?.participant_id ?? null;
  const canJudge =
    myParticipant.role === "player" && myParticipant.group_id !== currentTurn.group_id;
  // 2026-09-03:「お題ボードの分母(maxBalls)が回答者と審査員で違って見える」不具合対策。
  // participants一覧から毎回計算するのをやめ、ゲーム開始時にサーバー側で1回だけ
  // 確定させたturns.eligible_judge_count（全クライアント共通）を使う（0049）。
  const maxBalls = Math.max(3, currentTurn.eligible_judge_count * 3);

  const answeringRemainingMs =
    live.answering_paused && live.answering_remaining_ms != null
      ? live.answering_remaining_ms
      : live.phase_deadline
        ? Math.max(0, new Date(live.phase_deadline).getTime() - now)
        : 0;
  const judgingRemainingMs = displayedAnswer?.judging_ends_at
    ? Math.max(0, new Date(displayedAnswer.judging_ends_at).getTime() - now)
    : 0;
  // 時間切れギリギリで押しても、司会側で先に確定してしまい採点が反映されないことがある。
  // 押せてしまうと「変えたのに戻る」ように見えるだけなので、時間切れなら先にボタン自体を止める。
  const judgingTimeUp = judgingRemainingMs <= 0;

  const handleScore = async (points: 0 | 1 | 2 | 3) => {
    if (!displayedAnswer) return;
    const answerId = displayedAnswer.id;
    const result = await submitMyScore(points);
    setScoreError(
      result.ok
        ? null
        : { answerId, message: result.reason ?? "採点できませんでした（時間切れの可能性があります）" },
    );
  };

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
                topicBody={currentTopic.body}
                roundLabel={`第${currentTurn.round}周 ・ ${groupOrder}組目`}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={boardAnswer?.resolved ?? false}
                // 2026-09-03:「満点じゃないのに金になる」不具合対策。確定済みなら
                // DBの確定値(answers.judge_count/top_score_votes)で満点かどうかを
                // 判定し、クライアントローカルなボール数の積み上げに依存しない。
                confirmedPerfect={
                  boardAnswer?.resolved
                    ? boardAnswer.judge_count > 0 && boardAnswer.top_score_votes === boardAnswer.judge_count
                    : null
                }
                resolvedPopDelayMs={LIVE_ROOM_TIMING.revealGraceMs + LIVE_ROOM_TIMING.ballPopPauseMs}
                roundKey={boardRoundId}
              />
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  totalMs={LIVE_ROOM_TIMING.answerMs}
                  paused={live.answering_paused}
                  size={40}
                  darkText
                  palette="neon2"
                />
              </div>
            </div>
          </div>
          {/* 舞台視点には「残り○回」の行があり、客席視点にはそれがない。この行の
              有無で2行目の高さが変わると3行目(舞台)の位置が視点間でズレるため、
              同じ高さの不可視スペーサーで高さだけ揃える(StageAnsweringViewと同じ理由)。 */}
          <div className="invisible flex items-center gap-2" aria-hidden>
            <span className="h-4 w-4 rounded-full border border-[#3b5bff]" />
            <span className="ml-1 font-sans text-xs">残り0回</span>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          {/*
            舞台・アイコンは審査中でも消さず常時表示する。回答カードはその手前に
            absoluteで重ねる「ドカンと出る」演出にし、スペースを奪い合って
            どちらかが消える・縮む構成を避ける。
          */}
          <div className="relative flex w-full flex-col items-center">
            <StageCharactersView
              members={stageMembers}
              myParticipantId={myParticipant.id}
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
                      authorName={truncateLiveDisplayName(
                        participantNames[displayedAnswer.participant_id] ?? "（名前未設定）",
                      )}
                      answerBody={displayedAnswer.body}
                      fillHeight
                      scaleUp={false}
                      hideAuthorName
                    />
                  </div>
                  <ScoreButtons
                    isJudge={canJudge}
                    myScore={myScore as 0 | 1 | 2 | 3 | null}
                    resolved={displayedAnswer.resolved}
                    disabled={judgingTimeUp}
                    onScore={handleScore}
                    remainingMs={judgingRemainingMs}
                    totalMs={LIVE_ROOM_TIMING.judgeMs}
                    scaleUp={false}
                  />
                  {scoreError && scoreError.answerId === displayedAnswer.id && (
                    <p className="font-sans text-xs text-[#ff3b5b]">{scoreError.message}</p>
                  )}
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
              disabled={!!activeAnswer}
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
                disabled={!!activeAnswer}
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
              disabled={!!activeAnswer}
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
              disabled={!!activeAnswer}
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
              disabled={!!activeAnswer}
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
