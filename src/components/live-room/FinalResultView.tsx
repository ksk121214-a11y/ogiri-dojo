"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import ParticipantIconAvatar from "@/components/app/ParticipantIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { playSfx } from "@/lib/sfx";
import type { FinalResultData, ParticipantAvatarInfo } from "@/store/useLiveFollowerStore";

const EMPTY_AVATARS: Record<string, ParticipantAvatarInfo> = {};

// 実バックエンド版ライブの最終結果発表。src/components/live-demo/FinalResultScreen.tsxと
// 同じアクセントカラー（本日のベストアンサー＝赤枠、1〜3位＝青枠）を使うが、この
// フォールバック画面自体は（live-demoのような常時ダーク背景の没入演出ではなく）
// 明るい背景のページに埋め込まれるため、GroupResultViewと同じ白カードにして馴染ませる。
// 熟練度メーター/表彰ポイント等のマイページ側メタ進行要素はこのライブ機能のスコープ外
// として含めない（ランキングと本日のベストアンサーの表示に絞る）。
const RANK_LABEL = ["1位", "2位", "3位"];
const RANK_COLOR = ["text-[#ffcf4a]", "text-[#8a93c7]", "text-[#ff8f4a]"];

export default function FinalResultView({
  data,
  myParticipantId,
  participantAvatars = EMPTY_AVATARS,
}: {
  data: FinalResultData;
  myParticipantId: string | null;
  participantAvatars?: Record<string, ParticipantAvatarInfo>;
}) {
  const [step, setStep] = useState(0);
  const top3 = data.ranking.slice(0, 3);

  useEffect(() => {
    if (step >= 4) return;
    const t = setTimeout(() => setStep((s) => s + 1), 2000);
    return () => clearTimeout(t);
  }, [step]);

  // 3位→2位→1位と切り替わるたびに発表音を鳴らす（step0=ベストアンサーは対象外）。
  useEffect(() => {
    if (step >= 1) playSfx("rankReveal");
  }, [step]);

  return (
    <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white p-5 text-[#1a1a3a] shadow-[0_0_40px_rgba(59,91,255,0.45)]">
      <p className="text-center font-sans text-xs font-bold tracking-widest text-[#3b5bff]">
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
              className="w-full rounded-xl border border-[#ff3b5b]/60 bg-[#fff5f6] p-4 text-left"
            >
              <p className="font-sans text-xs font-bold tracking-widest text-[#ff3b5b]">
                本日のベストアンサー
              </p>
              <div className="mt-2 flex items-center gap-2">
                {data.bestAnswer.participantId === myParticipantId ? (
                  <MyIconAvatar size={22} bare />
                ) : (
                  <ParticipantIconAvatar
                    participantId={data.bestAnswer.participantId}
                    avatarIcon={participantAvatars[data.bestAnswer.participantId]?.icon}
                    avatarColor={participantAvatars[data.bestAnswer.participantId]?.color}
                    size={22}
                    bare
                  />
                )}
                <p className="font-sans text-xs text-[#6b6b90]">{data.bestAnswer.name}</p>
              </div>
              <p className="mt-1 font-sans text-lg font-bold leading-relaxed">
                {data.bestAnswer.body}
              </p>
              <p className="mt-2 font-sans text-sm font-bold text-[#ff8f00]">
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
              className="w-full rounded-xl border border-[#3b5bff]/60 bg-[#eef1ff] p-6 text-center"
            >
              <p className={`font-sans text-3xl font-black ${RANK_COLOR[3 - step]}`}>
                {RANK_LABEL[3 - step]}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {top3[3 - step].participantId === myParticipantId ? (
                  <MyIconAvatar size={28} bare />
                ) : (
                  <ParticipantIconAvatar
                    participantId={top3[3 - step].participantId}
                    avatarIcon={participantAvatars[top3[3 - step].participantId]?.icon}
                    avatarColor={participantAvatars[top3[3 - step].participantId]?.color}
                    size={28}
                    bare
                  />
                )}
                <p className="font-sans text-lg font-bold">
                  {truncateLiveDisplayName(top3[3 - step].name)}
                </p>
              </div>
              <p className="mt-1 font-sans text-sm font-bold text-[#ff8f00]">
                {top3[3 - step].total}点
              </p>
            </motion.div>
          )}

          {step >= 4 && (
            <motion.div key="overall" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full">
              {data.myRank !== null && (
                <p className="text-center font-sans text-sm text-[#6b6b90]">
                  あなたの総合順位：
                  <span className="font-bold text-[#3b5bff]">{data.myRank}位</span>
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
                        isMe ? "border-[#3b5bff] bg-[#eef1ff]" : "border-[#e4e6f5] bg-white"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-[#8a8ab0]">{idx + 1}位</span>
                        {isMe ? (
                          <MyIconAvatar size={24} bare />
                        ) : (
                          <ParticipantIconAvatar
                            participantId={r.participantId}
                            avatarIcon={participantAvatars[r.participantId]?.icon}
                            avatarColor={participantAvatars[r.participantId]?.color}
                            size={24}
                            bare
                          />
                        )}
                        <span className="truncate">{truncateLiveDisplayName(r.name)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-[#ff8f00]">{r.total}点</span>
                        {!isMe && <ReportButton size={16} />}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-center">
                <Link
                  href="/"
                  className="rounded-full bg-[#3b5bff] px-6 py-2.5 font-sans text-sm font-bold text-white transition hover:bg-[#2947e0]"
                >
                  ホームに戻る
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
