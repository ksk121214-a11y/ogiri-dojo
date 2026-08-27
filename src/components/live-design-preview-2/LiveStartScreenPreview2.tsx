"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import LiveStageBackdropPreview2 from "./LiveStageBackdropPreview2";

const GROUP_SIZE_OPTIONS = [1, 2, 3, 4, 5];

// design-preview-2の入口画面。「ライブに参加」を押すまではプレビューを一切
// 開始しない(舞台/客席をボタンで手動切り替えていた旧仕様をやめ、本番同様に
// 参加した瞬間からライブが進行する形にするため、開始タイミングを明示するここが必要)。
//
// 本番では1組の人数は5人固定ではなく1〜5人まで変動しうるため、その見た目
// (特に偶数人数の時に画面中央で綺麗に半々に分かれるか)をここで選んで
// 試せるようにしている。選んだ人数は自分がいる1組目にだけ反映され、
// 2組目・3組目(審査員側)は既定の5人のまま変わらない。
export default function LiveStartScreenPreview2({
  onJoin,
}: {
  onJoin: (groupSize: number) => void;
}) {
  const [groupSize, setGroupSize] = useState(5);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <LiveStageBackdropPreview2 />
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="font-sans text-xs tracking-[0.4em] text-[#7ab2ff]"
        >
          LIVE OGIRI SHOW
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, scale: 0.9, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
          className="mt-2 font-sans text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(59,91,255,0.8)]"
        >
          爆笑スタジアム
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-3 max-w-xs font-sans text-sm text-white/70"
        >
          3組・15人でお題に回答。自分の組以外が審査員になる本番同様の流れをこの画面で試せます。
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8"
        >
          <p className="font-sans text-xs text-white/60">参加人数（自分の組）</p>
          <div className="mt-2 flex items-center justify-center gap-2">
            {GROUP_SIZE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setGroupSize(n)}
                className={`h-10 w-10 rounded-full font-sans text-sm font-bold transition ${
                  groupSize === n
                    ? "bg-[#3b5bff] text-white shadow-[0_0_15px_rgba(59,91,255,0.7)]"
                    : "border border-white/25 text-white/60 hover:border-[#3b5bff] hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </motion.div>
        <motion.button
          type="button"
          onClick={() => onJoin(groupSize)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="mt-6 rounded-full bg-[#3b5bff] px-8 py-3 font-sans text-base font-bold text-white shadow-[0_0_25px_rgba(59,91,255,0.6)] transition active:scale-95"
        >
          ライブに参加
        </motion.button>
      </div>
    </div>
  );
}
