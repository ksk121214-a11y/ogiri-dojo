"use client";

import { motion } from "framer-motion";

import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
  isMyGroupOnStage,
} from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// お題発表（L1b ミニ幕間 + お題提示）：組切替時は緞帳の帯が閉じるワイプ演出（デザイン方針§4.1）
export default function TopicRevealScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const onStage = isMyGroupOnStage(state);
  if (!turn || !stageGroup) return null;
  const topicBody = getTopicBody(state, turn.topicId);

  return (
    <ScreenShell>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 0.75, 1] }}
        style={{ transformOrigin: "left" }}
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-24 -translate-y-1/2 bg-dojo-curtain-red"
      />
      <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
        第{turn.round}周 ・ {turn.groupOrder}組目登場
        {onStage ? "（あなたの組です）" : ""}
      </p>
      <motion.h2
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-3 w-full max-w-full break-words px-2 font-brush text-xl text-dojo-curtain-gold sm:text-2xl"
      >
        {stageGroup.memberIds
          .map((id) => getParticipantName(state, id))
          .join(" / ")}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-10 max-w-2xl rounded-2xl border border-dojo-curtain-gold/60 bg-dojo-backstage-navy px-8 py-10 shadow-[0_0_40px_rgba(255,138,61,0.25)]"
      >
        <p className="font-sans text-xs tracking-widest text-dojo-spotlight-orange-light">
          お題
        </p>
        <p className="mt-4 font-sans text-2xl font-bold leading-relaxed text-dojo-washi-white sm:text-4xl">
          {topicBody}
        </p>
      </motion.div>
    </ScreenShell>
  );
}
