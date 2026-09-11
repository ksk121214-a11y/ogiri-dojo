"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";

import { useTsukkomiReactionQueue } from "@/lib/liveReactionQueue";
import type { TsukkomiEvent } from "@/store/useLiveFollowerStore";

interface FloatItem {
  id: string;
  kind: "clap" | "stamp";
  text: string;
  xPercent: number;
}

// src/components/live-demo/TsukkomiFloatOverlay.tsxと同じ演出だが、
// useLiveDemoStoreではなく実際にRealtimeブロードキャストで届いたイベント(useLiveFollowerStore)を見る。
// 現在の実ライブ画面ではTsukkomiDanmakuOverlayに置き換わっている（未使用）が、
// 将来また使われる可能性があるため、0068のキュー方式（src/lib/liveReactionQueue.ts）に
// 揃えて更新している。
const X_OFFSETS = [18, 62, 38, 78, 26, 50, 70, 34, 58];
const FLOAT_DURATION_MS = 1800;
const REMOVE_FALLBACK_MS = FLOAT_DURATION_MS + 500;
const MAX_CONCURRENT = 10;

function isFloatTarget(event: TsukkomiEvent): boolean {
  // 「爆笑」は下から上に浮くバッジではなく、LaughMarkOverlay側の観客の頭上マークで
  // 表現するため、ここでは素通りさせる（ツッコミ・拍手は従来通りここで浮かせる）。
  return !(event.kind === "stamp" && event.text === "爆笑");
}

export default function TsukkomiFloatOverlay() {
  const offsetIndexRef = useRef(0);

  const { items, remove } = useTsukkomiReactionQueue<FloatItem>({
    predicate: isFloatTarget,
    maxConcurrent: MAX_CONCURRENT,
    removeFallbackMs: REMOVE_FALLBACK_MS,
    mapToDisplay: (event) => {
      const xPercent = X_OFFSETS[offsetIndexRef.current % X_OFFSETS.length];
      offsetIndexRef.current += 1;
      return { id: event.id, kind: event.kind, text: event.text, xPercent };
    },
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-16 overflow-hidden sm:bottom-20">
      <AnimatePresence>
        {items.map((item) => (
          <motion.span
            key={item.id}
            initial={{ opacity: 0, bottom: "2%", left: `${item.xPercent}%` }}
            animate={{ opacity: [0, 1, 1, 0], bottom: "94%" }}
            exit={{ opacity: 0 }}
            transition={{ duration: FLOAT_DURATION_MS / 1000, ease: "easeOut" }}
            onAnimationComplete={() => remove(item.id)}
            className={`absolute -translate-x-1/2 whitespace-nowrap ${
              item.kind === "clap"
                ? "text-2xl"
                : "rounded-full border border-[#ffcf4a] bg-[#1a1a3a]/90 px-4 py-1 font-brush text-sm text-[#ffcf4a]"
            }`}
          >
            {item.kind === "clap" ? "👏" : item.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
