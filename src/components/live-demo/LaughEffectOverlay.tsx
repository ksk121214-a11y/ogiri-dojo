"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { DEMO_TIMING } from "@/data/liveDemoData";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

const STAMP_WORDS = ["ドッ", "ウケた!", "座布団3枚!"];

// 笑いエフェクト（過半数2点で発生）：画面フラッシュ＋紙吹雪＋擬音スタンプ（デザイン方針§4.4）
export default function LaughEffectOverlay() {
  const laughEventSeq = useLiveDemoStore((s) => s.laughEventSeq);
  const [visible, setVisible] = useState(false);
  const [seenSeq, setSeenSeq] = useState(laughEventSeq);
  const [word] = useState(
    () => STAMP_WORDS[Math.floor(Math.random() * STAMP_WORDS.length)],
  );

  // laughEventSeqの変化に合わせて表示状態を更新する（レンダー中にstateを調整する公式パターン）
  if (laughEventSeq !== seenSeq) {
    setSeenSeq(laughEventSeq);
    if (laughEventSeq !== 0) setVisible(true);
  }

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), DEMO_TIMING.laughEffectMs);
    return () => clearTimeout(t);
  }, [visible, laughEventSeq]);

  const confetti = Array.from({ length: 24 }, (_, i) => i);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={laughEventSeq}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.55, 0] }}
            transition={{ duration: DEMO_TIMING.laughEffectMs / 1000 }}
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at center, rgba(255,217,142,0.9), rgba(255,138,61,0.4) 45%, transparent 75%)",
            }}
          />
          {confetti.map((i) => (
            <motion.span
              key={i}
              initial={{
                opacity: 1,
                top: "-5%",
                left: `${(i * 37) % 100}%`,
                rotate: 0,
              }}
              animate={{ top: "105%", rotate: 360 }}
              transition={{
                duration: 0.9 + (i % 5) * 0.1,
                ease: "easeIn",
                delay: (i % 6) * 0.03,
              }}
              className={`absolute h-2.5 w-2.5 ${
                i % 2 === 0 ? "bg-dojo-curtain-gold" : "bg-dojo-cheer-pink"
              }`}
              style={{ borderRadius: i % 3 === 0 ? "9999px" : "2px" }}
            />
          ))}
          <motion.p
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1.15 }}
            exit={{ opacity: 0, scale: 1.4 }}
            transition={{ type: "spring", stiffness: 260, damping: 12 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-brush text-6xl text-dojo-curtain-gold drop-shadow-[0_0_25px_rgba(255,138,61,0.9)]"
          >
            {word}
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
