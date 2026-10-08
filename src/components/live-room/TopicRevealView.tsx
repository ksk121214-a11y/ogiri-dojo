"use client";

import { useEffect, useRef } from "react";

import TopicRevealPresentation from "@/components/live-room/TopicRevealPresentation";
import { maxBallsFor } from "@/lib/liveRoomPresentation";
import { playSfx } from "@/lib/sfx";
import { serverClock } from "@/lib/serverClockInstance";
import { createTopicRevealSfxScheduler } from "@/lib/topicRevealSfxScheduler";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// public/sounds/topic-reveal.mp3（歓声と拍手）の実測尺（afinfoで確認、約4.1秒）。
const TOPIC_REVEAL_SE_MS = 4100;
// ライブ画面に切り替わった後、この効果音をどれだけ被らせて鳴り終わらせたいか。
const OVERLAP_MS = 2_000;

// お題発表フェーズの実バックエンド版adapter。表示そのものは
// src/components/live-room/TopicRevealPresentation.tsx（本番・体験版/撮影モード共用）に委ね、
// ここでは実データ（useLiveFollowerStore）とサーバー時計基準の効果音予約を組み立てる。
export default function TopicRevealView() {
  const live = useLiveFollowerStore((s) => s.live);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const groups = useLiveFollowerStore((s) => s.groups);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);

  // 出囃子(BGM)が鳴っている途中で客席がわっと沸く演出にしたいので、画面表示と同時ではなく
  // お題発表フェーズの終盤で鳴らし、ライブ画面への切り替わり後も少しだけ被って鳴り終わる
  // ようにする（効果音の予約そのものはtopicRevealSfxScheduler.ts。詳細な理由はそちら参照）。
  // サーバー時計の同期前は予約しない。
  const clock = useServerClockState();
  const deadline = live?.phase_deadline ?? null;
  const schedulerRef = useRef<ReturnType<typeof createTopicRevealSfxScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createTopicRevealSfxScheduler({
      nowIfFresh: () => serverClock.nowIfFresh(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      play: (offsetSec) => playSfx("topicReveal", offsetSec > 0 ? { offsetSec } : undefined),
      seMs: TOPIC_REVEAL_SE_MS,
      overlapMs: OVERLAP_MS,
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);
  useEffect(() => {
    schedulerRef.current?.update(deadline);
  }, [deadline, clock.fresh, clock.revision]);

  if (!currentTurn || !currentTopic) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants.filter(
    (p) => p.role === "player" && p.group_id === currentTurn.group_id,
  );
  const onStage = !!myParticipant && myParticipant.group_id === currentTurn.group_id;
  // 回答画面の採点ボードと同じ「審査員数×3」の満杯基準にして、右上の数字表示を揃える。
  const maxBalls = maxBallsFor(currentTurn.eligible_judge_count);

  return (
    <TopicRevealPresentation
      roundLabel={`第${currentTurn.round}周 ・ ${groupOrder}組目登場${onStage ? "（あなたの組です）" : ""}`}
      stageMemberNames={stageMembers.map((p) => participantNames[p.id] ?? "（名前未設定）")}
      topicBody={currentTopic.body}
      maxBalls={maxBalls}
    />
  );
}
