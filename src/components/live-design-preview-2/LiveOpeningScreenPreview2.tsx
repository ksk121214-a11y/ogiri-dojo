"use client";

import { motion } from "framer-motion";

import LiveStageBackdropPreview2 from "./LiveStageBackdropPreview2";

// 「ライブに参加」を押した直後、実際の進行(舞台/客席)が始まるまでの短い開幕演出。
// 本番のInterludeScreen(緞帳が開く演出)と同じ役割だが、design-preview-2は
// カーテンではなく袖素材のテーマなので、専用の光の演出にしている。
export default function LiveOpeningScreenPreview2() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <LiveStageBackdropPreview2 />
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        style={{
          background: "radial-gradient(circle at center, rgba(59,91,255,0.45), transparent 60%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative z-10 text-center"
      >
        <p className="font-sans text-xs tracking-[0.5em] text-[#7ab2ff]">まもなく開演</p>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-3 font-sans text-5xl font-black text-white drop-shadow-[0_0_25px_rgba(59,91,255,0.9)]"
        >
          ライブスタート！
        </motion.h1>
      </motion.div>
    </div>
  );
}
