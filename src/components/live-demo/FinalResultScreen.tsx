"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import InitialAvatar from "@/components/app/InitialAvatar";
import MyIconAvatar from "@/components/app/MyIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import { BEST_ANSWER_BONUS_POINTS, BONUS_BY_RANK, MASTERY_GAIN } from "@/data/collectionData";
import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { getBestAnswer, getOverallRanking, getParticipantName } from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import { useUserStore } from "@/store/useUserStore";
import MasteryGauge from "./MasteryGauge";
import ScreenShell from "./ScreenShell";

// 最終結果 L6：本日のベストアンサー → 個人1〜3位（3位→2位→1位）→ 総合ランキング（§1.7）
// → 熟練度メーターの円形ゲージ演出（§6.3.5）
export default function FinalResultScreen() {
  const state = useLiveDemoStore((s) => s);
  const resetLive = useLiveDemoStore((s) => s.resetLive);
  const closeLive = useLiveDemoStore((s) => s.closeLive);
  const addPoints = useUserStore((s) => s.addPoints);
  const addMastery = useUserStore((s) => s.addMastery);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= 4) return;
    const t = setTimeout(() => setStep((s) => s + 1), 2000);
    return () => clearTimeout(t);
  }, [step]);

  const bestAnswer = getBestAnswer(state);
  const ranking = getOverallRanking(state);
  const top3 = ranking.slice(0, 3);
  const myRank = ranking.findIndex((r) => r.participant.id === MY_PARTICIPANT_ID) + 1;
  const myTotal = ranking.find((r) => r.participant.id === MY_PARTICIPANT_ID)?.total ?? 0;
  const gotBestAnswer = bestAnswer?.participantId === MY_PARTICIPANT_ID;

  // 表彰ボーナス（§5.4）・熟練度メーター加算（§6.2）を最終結果表示時に1回だけ確定させる。
  // マイページ側の表示にもそのまま反映されるよう共有ユーザーストアへ加算する（ダミー実装）。
  // baselineは「このライブで加算される前」の値をマウント時の1回だけ記憶しておく。
  const [baseline] = useState(() => useUserStore.getState().user.masteryMeter);
  const appliedRef = useRef(false);
  const rankBonus =
    myRank === 1
      ? BONUS_BY_RANK.first
      : myRank === 2
        ? BONUS_BY_RANK.second
        : myRank === 3
          ? BONUS_BY_RANK.third
          : BONUS_BY_RANK.participation;
  const masteryRankBonus =
    myRank === 1
      ? MASTERY_GAIN.rankBonus.first
      : myRank === 2
        ? MASTERY_GAIN.rankBonus.second
        : myRank === 3
          ? MASTERY_GAIN.rankBonus.third
          : 0;
  const pointsGain = rankBonus + (gotBestAnswer ? BEST_ANSWER_BONUS_POINTS : 0);
  const masteryGain =
    MASTERY_GAIN.participation +
    myTotal +
    masteryRankBonus +
    (gotBestAnswer ? MASTERY_GAIN.bestAnswer : 0);

  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    addPoints(pointsGain);
    addMastery(masteryGain);
    // このライブぶんの表彰ボーナス確定は最終結果表示時に1回だけ行う（closed時確定のダミー実装）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rankLabel = ["1位", "2位", "3位"];
  const rankColor = [
    "text-dojo-curtain-gold",
    "text-dojo-gold-foil",
    "text-dojo-spotlight-orange-light",
  ];
  // 順位別の表彰ボーナス（§5.4）を1〜3位発表カードにその場で明記する（第5ラウンドフィードバック）。
  const rankBonusPoints = [
    BONUS_BY_RANK.first,
    BONUS_BY_RANK.second,
    BONUS_BY_RANK.third,
  ];

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
        最終結果
      </p>
      <h2 className="mt-2 font-brush text-3xl text-dojo-curtain-gold sm:text-4xl">
        表彰式
      </h2>

      <div className="mt-8 flex min-h-[260px] w-full max-w-lg flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {step === 0 && bestAnswer && (
            <motion.div
              key="best"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-full rounded-2xl border border-dojo-cheer-pink/60 bg-dojo-backstage-navy p-6 shadow-[0_0_40px_rgba(255,111,165,0.3)]"
            >
              {bestAnswer.participantId !== MY_PARTICIPANT_ID && (
                <div className="absolute right-4 top-4">
                  <ReportButton />
                </div>
              )}
              <p className="font-sans text-xs tracking-widest text-dojo-cheer-pink">
                本日のベストアンサー
              </p>
              <div className="mt-3 flex items-center gap-2">
                {bestAnswer.participantId === MY_PARTICIPANT_ID ? (
                  <MyIconAvatar size={24} />
                ) : (
                  <InitialAvatar
                    name={getParticipantName(state, bestAnswer.participantId)}
                    seed={state.participants.findIndex(
                      (p) => p.id === bestAnswer.participantId,
                    )}
                    size={24}
                  />
                )}
                <p className="font-sans text-xs text-dojo-curtain-gold">
                  {getParticipantName(state, bestAnswer.participantId)}
                </p>
              </div>
              <p className="mt-2 font-sans text-xl font-bold leading-relaxed text-dojo-washi-white">
                {bestAnswer.body}
              </p>
              <p className="mt-3 font-sans text-sm font-bold text-dojo-spotlight-orange-light">
                {bestAnswer.scoreTotal}点
              </p>
            </motion.div>
          )}

          {step >= 1 && step <= 3 && top3.length >= step && (
            <motion.div
              key={`rank-${step}`}
              initial={{ opacity: 0, y: 30, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ type: "spring", stiffness: 200, damping: 16 }}
              className="relative w-full rounded-2xl border border-dojo-curtain-gold/70 bg-dojo-backstage-navy p-8 text-center shadow-[0_0_50px_rgba(232,184,76,0.35)]"
            >
              {top3[3 - step].participant.id !== MY_PARTICIPANT_ID && (
                <div className="absolute right-4 top-4">
                  <ReportButton />
                </div>
              )}
              <p
                className={`font-brush text-4xl ${rankColor[3 - step]}`}
              >
                {rankLabel[3 - step]}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                {top3[3 - step].participant.id === MY_PARTICIPANT_ID ? (
                  <MyIconAvatar size={32} />
                ) : (
                  <InitialAvatar
                    name={top3[3 - step].participant.displayName}
                    seed={state.participants.findIndex(
                      (p) => p.id === top3[3 - step].participant.id,
                    )}
                    size={32}
                  />
                )}
                <p className="font-sans text-lg font-bold text-dojo-washi-white">
                  {top3[3 - step].participant.displayName}
                  {top3[3 - step].participant.id === MY_PARTICIPANT_ID
                    ? "（あなた）"
                    : ""}
                </p>
              </div>
              <p className="mt-1 font-sans text-sm text-dojo-spotlight-orange-light">
                {top3[3 - step].total}点
              </p>
              <p className="mt-2 font-sans text-sm font-bold text-dojo-curtain-gold">
                表彰ボーナス +{rankBonusPoints[3 - step]}pt
              </p>
            </motion.div>
          )}

          {step >= 4 && (
            <motion.div
              key="overall"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full"
            >
              <p className="font-sans text-sm text-dojo-washi-white/80">
                あなたの総合順位：
                <span className="font-bold text-dojo-curtain-gold">
                  {myRank}位
                </span>
                （{ranking.length}人中）
              </p>
              <div className="mt-4 max-h-64 w-full space-y-1.5 overflow-y-auto">
                {ranking.map((r, idx) => {
                  const isMe = r.participant.id === MY_PARTICIPANT_ID;
                  const participantIndex = state.participants.findIndex(
                    (p) => p.id === r.participant.id,
                  );
                  return (
                    <div
                      key={r.participant.id}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        isMe
                          ? "border-dojo-curtain-gold bg-dojo-backstage-navy"
                          : "border-dojo-gray-purple/20 bg-dojo-backstage-navy/50"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0">{idx + 1}位</span>
                        {isMe ? (
                          <MyIconAvatar size={24} />
                        ) : (
                          <InitialAvatar
                            name={r.participant.displayName}
                            seed={participantIndex}
                            size={24}
                          />
                        )}
                        <span className="truncate">
                          {r.participant.displayName}
                          {isMe ? "（あなた）" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-dojo-spotlight-orange-light">
                          {r.total}点
                        </span>
                        {!isMe && <ReportButton size={16} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {step >= 4 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8 flex w-full max-w-lg flex-col items-center rounded-2xl border border-dojo-curtain-gold/30 bg-dojo-backstage-navy/50 px-6 py-6"
        >
          <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
            熟練度メーター獲得
          </p>
          <div className="mt-4">
            <MasteryGauge baseline={baseline} gained={masteryGain} />
          </div>
          <p className="mt-4 font-sans text-xs text-dojo-washi-white/80">
            獲得ポイント：
            <span className="font-bold text-dojo-curtain-gold">
              +{pointsGain}pt
            </span>
          </p>
        </motion.div>
      )}

      {step >= 4 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4"
        >
          <button
            type="button"
            onClick={closeLive}
            className="rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
          >
            閉幕する
          </button>
          <button
            type="button"
            onClick={resetLive}
            className="rounded-full border border-dojo-gray-purple/40 px-6 py-3 font-sans text-sm text-dojo-washi-white/90 transition hover:border-dojo-curtain-gold hover:text-dojo-curtain-gold"
          >
            もう一度体験する
          </button>
        </motion.div>
      )}
    </ScreenShell>
  );
}
