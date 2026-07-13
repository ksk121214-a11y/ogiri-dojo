"use client";

import { motion } from "framer-motion";

// お題を画面内で最も目立つ大きさで表示する共通コンポーネント。
// デザイン方針§4.2/§4.3：スポットライトの光の輪の中に浮かぶような見せ方。
// お題はゲームの肝のため、回答中・審査中・客席・舞台のどの状態でも同じ拡大表示で統一する
// （第5ラウンドフィードバック：状態によって小さくなる一行表示（旧compactモード）を廃止）。
// 画面の高さが極端に低いビューポート（[@media(max-height:600px)]）でのみ、
// はみ出し防止のためひとまわり小さいサイズにフォールバックする。
export default function TopicBanner({
  topicBody,
  roundLabel,
}: {
  topicBody: string;
  roundLabel?: string;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative w-full max-w-3xl rounded-2xl border border-dojo-curtain-gold/50 bg-dojo-backstage-navy/70 px-5 py-3 shadow-[0_0_45px_rgba(255,138,61,0.25)] sm:px-10 sm:py-5 [@media(max-height:600px)]:px-4 [@media(max-height:600px)]:py-2"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 rounded-2xl"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(255,138,61,0.18), transparent 70%)",
        }}
      />
      {roundLabel && (
        <p className="font-sans text-xs tracking-widest text-dojo-spotlight-orange-light">
          {roundLabel}
        </p>
      )}
      <p className="mt-1 font-sans text-xl font-black leading-snug text-dojo-washi-white sm:text-3xl md:text-4xl [@media(max-height:600px)]:text-lg">
        {topicBody}
      </p>
    </motion.div>
  );
}
