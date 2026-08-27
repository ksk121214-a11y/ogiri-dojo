"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// ツッコミワード・拍手を、観客シルエット(AudienceLayer)の上をニコニコ動画風に
// 右から左へ流す演出。以前は画面下部から上に浮くバッジ(TsukkomiFloatOverlay)
// だったが、それに代えてこちらを使う。「爆笑」はLaughMarkOverlay側の頭上マークで
// 表現するため、ここでは扱わない(素通りさせる)。
// src/components/live-room/TsukkomiDanmakuOverlay.tsxと同じ演出だが、あちらは
// useLiveFollowerStoreのtsukkomiSeqを見る点だけがこちら(useLiveDemoStore)と異なる。
//
// AudienceLayer呼び出し側と同じfixedRenderWidthPx=614/fixedRenderHeightPx=216/
// bottom=-45pxのボックスに重ねて配置する(LaughMarkOverlayと同じ理由)。
const LANES = [-4, 4, 12]; // ボックス内でのtop%。観客の頭が並ぶ帯（0〜16%あたり）を狙う。
const SCROLL_DURATION_MS = 4200;
const REMOVE_FALLBACK_MS = SCROLL_DURATION_MS + 500;

interface DanmakuItem {
  id: number;
  kind: "clap" | "stamp";
  text: string;
  topPercent: number;
}

export default function TsukkomiDanmakuOverlay() {
  const tsukkomiSeq = useLiveDemoStore((s) => s.tsukkomiSeq);
  const lastTsukkomi = useLiveDemoStore((s) => s.lastTsukkomi);
  const [items, setItems] = useState<DanmakuItem[]>([]);
  const seenSeqRef = useRef(tsukkomiSeq);
  const laneIndexRef = useRef(0);

  useEffect(() => {
    if (
      tsukkomiSeq === seenSeqRef.current ||
      !lastTsukkomi ||
      (lastTsukkomi.kind === "stamp" && lastTsukkomi.text === "爆笑")
    ) {
      return;
    }
    seenSeqRef.current = tsukkomiSeq;

    const topPercent = LANES[laneIndexRef.current % LANES.length];
    laneIndexRef.current += 1;
    const item: DanmakuItem = {
      id: lastTsukkomi.id,
      kind: lastTsukkomi.kind,
      text: lastTsukkomi.text,
      topPercent,
    };
    setItems((prev) => [...prev, item]);

    const fallback = setTimeout(() => {
      setItems((prev) => prev.filter((v) => v.id !== item.id));
    }, REMOVE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [tsukkomiSeq, lastTsukkomi]);

  const remove = (id: number) => {
    setItems((prev) => prev.filter((v) => v.id !== id));
  };

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 overflow-hidden"
      style={{ width: 614, height: 216, bottom: -45 }}
    >
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ left: "110%" }}
            animate={{ left: "-60%" }}
            transition={{ duration: SCROLL_DURATION_MS / 1000, ease: "linear" }}
            onAnimationComplete={() => remove(item.id)}
            className="absolute whitespace-nowrap"
            style={{ top: `${item.topPercent}%` }}
          >
            {item.kind === "clap" ? (
              <span className="text-3xl drop-shadow-[0_0_6px_rgba(0,0,0,0.6)]">👏</span>
            ) : (
              <span className="rounded-full border border-[#3b5bff] bg-[#0d0a1a]/90 px-4 py-1 font-sans text-sm font-bold text-[#7ab2ff]">
                {item.text}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
