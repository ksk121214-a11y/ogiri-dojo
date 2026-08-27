"use client";

import { motion } from "framer-motion";

// お題を画面内で最も目立つ大きさで表示する共通コンポーネント。
// デザイン方針§4.2/§4.3：スポットライトの光の輪の中に浮かぶような見せ方。
// お題はゲームの肝のため、回答中・審査中・客席・舞台のどの状態でも同じ拡大表示で統一する
// （第5ラウンドフィードバック：状態によって小さくなる一行表示（旧compactモード）を廃止）。
// 背景は元は「お題パネル」素材画像（和紙+ネオングリーン枠）を使っていたが、
// 素材差し替え作業中に誤って上書き・消失させてしまったため、正式な画像が用意できるまでの
// 暫定として、CSSのみで和紙×金枠の見た目を再現している（画像が揃い次第Imageに戻す）。
export default function TopicBanner({
  topicBody,
  roundLabel,
  tall = false,
}: {
  topicBody: string;
  roundLabel?: string;
  tall?: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`relative mx-auto aspect-[1448/1086] w-full ${
        tall ? "max-w-lg sm:max-w-xl" : "max-w-4xl"
      }`}
    >
      <div
        className="absolute inset-0 rounded-2xl border-4 border-[#3b5bff] bg-white shadow-[0_0_25px_rgba(59,91,255,0.45)]"
      >
        <div className="absolute inset-[6px] rounded-xl border-2 border-[#3b5bff]/30" />
      </div>
      <span className="absolute left-[9%] top-[10%] rounded bg-[#3b5bff] px-2 py-0.5 font-sans text-[10px] font-bold text-white shadow sm:px-3 sm:py-1 sm:text-sm">
        お題
      </span>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-[16%] py-[16%] text-center [@media(max-height:600px)]:px-[11%] [@media(max-height:600px)]:py-[10%]">
        {roundLabel && (
          <p className="font-sans text-[10px] tracking-widest text-[#6b6b90] sm:text-xs">
            {roundLabel}
          </p>
        )}
        <p className="font-sans text-base font-black leading-snug text-[#1a1a3a] sm:text-2xl md:text-3xl [@media(max-height:600px)]:text-sm">
          {topicBody}
        </p>
      </div>
    </motion.div>
  );
}
