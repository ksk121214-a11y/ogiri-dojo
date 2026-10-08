"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AudienceAnsweringPresentation from "@/components/live-room/AudienceAnsweringPresentation";
import type { ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";
import { DEMO_TIMING, MY_PARTICIPANT_ID, SCORE_REVEAL_DELAY_MS, TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import { getCurrentTurn, getStageGroup, getTopicBody } from "@/lib/liveDemoSelectors";
import { eligibleJudgeCountFor, maxBallsFor, perfectFromEligibleJudges } from "@/lib/liveRoomPresentation";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// 客席（舞台に出ていない人の画面）の体験版/撮影モードadapter。表示そのものは
// src/components/live-room/AudienceAnsweringPresentation.tsx（本番・体験版/撮影モード共用）に
// 委ね、ここではローカルの進行ロジック（useLiveDemoStore）からpropsを組み立てる。
export default function AudienceScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyScore = useLiveDemoStore((s) => s.submitMyScore);
  const sendTsukkomi = useLiveDemoStore((s) => s.sendTsukkomi);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const judging = state.judging;
  const now = state.lastTickAt ?? 0;
  const activeAnswer = judging ? state.answers.find((a) => a.id === judging.answerId) ?? null : null;
  const displayedAnswer = useJudgingDisplay(activeAnswer, state.answers, DEMO_TIMING.revealGraceMs);
  const resolved = judging === null;
  const myScore = displayedAnswer
    ? state.scores.find((s) => s.answerId === displayedAnswer.id && s.judgeParticipantId === MY_PARTICIPANT_ID)?.points ??
      null
    : null;
  const judgingRemainingMs = judging ? Math.max(0, judging.endsAt - now) : 0;
  const judgingTimeUp = judging !== null && judgingRemainingMs <= 0;
  // 実ライブの「審査中…」表示と同じく、審査・一呼吸・点数表示の間は時間が止まって見える
  const paused = judging !== null || state.revealPending !== null || now < state.revealGateUntil;

  const [seatScores, setSeatScores] = useState<Record<string, number>>({});
  const prevJudgingIdRef = useRef<string | null>(null);
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const prevId = prevJudgingIdRef.current;
    prevJudgingIdRef.current = judging?.answerId ?? null;
    if (prevId && judging?.answerId !== prevId) {
      const resolvedAnswer = state.answers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        const participantId = resolvedAnswer.participantId;
        const value = resolvedAnswer.scoreTotal;
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
          }, DEMO_TIMING.scoreDisplayMs);
          pendingTimersRef.current.add(hideTimer);
        }, SCORE_REVEAL_DELAY_MS);
        pendingTimersRef.current.add(revealTimer);
      }
    }
  }, [judging, state.answers]);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  if (judging?.answerId && judging.answerId !== boardRoundId) {
    setBoardRoundId(judging.answerId);
  }
  const boardAnswer = boardRoundId ? state.answers.find((a) => a.id === boardRoundId) ?? null : null;
  const pendingCue = state.revealPending;

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? state.scores
            .filter((s) => s.answerId === boardAnswer.id)
            .map((s) => ({ id: `${s.answerId}-${s.judgeParticipantId}`, points: s.points }))
        : [],
    [state.scores, boardAnswer],
  );

  if (!turn || !stageGroup) return null;

  const topicBody = getTopicBody(state, turn.topicId);
  const activeParticipantId = activeAnswer?.participantId ?? null;
  const maxBalls = maxBallsFor(
    eligibleJudgeCountFor(
      state.participants.map((p) => p.id),
      stageGroup.memberIds,
    ),
  );
  const boardScores = boardAnswer ? state.scores.filter((s) => s.answerId === boardAnswer.id) : [];
  const confirmedPerfect = perfectFromEligibleJudges(
    boardAnswer !== null && resolved,
    boardAnswer?.eligibleJudgeIds ?? [],
    Object.fromEntries(boardScores.map((s) => [s.judgeParticipantId, s.points])),
  );
  const stageMembers = stageGroup.memberIds.map((id) => ({
    id,
    name: state.participants.find((p) => p.id === id)?.displayName ?? "（名前未設定）",
  }));
  const judgingRemainingForDisplayed =
    displayedAnswer && judging?.answerId === displayedAnswer.id ? judgingRemainingMs : 0;

  return (
    <AudienceAnsweringPresentation
      topicBody={topicBody}
      roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
      maxBalls={maxBalls}
      scoreEvents={scoreEvents}
      boardResolved={resolved}
      confirmedPerfect={confirmedPerfect}
      boardRoundKey={boardRoundId}
      timing={DEMO_TIMING}
      answeringRemainingMs={state.answeringRemainingMs}
      answeringPaused={paused}
      stageMembers={stageMembers}
      myParticipantId={MY_PARTICIPANT_ID}
      activeParticipantId={activeParticipantId}
      revealPendingParticipantId={state.revealPending?.participantId ?? null}
      seatScores={seatScores}
      displayedAnswer={
        displayedAnswer
          ? {
              id: displayedAnswer.id,
              participantId: displayedAnswer.participantId,
              authorName:
                state.participants.find((p) => p.id === displayedAnswer.participantId)?.displayName ??
                "（名前未設定）",
              body: displayedAnswer.body,
              resolved,
            }
          : null
      }
      judgingRemainingMs={judgingRemainingForDisplayed}
      answerSubmitCue={pendingCue ? { cueId: pendingCue.cueId } : null}
      canJudge
      myScore={myScore as 0 | 1 | 2 | 3 | null}
      judgingDisabled={judgingTimeUp}
      onScore={submitMyScore}
      scoreErrorMessage={null}
      judgingActive={!!activeAnswer}
      tsukkomiTemplates={TSUKKOMI_TEMPLATES}
      onTsukkomi={sendTsukkomi}
    />
  );
}
