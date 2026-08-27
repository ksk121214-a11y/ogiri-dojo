"use client";

import { motion } from "framer-motion";

import LiveStageBackdropPreview2 from "./LiveStageBackdropPreview2";
import { useLiveDesignPreviewStore2 } from "@/store/useLiveDesignPreviewStore2";

// 組分け発表の直後、実際の回答受付が始まる直前にお題だけを画面いっぱいに
// 大きく見せる演出(本番のTopicRevealView相当を簡略化したもの)。ここではまだ
// 回答受付は始まっていない(ボタン等は出さない、お題を読ませるだけの画面)。
export default function LiveTopicRevealScreenPreview2() {
  const currentTopic = useLiveDesignPreviewStore2((s) => s.currentTopic);
  const currentTurn = useLiveDesignPreviewStore2((s) => s.currentTurn);
  const groups = useLiveDesignPreviewStore2((s) => s.groups);

  const groupOrder = groups.find((g) => g.id === currentTurn?.group_id)?.group_order ?? 1;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <LiveStageBackdropPreview2 />
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white px-6 py-10 text-center shadow-[0_0_50px_rgba(59,91,255,0.6)]"
      >
        <span className="rounded-full bg-[#3b5bff] px-4 py-1.5 font-sans text-sm font-bold text-white">
          {groupOrder}組目のお題
        </span>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-6 font-sans text-2xl font-black leading-snug text-[#1a1a3a]"
        >
          {currentTopic?.body}
        </motion.p>
      </motion.div>
    </div>
  );
}
