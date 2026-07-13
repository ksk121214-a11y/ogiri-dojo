"use client";

import { motion, useAnimation } from "framer-motion";
import { useEffect, useState } from "react";

import { getNextRank, getRankByMeter } from "@/data/collectionData";
import type { RankDefinition } from "@/types/economy";

const SIZE = 208;
const STROKE = 14;
const RADIUS = SIZE / 2 - STROKE;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ratioInRank(
  meter: number,
  rank: RankDefinition,
  nextRank: RankDefinition | null,
): number {
  if (!nextRank) return 1;
  const span = nextRank.threshold - rank.threshold;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (meter - rank.threshold) / span));
}

// 最終結果画面（L6）末尾に追加する熟練度メーターの円形ゲージ演出（§6.3.5）。
// 時計回りにゲージが今回獲得した分だけ伸び、段位の閾値を超えたら昇段演出を挟んで
// 次の段位のゲージへ引き継ぐ。baseline/gainedはダミー値でよい仕様（企画部指示）。
export default function MasteryGauge({
  baseline,
  gained,
}: {
  baseline: number;
  gained: number;
}) {
  const controls = useAnimation();
  const startRank = getRankByMeter(baseline);
  const startNext = getNextRank(baseline);
  const endMeter = baseline + gained;
  const endRank = getRankByMeter(endMeter);
  const endNext = getNextRank(endMeter);
  const promoted = endRank.order > startRank.order;

  const [displayRank, setDisplayRank] = useState(startRank);
  const [displayNext, setDisplayNext] = useState(startNext);
  const [showPromotion, setShowPromotion] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startRatio = ratioInRank(baseline, startRank, startNext);
    const phase1Target = promoted ? 1 : ratioInRank(endMeter, startRank, startNext);
    const phase2Target = promoted ? ratioInRank(endMeter, endRank, endNext) : 0;

    controls.set({ strokeDashoffset: CIRCUMFERENCE * (1 - startRatio) });

    async function run() {
      await controls.start({
        strokeDashoffset: CIRCUMFERENCE * (1 - phase1Target),
        transition: { duration: 1.6, ease: "easeOut" },
      });
      if (cancelled) return;

      if (!promoted) {
        setSettled(true);
        return;
      }

      setShowPromotion(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (cancelled) return;

      setShowPromotion(false);
      setDisplayRank(endRank);
      setDisplayNext(endNext);
      controls.set({ strokeDashoffset: CIRCUMFERENCE });
      await controls.start({
        strokeDashoffset: CIRCUMFERENCE * (1 - phase2Target),
        transition: { duration: 1.2, ease: "easeOut" },
      });
      if (cancelled) return;
      setSettled(true);
    }

    run();
    return () => {
      cancelled = true;
    };
    // 演出はマウント時に一度だけ走らせる（baseline/gainedは表示中に変化しない前提）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="rgba(183,178,196,0.2)"
            strokeWidth={STROKE}
            fill="none"
          />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="url(#mastery-gauge-gradient)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRCUMFERENCE}
            animate={controls}
          />
          <defs>
            <linearGradient
              id="mastery-gauge-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#FF8A3D" />
              <stop offset="100%" stopColor="#E8B84C" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p className="font-sans text-[10px] tracking-widest text-dojo-gray-purple">
            熟練度メーター
          </p>
          <p className="mt-1 font-brush text-3xl text-dojo-curtain-gold">
            {displayRank.label}
          </p>
          <p className="mt-1 font-sans text-[11px] text-dojo-gray-purple">
            {displayNext ? `次は「${displayNext.label}」` : "最高位に到達"}
          </p>
        </div>
      </div>

      {settled && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="font-sans text-xs text-dojo-spotlight-orange-light"
        >
          今回の獲得：+{gained}
        </motion.p>
      )}

      {showPromotion && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-dojo-stage-dark/80"
        >
          <motion.p
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="font-sans text-xs tracking-widest text-dojo-cheer-pink"
          >
            昇段
          </motion.p>
          <motion.p
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1.1, opacity: 1 }}
            transition={{ delay: 0.25, type: "spring", stiffness: 220, damping: 14 }}
            className="font-brush text-5xl text-dojo-curtain-gold drop-shadow-[0_0_30px_rgba(232,184,76,0.7)] sm:text-6xl"
          >
            {endRank.label}
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="font-sans text-xs text-dojo-washi-white/80"
          >
            に昇段しました
          </motion.p>
        </motion.div>
      )}
    </div>
  );
}
