"use client";

import { motion } from "framer-motion";

import { DEMO_TIMING } from "@/data/liveDemoData";
import TimerRing from "./TimerRing";

const SCORE_BUTTONS: { points: 0 | 1 | 2 | 3; label: string; className: string }[] = [
  { points: 0, label: "0", className: "bg-dojo-score-0" },
  { points: 1, label: "1", className: "bg-dojo-score-1 text-dojo-stage-dark" },
  { points: 2, label: "2", className: "bg-dojo-score-2" },
  { points: 3, label: "3", className: "bg-dojo-score-3 text-dojo-stage-dark" },
];

// 審査サイクル中の共通カード（L3/L4）：対象回答＋（審査員のみ）0/1/2/3採点ボタン §4.5
// （2026-07-14改訂：0〜2点の3段階→0〜3点の4段階に変更）
// お題そのものは同じ画面上部のTopicBanner（審査中は拡大表示）が担うため、
// ここでは重複してお題を出さない（仕様書§4.5・デザイン方針§4.2との重複表示を解消）。
export default function JudgingCard({
  authorName,
  answerBody,
  remainingMs,
  isJudge,
  myScore,
  onScore,
}: {
  authorName: string;
  answerBody: string;
  remainingMs: number;
  isJudge: boolean;
  myScore: 0 | 1 | 2 | 3 | null;
  onScore?: (points: 0 | 1 | 2 | 3) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex w-full max-w-xl flex-col items-center rounded-2xl border border-dojo-curtain-gold/70 bg-dojo-backstage-navy p-3 text-center shadow-[0_0_45px_rgba(255,138,61,0.3)] sm:p-5"
    >
      <p className="font-sans text-[11px] tracking-widest text-dojo-spotlight-orange-light">
        審査中
      </p>

      <div className="mt-2 w-full min-h-0 overflow-y-auto rounded-xl bg-dojo-stage-dark/60 px-4 py-3">
        <p className="font-sans text-sm text-dojo-curtain-gold">
          {authorName}
        </p>
        <p className="mt-1.5 font-sans text-xl font-bold leading-snug text-dojo-washi-white sm:text-2xl">
          {answerBody}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-center sm:mt-3">
        <TimerRing
          remainingMs={remainingMs}
          totalMs={DEMO_TIMING.judgeMs}
          size={60}
          label="採点"
        />
      </div>

      {isJudge ? (
        <div className="mt-2 flex items-center justify-center gap-2.5 sm:mt-3 sm:gap-3.5">
          {SCORE_BUTTONS.map((btn) => (
            <button
              key={btn.points}
              type="button"
              onClick={() => onScore?.(btn.points)}
              className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl font-bold transition sm:h-16 sm:w-16 sm:text-3xl ${btn.className} ${
                myScore === btn.points
                  ? "ring-4 ring-dojo-washi-white scale-110"
                  : "opacity-80 hover:opacity-100"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 font-sans text-xs text-dojo-gray-purple sm:mt-3">
          客席が採点しています……
        </p>
      )}
    </motion.div>
  );
}
