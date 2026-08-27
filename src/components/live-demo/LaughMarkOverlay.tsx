"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// 「爆笑」ボタンを押した瞬間、観客シルエット(AudienceLayer)のどこか1人の頭の上に、
// 漫画的な「大笑いのシワ」マークを1回だけ出す演出。
// src/components/live-room/LaughMarkOverlay.tsxと同じ演出だが、あちらは
// useLiveFollowerStoreのtsukkomiSeqを見る点だけがこちら(useLiveDemoStore)と異なる。
// タイマー・state更新の構成はsrc/components/live-demo/TsukkomiFloatOverlay.tsxを踏襲している。
//
// マークを出す座標は、AudienceLayerが描画しているaudience-2-crop.png(537x189)を
// 実際にピクセル解析し、シルエットの「頭のてっぺん」に相当するローカル極小点を
// 抽出した実測値(画像に対する%)。AudienceLayer呼び出し側と同じ
// fixedRenderWidthPx=614/fixedRenderHeightPx=216/bottom=-45pxのボックスに
// 重ねて配置するため、この座標のまま流用できる(画像とボックスの縦横比がほぼ同じため
// object-containによる余白もほぼ発生しない)。押すたびにこの中からランダムに1箇所選ぶ。
const HEAD_POSITIONS = [
  { x: 15.5, y: 0.5 },
  { x: 22.7, y: 15.3 },
  { x: 29.6, y: 0.0 },
  { x: 37.1, y: 15.9 },
  { x: 43.8, y: 0.5 },
  { x: 55.1, y: 0.5 },
  { x: 62.4, y: 15.3 },
  { x: 68.3, y: 0.0 },
  { x: 75.4, y: 15.3 },
  { x: 81.9, y: 0.0 },
];

const MARK_DURATION_MS = 900;
const REMOVE_FALLBACK_MS = MARK_DURATION_MS + 500;

interface LaughMark {
  id: string;
  x: number;
  y: number;
  rotate: number;
}

// 「大笑いのシワ」マーク本体。弧を描く太いアーチ状の線に、短い線3本が
// 縦方向に重なるように交差する、笑い顔イラストの目尻によく付いている表現。
function LaughCreaseIcon() {
  return (
    <svg viewBox="0 0 90 60" width="30" height="20" className="overflow-visible">
      <path
        d="M8 50 Q45 18 82 42"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <line x1="17" y1="30" x2="28" y2="49" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <line x1="44" y1="21" x2="46" y2="43" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <line x1="64" y1="45" x2="71" y2="24" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export default function LaughMarkOverlay() {
  const tsukkomiSeq = useLiveDemoStore((s) => s.tsukkomiSeq);
  const lastTsukkomi = useLiveDemoStore((s) => s.lastTsukkomi);
  const [marks, setMarks] = useState<LaughMark[]>([]);
  const seenSeqRef = useRef(tsukkomiSeq);

  useEffect(() => {
    if (
      tsukkomiSeq === seenSeqRef.current ||
      !lastTsukkomi ||
      lastTsukkomi.kind !== "stamp" ||
      lastTsukkomi.text !== "爆笑"
    ) {
      return;
    }
    seenSeqRef.current = tsukkomiSeq;

    const pos = HEAD_POSITIONS[Math.floor(Math.random() * HEAD_POSITIONS.length)];
    const mark: LaughMark = {
      id: `${lastTsukkomi.id}`,
      x: pos.x + (Math.random() - 0.5) * 4,
      y: pos.y + (Math.random() - 0.5) * 4,
      rotate: (Math.random() - 0.5) * 8,
    };
    setMarks((prev) => [...prev, mark]);

    const fallback = setTimeout(() => {
      setMarks((prev) => prev.filter((m) => m.id !== mark.id));
    }, REMOVE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [tsukkomiSeq, lastTsukkomi]);

  const remove = (id: string) => {
    setMarks((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[6] -translate-x-1/2"
      style={{ width: 614, height: 216, bottom: -45 }}
    >
      <AnimatePresence>
        {marks.map((mark) => (
          <motion.div
            key={mark.id}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 0.8] }}
            exit={{ opacity: 0 }}
            transition={{ duration: MARK_DURATION_MS / 1000, ease: "easeOut" }}
            onAnimationComplete={() => remove(mark.id)}
            className="absolute -translate-x-1/2 -translate-y-full text-white drop-shadow-[0_0_6px_rgba(122,178,255,0.9)]"
            style={{ left: `${mark.x}%`, top: `${mark.y}%`, rotate: mark.rotate }}
          >
            <LaughCreaseIcon />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
