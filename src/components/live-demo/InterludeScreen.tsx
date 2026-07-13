"use client";

import { motion } from "framer-motion";

import CurtainOverlay from "./CurtainOverlay";
import ScreenShell from "./ScreenShell";

// 幕間演出：開幕ボタンを押した直後に緞帳(どんちょう)が開く演出 → 暗転 → タイトル表示（デザイン方針§4.1 フル幕間）
export default function InterludeScreen() {
  return (
    <ScreenShell>
      <CurtainOverlay />
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        style={{
          background:
            "radial-gradient(circle at center, rgba(255,138,61,0.35), transparent 60%)",
        }}
      />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="font-sans text-xs tracking-[0.5em] text-dojo-gray-purple"
      >
        本日開演
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
        className="mt-4 font-brush text-6xl text-dojo-curtain-gold drop-shadow-[0_0_25px_rgba(232,184,76,0.6)] sm:text-8xl"
      >
        大喜利道場
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.9 }}
        className="mt-6 font-sans text-sm text-dojo-washi-white/80"
      >
        まもなく開演します……
      </motion.p>
    </ScreenShell>
  );
}
