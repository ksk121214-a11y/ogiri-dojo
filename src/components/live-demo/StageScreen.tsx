"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import StageAnsweringPresentation from "@/components/live-room/StageAnsweringPresentation";
import { DEMO_TIMING, MAX_ANSWERS_PER_PLAYER, MY_PARTICIPANT_ID, SCORE_REVEAL_DELAY_MS } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getStageGroup,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { eligibleJudgeCountFor, maxBallsFor, perfectFromEligibleJudges } from "@/lib/liveRoomPresentation";
import { resumeAudioContext } from "@/lib/audio/audioManager";
import { sfxCueTracker } from "@/lib/cuePlayback";
import { playSfx } from "@/lib/sfx";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import type { ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";

// 回答入力（舞台）画面の体験版/撮影モードadapter。表示そのものは
// src/components/live-room/StageAnsweringPresentation.tsx（本番・体験版/撮影モード共用）に委ね、
// ここではローカルの進行ロジック（useLiveDemoStore）からpropsを組み立てる。
export default function StageScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyAnswer = useLiveDemoStore((s) => s.submitMyAnswer);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const topicBody = turn ? getTopicBody(state, turn.topicId) : "";
  const judging = state.judging;
  const revealPending = state.revealPending;
  const answeringRemainingMs = state.answeringRemainingMs;
  const myCount = state.answerCounts[MY_PARTICIPANT_ID] ?? 0;
  const now = state.lastTickAt ?? 0;
  // 誰かの回答が表示・審査されている間、または採点確定後の「点数を見せる間」は送信できない（実ライブと同じ）
  const busyWithOthers = judging !== null || revealPending !== null || now < state.revealGateUntil;
  const judgingRemainingMs = judging ? Math.max(0, judging.endsAt - now) : 0;

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 採点確定後、回答席に得点を一定時間出す（参加者ID→点数。実ライブと同じ）
  const [seatScores, setSeatScores] = useState<Record<string, number>>({});
  const prevJudgingIdRef = useRef<string | null>(null);
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const activeAnswer = judging ? state.answers.find((a) => a.id === judging.answerId) ?? null : null;
  const displayedAnswer = useJudgingDisplay(activeAnswer, state.answers, DEMO_TIMING.revealGraceMs);

  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  if (judging?.answerId && judging.answerId !== boardRoundId) {
    setBoardRoundId(judging.answerId);
  }
  const boardAnswer = boardRoundId ? state.answers.find((a) => a.id === boardRoundId) ?? null : null;
  const resolved = judging === null;

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

  const handleSubmit = () => {
    // クリックの同期処理の中で音を鳴らす（awaitやstate更新より前）。自分の回答はここで
    // 即座に鳴らし、他の人の回答席が光った時はStageAnsweringPresentation側の
    // answerSubmitCue経路で鳴らす。どちらも同じcueIdのsfxCueTrackerで重複防止するため、
    // 二重には鳴らない（撮影モードの低遅延化・cueId設計はこれまでの修正を維持する）。
    resumeAudioContext();
    const result = submitMyAnswer(draft);
    if (result.ok) {
      const cue = useLiveDemoStore.getState().revealPending;
      if (cue) sfxCueTracker.once(cue.cueId, () => playSfx("answerSubmit"));
      setDraft("");
      setError(null);
      // 送信後にソフトウェアキーボードを閉じる（実ライブのStageAnsweringViewと同じ理由）。
      textareaRef.current?.blur();
    } else {
      setError(result.reason ?? "送信できませんでした");
    }
  };

  const overLimit = myCount >= MAX_ANSWERS_PER_PLAYER;
  const submitDisabled = overLimit || busyWithOthers || !draft.trim();

  return (
    <StageAnsweringPresentation
      topicBody={topicBody}
      roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
      maxBalls={maxBalls}
      scoreEvents={scoreEvents}
      boardResolved={resolved}
      confirmedPerfect={confirmedPerfect}
      boardRoundKey={boardRoundId}
      timing={DEMO_TIMING}
      answeringRemainingMs={answeringRemainingMs}
      busyWithOthers={busyWithOthers}
      stageMembers={stageMembers}
      myParticipantId={MY_PARTICIPANT_ID}
      activeParticipantId={activeParticipantId}
      revealPendingParticipantId={revealPending?.participantId ?? null}
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
      answerSubmitCue={revealPending ? { cueId: revealPending.cueId } : null}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={handleSubmit}
      overLimit={overLimit}
      submitDisabled={submitDisabled}
      myAnswerCount={myCount}
      maxAnswersPerPlayer={MAX_ANSWERS_PER_PLAYER}
      errorMessage={error}
      textareaRef={textareaRef}
    />
  );
}
