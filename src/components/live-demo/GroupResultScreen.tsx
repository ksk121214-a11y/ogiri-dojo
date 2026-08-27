"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import InitialAvatar from "@/components/app/InitialAvatar";
import MyIconAvatar from "@/components/app/MyIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getGroupTurnRanking,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { playSfx } from "@/lib/sfx";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// 組結果発表 L5：その周・その組のスコア上位、回答ハイライト
export default function GroupResultScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);

  // Strict Mode（開発時）はマウント直後のeffectを2回連続で実行するため、ガード無しだと
  // 音が二重に重なって鳴ってしまう。refで「もう鳴らした」を記録して2回目を防ぐ。
  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playSfx("groupResult");
  }, []);

  if (!turn) return null;
  const topicBody = getTopicBody(state, turn.topicId);
  const ranking = getGroupTurnRanking(state, turn.id);
  const laughAnswers = state.answers.filter(
    (a) => a.turnId === turn.id && a.laughTriggered,
  );

  return (
    <ScreenShell>
      <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white p-5 text-left shadow-[0_0_40px_rgba(59,91,255,0.45)]">
        <p className="text-center font-sans text-xs font-bold tracking-widest text-[#3b5bff]">
          組結果発表
        </p>
        <p className="mt-1 text-center font-sans text-xs text-[#6b6b90]">
          第{turn.round}周・{turn.groupOrder}組目・お題：{topicBody}
        </p>

        <div className="mt-4 space-y-2">
          {ranking.map((entry, idx) => {
            const isMe = entry.participant.id === MY_PARTICIPANT_ID;
            const participantIndex = state.participants.findIndex(
              (p) => p.id === entry.participant.id,
            );
            return (
              <motion.div
                key={entry.participant.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.12 }}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                  isMe ? "border-[#3b5bff] bg-[#eef1ff]" : "border-[#e4e6f5] bg-white"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5 font-sans text-sm text-[#1a1a3a]">
                  <span className="text-[#8a8ab0]">{idx + 1}位</span>
                  {isMe ? (
                    <MyIconAvatar size={28} />
                  ) : (
                    <InitialAvatar
                      name={entry.participant.displayName}
                      seed={participantIndex}
                      size={28}
                    />
                  )}
                  <span className="truncate">
                    {entry.participant.displayName}
                    {isMe ? "（あなた）" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-sans font-bold tabular-nums text-[#ff8f00]">
                    {entry.total}点
                  </span>
                  {!isMe && <ReportButton size={18} />}
                </span>
              </motion.div>
            );
          })}
        </div>

        {laughAnswers.length > 0 && (
          <p className="mt-4 text-center font-sans text-xs font-bold text-[#ff3b5b]">
            笑いエフェクト発生：{laughAnswers.length}件
          </p>
        )}
      </div>
    </ScreenShell>
  );
}
