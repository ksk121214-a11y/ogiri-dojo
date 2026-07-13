"use client";

import { motion } from "framer-motion";

// 残り時間を示す円形プログレスリング（デザイン方針§4.2：灯り橙→緞帳赤へ色が変化するカウントダウン）
// 持ち時間は常に見えている必要があるため（§5）、審査中(paused)でも消したり暗くしすぎたりせず、
// リングをゆっくり明滅させて「一時停止中」であることだけを伝える。
export default function TimerRing({
  remainingMs,
  totalMs,
  size = 88,
  label,
  paused = false,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
  label?: string;
  paused?: boolean;
}) {
  const ratio =
    totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - ratio);
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const urgent = ratio < 0.25;
  const ringColorClass = paused
    ? "text-dojo-gray-purple"
    : urgent
      ? "text-dojo-curtain-red"
      : "text-dojo-spotlight-orange";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(183,178,196,0.25)"
          strokeWidth={6}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{
            strokeDashoffset: dashoffset,
            opacity: paused ? [1, 0.5, 1] : 1,
          }}
          transition={{
            strokeDashoffset: { duration: 0.15, ease: "linear" },
            // 経過中（非paused）はopacityを毎tick即座に1へ固定し、明滅の余地を作らない。
            // 明滅演出はpaused（審査中などの一時停止）の時だけ意図的に行う。
            opacity: paused
              ? { duration: 1.3, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0 },
          }}
          className={ringColorClass}
        />
      </svg>
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center font-sans font-bold tabular-nums ${
          paused
            ? "text-dojo-gray-purple"
            : urgent
              ? "text-dojo-curtain-red"
              : "text-dojo-washi-white"
        }`}
      >
        <span className="text-xl leading-none">{seconds}</span>
        {label && (
          <span className="mt-0.5 whitespace-nowrap text-[9px] leading-tight font-normal text-dojo-gray-purple">
            {paused ? "中断中" : label}
          </span>
        )}
      </div>
    </div>
  );
}
