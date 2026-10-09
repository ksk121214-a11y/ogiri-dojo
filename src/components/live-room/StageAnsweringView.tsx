"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { initialAnswerCueState, nextAnswerCueState } from "@/lib/answerSubmitCue";
import StageAnsweringPresentation from "@/components/live-room/StageAnsweringPresentation";
import { getLiveRoomTiming, MAX_ANSWERS_PER_PLAYER, SCORE_REVEAL_DELAY_MS } from "@/data/liveRoomTiming";
import { confirmedPerfectFor, maxBallsFor } from "@/lib/liveRoomPresentation";
import { selectJudgingDisplayBackfillCandidate } from "@/lib/judgingDisplayBackfill";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { answeringRemaining, judgingRemaining } from "@/lib/liveRemaining";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import type { ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";

// 回答入力（舞台）画面の実バックエンド版adapter。表示そのものは
// src/components/live-room/StageAnsweringPresentation.tsx（本番・体験版/撮影モード共用）に委ね、
// ここでは実データ（useLiveFollowerStore、Supabase/Realtime）からpropsを組み立てる。
export default function StageAnsweringView() {
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
  const myAnswerCount = useLiveFollowerStore((s) => s.myAnswerCount);
  const submitMyAnswer = useLiveFollowerStore((s) => s.submitMyAnswer);
  const pendingCue = useLiveFollowerStore((s) => s.pendingCue);
  // 3回目レビュー対応（項目2）：このライブが実際に使うtiming_profileから解決する
  // （DB側の進行RPCが参照するのと同じlives.timing_profile。画面表示とDB判定の
  // 時間設定が食い違わないようにする）。
  const timing = getLiveRoomTiming(live?.timing_profile);

  const clock = useServerClockState(150);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 回答フリップが消えたあと(猶予表示が切れたあと)にその人の回答席で見えるように、
  // 回答フリップの猶予(useJudgingDisplayの既定3600ms)より長く持たせる。
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

  // 採点ボード（ScoringPhysicsBoard）が表示する「今の1件」は、回答フリップ(displayedAnswer)
  // よりも長く生き続ける必要がある。
  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  if (activeAnswer?.id && activeAnswer.id !== boardRoundId) {
    setBoardRoundId(activeAnswer.id);
  }
  const boardAnswer = boardRoundId ? turnAnswers.find((a) => a.id === boardRoundId) ?? null : null;

  // 回答送信音の合図：answering_cues.busyがfalse/null→trueになった「立ち上がり」だけを
  // cueIdの変化として扱う（詳細はsrc/lib/answerSubmitCue.ts参照）。本人以外の端末でも
  // 未発表回答の本文は返らないため、turnAnswers.lengthの増加では検知できず、このbusy列を基準にする。
  const cueForCurrentTurn = pendingCue?.turnId === currentTurn?.id ? pendingCue : null;
  const busyNow = cueForCurrentTurn?.busy ?? false;
  const cueTurnId = currentTurn?.id ?? null;
  const cueRevision = cueForCurrentTurn?.revision ?? null;
  // boardRoundId（直前）と同じ「レンダー中にstateを直接更新して即座に再レンダーさせる」
  // パターン（Reactが推奨する派生state更新。effect+setStateの非同期更新を使わない）。
  const [answerCueState, setAnswerCueState] = useState(() => initialAnswerCueState(busyNow));
  const computedAnswerCueState = nextAnswerCueState(answerCueState, busyNow, cueTurnId, cueRevision);
  if (
    computedAnswerCueState.wasBusy !== answerCueState.wasBusy ||
    computedAnswerCueState.cueId !== answerCueState.cueId
  ) {
    setAnswerCueState(computedAnswerCueState);
  }
  const answerSubmitCue = busyNow && answerCueState.cueId ? { cueId: answerCueState.cueId } : null;

  // 確定した瞬間も回答カードを表示し続ける猶予ぶんだけ残す（activeAnswerは確定と同時にnullになるため）。
  // 2026-10-09追加：クライアントの初回取得・購読確立が遅れ、revealed→resolvedの
  // 短い遷移を一度も観測できなかった回答を、安全な条件下でのみ一度だけ表示補完する
  // （詳細はsrc/lib/judgingDisplayBackfill.ts参照）。
  const judgingDisplayBackfillCandidate = selectJudgingDisplayBackfillCandidate(
    turnAnswers,
    live?.reveal_sequence_until ?? null,
    clock,
  );
  const displayedAnswer = useJudgingDisplay(
    activeAnswer,
    turnAnswers,
    timing.revealGraceMs,
    judgingDisplayBackfillCandidate,
  );

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
  const maxBalls = maxBallsFor(currentTurn.eligible_judge_count);
  const busyByTurnAnswers = cueForCurrentTurn?.busy ?? false;
  const busyWithOthers = live.answering_paused || busyByTurnAnswers;

  const answeringRemainingState = answeringRemaining(live, clock);
  const judgingRemainingState = judgingRemaining(displayedAnswer?.judging_ends_at, clock);

  const handleSubmit = async () => {
    setSubmitting(true);
    const result = await submitMyAnswer(draft);
    setSubmitting(false);
    if (result.ok) {
      setDraft("");
      setError(null);
      // 送信後にソフトウェアキーボードを閉じる。開いたままだと次の演出（採点ボード等）が
      // キーボードの下に隠れたり、iOS Safariで画面の高さ・位置が元に戻らないことがある。
      textareaRef.current?.blur();
    } else {
      setError(result.reason ?? "送信できませんでした");
    }
  };

  const overLimit = myAnswerCount >= MAX_ANSWERS_PER_PLAYER;
  const submitDisabled = overLimit || busyWithOthers || submitting || !draft.trim();

  return (
    <StageAnsweringPresentation
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
      answeringSyncing={answeringRemainingState.syncing}
      busyWithOthers={busyWithOthers}
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
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={handleSubmit}
      overLimit={overLimit}
      submitDisabled={submitDisabled}
      myAnswerCount={myAnswerCount}
      maxAnswersPerPlayer={MAX_ANSWERS_PER_PLAYER}
      errorMessage={error}
      textareaRef={textareaRef}
    />
  );
}
