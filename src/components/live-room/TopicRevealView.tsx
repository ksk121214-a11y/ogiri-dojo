"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import ScoringPhysicsBoard from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";
import { LIVE_ROOM_TIMING } from "@/data/liveRoomTiming";
import { playSfx } from "@/lib/sfx";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// public/sounds/topic-reveal.mp3（歓声と拍手）の実測尺（afinfoで確認、約4.1秒）。
const TOPIC_REVEAL_SE_MS = 4100;
// ライブ画面に切り替わった後、この効果音をどれだけ被らせて鳴り終わらせたいか。
// 2026-08-27：「もう少し遅れて鳴って、次のライブ画面が始まってから鳴り終わる感じ」に
// という要望を受けて800ms→2000msに拡大。
const OVERLAP_MS = 2_000;

// お題発表フェーズの実バックエンド版。src/components/live-demo/TopicRevealScreen.tsxと
// 同じ見た目の考え方だが、useLiveDemoStoreではなくuseLiveFollowerStoreの実データを見る。
export default function TopicRevealView() {
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const groups = useLiveFollowerStore((s) => s.groups);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);

  // 出囃子(BGM)が鳴っている途中で客席がわっと沸く演出にしたいので、画面表示と同時ではなく
  // お題発表フェーズの終盤で鳴らし、ライブ画面への切り替わり後も少しだけ被って鳴り終わる
  // ようにする（src/components/live-demo/TopicRevealScreen.tsxと同じ理由・同じ計算式）。
  // Strict Mode対策のrefガードも同様（cleanupでのタイマー解除はあえてしない）。
  const scheduledRef = useRef(false);
  useEffect(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    const delay = Math.max(0, LIVE_ROOM_TIMING.topicRevealMs - TOPIC_REVEAL_SE_MS + OVERLAP_MS);
    setTimeout(() => playSfx("topicReveal"), delay);
  }, []);

  if (!currentTurn || !currentTopic) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants.filter(
    (p) => p.role === "player" && p.group_id === currentTurn.group_id,
  );
  const onStage = !!myParticipant && myParticipant.group_id === currentTurn.group_id;
  // 回答画面の採点ボードと同じ「審査員数×3」の満杯基準にして、右上の数字表示を揃える。
  // 2026-09-03: participants一覧から毎回計算するのをやめ、ゲーム開始時にサーバー側で
  // 1回だけ確定させたturns.eligible_judge_count（全クライアント共通）を使う（0049）。
  const maxBalls = Math.max(3, currentTurn.eligible_judge_count * 3);

  return (
    <ScreenShell>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 0.75, 1] }}
        style={{ transformOrigin: "left" }}
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-24 -translate-y-1/2 bg-[#ff3b5b]"
      />
      <p className="font-sans text-xs tracking-widest text-white/60">
        第{currentTurn.round}周 ・ {groupOrder}組目登場
        {onStage ? "（あなたの組です）" : ""}
      </p>
      <motion.h2
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-3 w-full max-w-full break-words px-2 font-brush text-xl text-[#ffcf4a] sm:text-2xl"
      >
        {stageMembers
          .map((p) => participantNames[p.id] ?? "（名前未設定）")
          .join(" / ")}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-10 aspect-video w-full max-w-2xl"
      >
        <ScoringPhysicsBoard
          variant="neon2"
          topicBody={currentTopic.body}
          roundLabel="お題"
          maxBalls={maxBalls}
          scoreEvents={[]}
        />
      </motion.div>
    </ScreenShell>
  );
}
