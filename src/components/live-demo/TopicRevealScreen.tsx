"use client";

import { useEffect } from "react";

import TopicRevealPresentation from "@/components/live-room/TopicRevealPresentation";
import { eligibleJudgeCountFor, maxBallsFor } from "@/lib/liveRoomPresentation";
import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
  isMyGroupOnStage,
} from "@/lib/liveDemoSelectors";
import { playSfx } from "@/lib/sfx";
import { createTopicRevealSfxScheduler } from "@/lib/topicRevealSfxScheduler";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// お題発表：実ライブと同じ共用表示部品(TopicRevealPresentation)を使う。効果音の予約は
// ローカル時計基準（Date.now()）で行う（本番はサーバー時計基準。TopicRevealView.tsx参照）。
const TOPIC_REVEAL_SE_MS = 4100;
const OVERLAP_MS = 2_000;

export default function TopicRevealScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const onStage = isMyGroupOnStage(state);
  const deadlineIso = state.phaseEndsAt ? new Date(state.phaseEndsAt).toISOString() : null;

  useEffect(() => {
    const scheduler = createTopicRevealSfxScheduler({
      nowIfFresh: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      play: (offsetSec) => playSfx("topicReveal", offsetSec > 0 ? { offsetSec } : undefined),
      seMs: TOPIC_REVEAL_SE_MS,
      overlapMs: OVERLAP_MS,
    });
    scheduler.update(deadlineIso);
    return () => scheduler.dispose();
  }, [deadlineIso]);

  if (!turn || !stageGroup) return null;
  const topicBody = getTopicBody(state, turn.topicId);
  const maxBalls = maxBallsFor(
    eligibleJudgeCountFor(
      state.participants.map((p) => p.id),
      stageGroup.memberIds,
    ),
  );

  return (
    <TopicRevealPresentation
      roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目登場${onStage ? "（あなたの組です）" : ""}`}
      stageMemberNames={stageGroup.memberIds.map((id) => getParticipantName(state, id))}
      topicBody={topicBody}
      maxBalls={maxBalls}
    />
  );
}
