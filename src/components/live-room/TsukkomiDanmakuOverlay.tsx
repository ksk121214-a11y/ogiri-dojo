"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";

import { useTsukkomiReactionQueue } from "@/lib/liveReactionQueue";
import type { TsukkomiEvent } from "@/store/useLiveFollowerStore";

// ツッコミワード・拍手を、観客シルエット(AudienceLayer)の上をニコニコ動画風に
// 右から左へ流す演出。以前は画面下部から上に浮くバッジ(TsukkomiFloatOverlay)
// だったが、それに代えてこちらを使う。「爆笑」はLaughMarkOverlay側の頭上マークで
// 表現するため、ここでは扱わない(素通りさせる)。
// src/components/live-demo/TsukkomiDanmakuOverlay.tsxと同じ演出だが、あちらは
// useLiveDemoStoreのtsukkomiSeqを見る点だけがこちら(useLiveFollowerStore)と異なる。
//
// AudienceLayer呼び出し側と同じfixedRenderWidthPx=614/fixedRenderHeightPx=216/
// bottom=-45pxのボックスに重ねて配置する(LaughMarkOverlayと同じ理由)。
//
// 0068：単一のlastTsukkomiを見て毎回上書きする方式から、useLiveFollowerStoreの
// 待機キュー(tsukkomiQueue)から順番に取り出すキュー方式に変更した
// （src/lib/liveReactionQueue.ts参照）。10〜20人がほぼ同時に押しても、各参加者の
// イベントを1件ずつ表示する（最後の一件で上書きしない）。
const LANES = [-4, 4, 12]; // ボックス内でのtop%。観客の頭が並ぶ帯（0〜16%あたり）を狙う。
const SCROLL_DURATION_MS = 4200;
const REMOVE_FALLBACK_MS = SCROLL_DURATION_MS + 500;
const MAX_CONCURRENT = 10;

interface DanmakuItem {
  id: string;
  kind: "clap" | "stamp";
  text: string;
  topPercent: number;
}

function isDanmakuTarget(event: TsukkomiEvent): boolean {
  // 「爆笑」はLaughMarkOverlay側の頭上マークで表現するため、ここでは素通りさせる。
  return !(event.kind === "stamp" && event.text === "爆笑");
}

export default function TsukkomiDanmakuOverlay() {
  const laneIndexRef = useRef(0);

  const { items, remove } = useTsukkomiReactionQueue<DanmakuItem>({
    predicate: isDanmakuTarget,
    maxConcurrent: MAX_CONCURRENT,
    removeFallbackMs: REMOVE_FALLBACK_MS,
    mapToDisplay: (event) => {
      const topPercent = LANES[laneIndexRef.current % LANES.length];
      laneIndexRef.current += 1;
      return { id: event.id, kind: event.kind, text: event.text, topPercent };
    },
  });

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
