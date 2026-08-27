"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useLiveDesignPreviewStore } from "@/store/useLiveDesignPreviewStore";

interface FloatItem {
  id: number;
  kind: "clap" | "stamp";
  text: string;
  xPercent: number;
}

// src/components/live-room/TsukkomiFloatOverlay.tsxと同じ演出だが、
// デザイン確認用にuseLiveFollowerStoreではなくuseLiveDesignPreviewStoreを見る。
const X_OFFSETS = [18, 62, 38, 78, 26, 50, 70, 34, 58];
const FLOAT_DURATION_MS = 1800;
const REMOVE_FALLBACK_MS = FLOAT_DURATION_MS + 500;
const MAX_CONCURRENT = 8;

export default function TsukkomiFloatOverlayPreview() {
  const tsukkomiSeq = useLiveDesignPreviewStore((s) => s.tsukkomiSeq);
  const lastTsukkomi = useLiveDesignPreviewStore((s) => s.lastTsukkomi);
  const [items, setItems] = useState<FloatItem[]>([]);
  const seenSeqRef = useRef(tsukkomiSeq);
  const offsetIndexRef = useRef(0);

  useEffect(() => {
    if (tsukkomiSeq === seenSeqRef.current || !lastTsukkomi) return;
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
    <div className="pointer-events-none absolute inset-x-0 top-0 bottom-16 overflow-hidden">
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
                : "rounded-full border border-dojo-curtain-gold bg-dojo-stage-dark/90 px-4 py-1 font-brush text-sm text-dojo-curtain-gold"
            }`}
          >
            {item.kind === "clap" ? "👏" : item.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
