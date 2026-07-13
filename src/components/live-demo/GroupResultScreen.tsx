"use client";

import { motion } from "framer-motion";

import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getGroupTurnRanking,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// 組結果発表 L5：その周・その組のスコア上位、回答ハイライト
export default function GroupResultScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);
  if (!turn) return null;
  const topicBody = getTopicBody(state, turn.topicId);
  const ranking = getGroupTurnRanking(state, turn.id);
  const laughAnswers = state.answers.filter(
    (a) => a.turnId === turn.id && a.laughTriggered,
  );

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
        第{turn.round}周 ・ {turn.groupOrder}組目・結果
      </p>
      <h2 className="mt-2 font-brush text-2xl text-dojo-curtain-gold sm:text-3xl">
        組結果発表
      </h2>
      <p className="mt-2 max-w-lg font-sans text-xs text-dojo-washi-white/60">
        お題：{topicBody}
      </p>

      <div className="mt-6 w-full max-w-md space-y-2">
        {ranking.map((entry, idx) => (
          <motion.div
            key={entry.participant.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.12 }}
            className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
              entry.participant.id === MY_PARTICIPANT_ID
                ? "border-dojo-curtain-gold bg-dojo-backstage-navy"
                : "border-dojo-gray-purple/20 bg-dojo-backstage-navy/60"
            }`}
          >
            <span className="font-sans text-sm">
              <span className="mr-2 text-dojo-gray-purple">{idx + 1}位</span>
              {entry.participant.displayName}
              {entry.participant.id === MY_PARTICIPANT_ID ? "（あなた）" : ""}
            </span>
            <span className="font-sans font-bold tabular-nums text-dojo-spotlight-orange-light">
              {entry.total}点
            </span>
          </motion.div>
        ))}
      </div>

      {laughAnswers.length > 0 && (
        <div className="mt-6 max-w-md font-sans text-xs text-dojo-cheer-pink">
          笑いエフェクト発生：{laughAnswers.length}件
        </div>
      )}
    </ScreenShell>
  );
}
