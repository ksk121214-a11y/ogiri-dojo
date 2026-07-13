"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useLiveDemoStore } from "@/store/useLiveDemoStore";

interface FloatItem {
  id: number;
  kind: "clap" | "stamp";
  text: string;
  xPercent: number;
}

// 横方向の出現位置候補（ランダム関数を使わずローテーションで散らす）
const X_OFFSETS = [18, 62, 38, 78, 26, 50, 70, 34, 58];
const FLOAT_DURATION_MS = 1800;
// フェイルセーフの消去タイムアウト（onAnimationCompleteが何らかの理由で発火しなくても、
// 必ずこの時間内に消えることを保証する。C要件「確実に一定時間後にフェードアウトして消える」）
const REMOVE_FALLBACK_MS = FLOAT_DURATION_MS + 500;
// 同時に画面に存在できる最大件数（連打時に際限なく積み上がらないようにする）
const MAX_CONCURRENT = 8;

// 拍手・テンプレツッコミの浮遊エフェクト。ボタン列のすぐ上（画面下部）から出現し、
// 画面の上の方に向かって移動しながらフェードアウトする（デザイン方針§4.4・仕様書C要件）。
// 舞台（回答者）画面・客席（観客）画面のどちらでも同じイベントが見えるようにする（§9）。
export default function TsukkomiFloatOverlay() {
  const tsukkomiSeq = useLiveDemoStore((s) => s.tsukkomiSeq);
  const lastTsukkomi = useLiveDemoStore((s) => s.lastTsukkomi);
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

    // フェイルセーフ：何らかの理由でonAnimationCompleteが発火しなくても必ず消す
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
