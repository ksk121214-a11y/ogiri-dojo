"use client";

import { motion } from "framer-motion";

import ScoringPhysicsBoard from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";

// お題発表フェーズの表示だけを担う共用部品。本番(TopicRevealView)・体験版/撮影モード
// (TopicRevealScreen)は、効果音の予約（サーバー時計基準かローカル時計基準かが異なる）を
// 自分のadapter側で行い、ここへは表示に必要な値だけをpropsで渡す。

export interface TopicRevealPresentationProps {
  roundLabel: string;
  stageMemberNames: string[];
  topicBody: string;
  maxBalls: number;
}

export default function TopicRevealPresentation({
  roundLabel,
  stageMemberNames,
  topicBody,
  maxBalls,
}: TopicRevealPresentationProps) {
  return (
    <ScreenShell>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 0.75, 1] }}
        style={{ transformOrigin: "left" }}
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-24 -translate-y-1/2 bg-[#ff3b5b]"
      />
      <p className="font-sans text-xs tracking-widest text-white/60">{roundLabel}</p>
      <motion.h2
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-3 w-full max-w-full break-words px-2 font-sans font-bold text-xl text-[#ffcf4a] sm:text-2xl"
      >
        {stageMemberNames.join(" / ")}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-10 aspect-video w-full max-w-2xl"
      >
        <ScoringPhysicsBoard variant="neon2" topicBody={topicBody} roundLabel="お題" maxBalls={maxBalls} scoreEvents={[]} />
      </motion.div>
    </ScreenShell>
  );
}
