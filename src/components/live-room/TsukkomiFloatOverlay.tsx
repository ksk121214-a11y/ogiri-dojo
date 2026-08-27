"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

interface FloatItem {
  id: number;
  kind: "clap" | "stamp";
  text: string;
  xPercent: number;
}

// src/components/live-demo/TsukkomiFloatOverlay.tsxと同じ演出だが、
// useLiveDemoStoreではなく実際にRealtimeブロードキャストで届いたイベント(useLiveFollowerStore)を見る。
const X_OFFSETS = [18, 62, 38, 78, 26, 50, 70, 34, 58];
const FLOAT_DURATION_MS = 1800;
const REMOVE_FALLBACK_MS = FLOAT_DURATION_MS + 500;
const MAX_CONCURRENT = 8;

export default function TsukkomiFloatOverlay() {
  const tsukkomiSeq = useLiveFollowerStore((s) => s.tsukkomiSeq);
  const lastTsukkomi = useLiveFollowerStore((s) => s.lastTsukkomi);
  const [items, setItems] = useState<FloatItem[]>([]);
  const seenSeqRef = useRef(tsukkomiSeq);
  const offsetIndexRef = useRef(0);

  useEffect(() => {
    // 「爆笑」は下から上に浮くバッジではなく、LaughMarkOverlay側の観客の頭上マークで
    // 表現するため、ここでは素通りさせる（ツッコミ・拍手は従来通りここで浮かせる）。
    if (
      tsukkomiSeq === seenSeqRef.current ||
      !lastTsukkomi ||
      (lastTsukkomi.kind === "stamp" && lastTsukkomi.text === "爆笑")
    ) {
      return;
    }
    seenSeqRef.current = tsukkomiSeq;
    const xPercent = X_OFFSETS[offsetIndexRef.current % X_OFFSETS.length];
    offsetIndexRef.current += 1;
    const item: FloatItem = {
      id: lastTsukkomi.id,
      kind: lastTsukkomi.kind,
      text: lastTsukkomi.text,
      xPercent,
    };
    setItems((prev) => [...prev.slice(-(MAX_CONCURRENT - 1)), item]);

    const fallback = setTimeout(() => {
      setItems((prev) => prev.filter((v) => v.id !== item.id));
    }, REMOVE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [tsukkomiSeq, lastTsukkomi]);

  const remove = (id: number) => {
    setItems((prev) => prev.filter((v) => v.id !== id));
  };

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
