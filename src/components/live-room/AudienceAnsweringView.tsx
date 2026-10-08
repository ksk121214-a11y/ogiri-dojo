"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AudienceAnsweringPresentation from "@/components/live-room/AudienceAnsweringPresentation";
import type { ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";
import { TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import { getLiveRoomTiming, SCORE_REVEAL_DELAY_MS } from "@/data/liveRoomTiming";
import { confirmedPerfectFor, maxBallsFor } from "@/lib/liveRoomPresentation";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { answeringRemaining, judgingRemaining } from "@/lib/liveRemaining";
import { playSfx } from "@/lib/sfx";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// ライブ観戦（客席/審査員）画面の実バックエンド版adapter。表示そのものは
// src/components/live-room/AudienceAnsweringPresentation.tsx（本番・体験版/撮影モード共用）に
// 委ね、ここでは実データ（useLiveFollowerStore、Supabase/Realtime）からpropsを組み立てる。
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
  const pendingCue = useLiveFollowerStore((s) => s.pendingCue);
  const timing = getLiveRoomTiming(live?.timing_profile);

  const clock = useServerClockState(150);
  const [scoreError, setScoreError] = useState<{ answerId: string; message: string } | null>(null);

  const displayedAnswer = useJudgingDisplay(activeAnswer, turnAnswers, timing.revealGraceMs);

  const [seatScores, setSeatScores] = useState<Record<string, number>>({});
  const prevActiveIdRef = useRef<string | null>(null);
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const submittingAnswerIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prevId = prevActiveIdRef.current;
    prevActiveIdRef.current = activeAnswer?.id ?? null;
    if (prevId && activeAnswer?.id !== prevId) {
      const resolvedAnswer = turnAnswers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        const participantId = resolvedAnswer.participant_id;
        const value = resolvedAnswer.score_total;
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
          }, timing.scoreDisplayMs);
          pendingTimersRef.current.add(hideTimer);
        }, SCORE_REVEAL_DELAY_MS);
        pendingTimersRef.current.add(revealTimer);
      }
    }
  }, [activeAnswer, turnAnswers, timing.scoreDisplayMs]);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
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

  const cueForCurrentTurn = pendingCue?.turnId === currentTurn?.id ? pendingCue : null;
  const answerSubmitCue =
    cueForCurrentTurn?.busy && currentTurn
      ? { cueId: `${currentTurn.id}:${cueForCurrentTurn.revision}` }
      : null;

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? activeAnswerScores
            .filter((s) => s.answer_id === boardAnswer.id)
            .map((s) => ({ id: `${s.answer_id}-${s.judge_participant_id}`, points: s.points }))
        : [],
    [activeAnswerScores, boardAnswer],
  );

  if (!live || !currentTurn || !currentTopic || !myParticipant) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants
    .filter((p) => p.role === "player" && p.group_id === currentTurn.group_id)
    .map((p) => ({ id: p.id, name: participantNames[p.id] ?? "（名前未設定）" }));

  const activeParticipantId = activeAnswer?.participant_id ?? null;
  const revealPendingParticipantId = activeAnswer ? null : (cueForCurrentTurn?.pendingParticipantId ?? null);
  const canJudge = myParticipant.role === "player" && myParticipant.group_id !== currentTurn.group_id;
  const maxBalls = maxBallsFor(currentTurn.eligible_judge_count);

  const answeringRemainingState = answeringRemaining(live, clock);
  const judgingRemainingState = judgingRemaining(displayedAnswer?.judging_ends_at, clock);
  // 時間切れギリギリで押しても、司会側で先に確定してしまい採点が反映されないことがある。
  // 同期前は端末時刻由来の「時間切れ」を決めない（採点可否の最終判断はDB側）。
  const judgingTimeUp = !judgingRemainingState.syncing && judgingRemainingState.ms <= 0;

  const handleScore = async (points: 0 | 1 | 2 | 3) => {
    if (!canJudge) return;
    if (!displayedAnswer) return;
    const answerId = displayedAnswer.id;
    if (submittingAnswerIdRef.current === answerId) return;
    submittingAnswerIdRef.current = answerId;
    try {
      const result = await submitMyScore(points);
      if (result.ok) {
        setScoreError(null);
      } else if (!result.silent) {
        setScoreError({ answerId, message: result.reason ?? "採点を送信できませんでした" });
      }
    } finally {
      if (submittingAnswerIdRef.current === answerId) submittingAnswerIdRef.current = null;
    }
  };

  return (
    <AudienceAnsweringPresentation
      topicBody={currentTopic.body}
      roundLabel={`第${currentTurn.round}周 ・ ${groupOrder}組目`}
      maxBalls={maxBalls}
      scoreEvents={scoreEvents}
      boardResolved={boardAnswer?.resolved ?? false}
      confirmedPerfect={confirmedPerfectFor(
        boardAnswer?.resolved ?? false,
        boardAnswer?.judge_count ?? 0,
        boardAnswer?.top_score_votes ?? 0,
      )}
      boardRoundKey={boardRoundId}
      timing={timing}
      answeringRemainingMs={answeringRemainingState.ms}
      answeringPaused={live.answering_paused}
      stageMembers={stageMembers}
      myParticipantId={myParticipant.id}
      participantAvatars={participantAvatars}
      activeParticipantId={activeParticipantId}
      revealPendingParticipantId={revealPendingParticipantId}
      seatScores={seatScores}
      displayedAnswer={
        displayedAnswer
          ? {
              id: displayedAnswer.id,
              participantId: displayedAnswer.participant_id,
              authorName: participantNames[displayedAnswer.participant_id] ?? "（名前未設定）",
              body: displayedAnswer.body,
              resolved: displayedAnswer.resolved,
            }
          : null
      }
      judgingRemainingMs={judgingRemainingState.ms}
      judgingSyncing={judgingRemainingState.syncing}
      answerSubmitCue={answerSubmitCue}
      canJudge={canJudge}
      myScore={myScore as 0 | 1 | 2 | 3 | null}
      judgingDisabled={judgingTimeUp}
      onScore={handleScore}
      scoreErrorMessage={
        displayedAnswer && scoreError && scoreError.answerId === displayedAnswer.id ? scoreError.message : null
      }
      judgingActive={!!activeAnswer}
      tsukkomiTemplates={TSUKKOMI_TEMPLATES}
      onTsukkomi={sendTsukkomi}
    />
  );
}
