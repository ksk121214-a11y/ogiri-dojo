"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import type { FinalResultData } from "@/store/useLiveFollowerStore";

// 本番のsrc/components/live-room/FinalResultView.tsxと同じデータ形(FinalResultData)・
// 同じ演出構成(ベストアンサー→3位→2位→1位→総合順位一覧)を、ネオン意匠で
// 表示するdesign-preview-2専用コピー。
const RANK_LABEL = ["1位", "2位", "3位"];
const RANK_COLOR = ["text-[#ffcf4a]", "text-[#c8d4ff]", "text-[#ff8f4a]"];

const AVATAR_GRADIENTS = [
  "from-[#3b5bff] to-[#7ab2ff]",
  "from-[#ff3b5b] to-[#ff8f9f]",
  "from-[#ffcf4a] to-[#ffe9a8]",
  "from-[#7a3bff] to-[#b28cff]",
  "from-[#3bd0ff] to-[#8ce9ff]",
];

function ResultAvatar({ name, seed, size = 28 }: { name: string; seed: number; size?: number }) {
  const idx = ((seed % AVATAR_GRADIENTS.length) + AVATAR_GRADIENTS.length) % AVATAR_GRADIENTS.length;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/30 bg-gradient-to-br font-sans font-bold text-white ${AVATAR_GRADIENTS[idx]}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export default function FinalResultViewPreview2({
  data,
  myParticipantId,
}: {
  data: FinalResultData;
  myParticipantId: string | null;
}) {
  const [step, setStep] = useState(0);
  const top3 = data.ranking.slice(0, 3);

  useEffect(() => {
    if (step >= 4) return;
    const t = setTimeout(() => setStep((s) => s + 1), 2000);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-[#0d0a1a] p-5 text-white shadow-[0_0_40px_rgba(59,91,255,0.55)]">
      <p className="text-center font-sans text-xs font-bold tracking-widest text-[#ffcf4a]">
        最終結果・表彰式
      </p>

      <div className="mt-4 flex min-h-[220px] w-full flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {step === 0 && data.bestAnswer && (
            <motion.div
              key="best"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="w-full rounded-xl border border-[#ff3b5b]/70 bg-white/5 p-4 text-left"
            >
              <p className="font-sans text-xs font-bold tracking-widest text-[#ff3b5b]">
                本日のベストアンサー
              </p>
              <p className="mt-2 font-sans text-xs text-[#ffcf4a]">{data.bestAnswer.name}</p>
              <p className="mt-1 font-sans text-lg font-bold leading-relaxed">
                {data.bestAnswer.body}
              </p>
              <p className="mt-2 font-sans text-sm font-bold text-[#ff8f4a]">
                {data.bestAnswer.scoreTotal}点
              </p>
            </motion.div>
          )}

          {step >= 1 && step <= 3 && top3[3 - step] && (
            <motion.div
              key={`rank-${step}`}
              initial={{ opacity: 0, y: 30, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ type: "spring", stiffness: 200, damping: 16 }}
              className="w-full rounded-xl border border-[#3b5bff]/70 bg-white/5 p-6 text-center"
            >
              <p className={`font-sans text-3xl font-black ${RANK_COLOR[3 - step]}`}>
                {RANK_LABEL[3 - step]}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <ResultAvatar name={top3[3 - step].name} seed={3 - step} />
                <p className="font-sans text-lg font-bold">
                  {top3[3 - step].name}
                  {top3[3 - step].participantId === myParticipantId ? "（あなた）" : ""}
                </p>
              </div>
              <p className="mt-1 font-sans text-sm font-bold text-[#ff8f4a]">
                {top3[3 - step].total}点
              </p>
            </motion.div>
          )}

          {step >= 4 && (
            <motion.div key="overall" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full">
              {data.myRank !== null && (
                <p className="text-center font-sans text-sm text-white/80">
                  あなたの総合順位：
                  <span className="font-bold text-[#ffcf4a]">{data.myRank}位</span>
                  （{data.ranking.length}人中）
                </p>
              )}
              <div className="mt-3 max-h-64 w-full space-y-1.5 overflow-y-auto">
                {data.ranking.map((r, idx) => {
                  const isMe = r.participantId === myParticipantId;
                  return (
                    <div
                      key={r.participantId}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        isMe ? "border-[#3b5bff] bg-white/10" : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0">{idx + 1}位</span>
                        <ResultAvatar name={r.name} seed={idx} size={24} />
                        <span className="truncate">
                          {r.name}
                          {isMe ? "（あなた）" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-sans font-bold tabular-nums text-[#ff8f4a]">
                        {r.total}点
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
