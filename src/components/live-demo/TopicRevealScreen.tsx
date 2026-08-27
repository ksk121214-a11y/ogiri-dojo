"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { DEMO_TIMING } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
  isMyGroupOnStage,
} from "@/lib/liveDemoSelectors";
import { playSfx } from "@/lib/sfx";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// public/sounds/topic-reveal.mp3（歓声と拍手）の実測尺（afinfoで確認、約4.1秒）。
const TOPIC_REVEAL_SE_MS = 4100;
// ライブ画面に切り替わった後、この効果音をどれだけ被らせて鳴り終わらせたいか。
const OVERLAP_MS = 800;

// お題発表（L1b ミニ幕間 + お題提示）：組切替時は緞帳の帯が閉じるワイプ演出（デザイン方針§4.1）
export default function TopicRevealScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const onStage = isMyGroupOnStage(state);

  // 出囃子(BGM)が鳴っている途中で客席がわっと沸く演出にしたいので、画面表示と同時ではなく
  // お題発表フェーズの終盤で鳴らし、ライブ画面への切り替わり後も少しだけ被って鳴り終わる
  // ようにする（この効果音自体はplaySfx側で画面のマウント状態と無関係に再生されるため、
  // 画面が切り替わっても鳴り止まない）。音源(topic-reveal.mp3)の実測尺は約4.1秒なので、
  // 「フェーズ終了 - 尺 + 被らせたい量」を開始タイミングとして逆算する（フェーズがそれより
  // 短い場合はマイナスになるためMath.maxで0に丸め、単純に画面表示と同時に鳴らす）。
  // Strict Mode（開発時）はマウント直後のeffectを2回連続で実行するため、ガード無しだと
  // タイマーも二重に仕掛けられてしまう。refで「もう仕掛けた」を記録して2回目を防ぐ
  // （cleanupでのタイマー解除はしない＝画面遷移後も鳴り切らせたいのであえて放置する）。
  const scheduledRef = useRef(false);
  useEffect(() => {
    if (scheduledRef.current) return;
    scheduledRef.current = true;
    const delay = Math.max(0, DEMO_TIMING.topicRevealMs - TOPIC_REVEAL_SE_MS + OVERLAP_MS);
    setTimeout(() => playSfx("topicReveal"), delay);
  }, []);

  if (!turn || !stageGroup) return null;
  const topicBody = getTopicBody(state, turn.topicId);

  return (
    <ScreenShell>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 0.75, 1] }}
        style={{ transformOrigin: "left" }}
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-24 -translate-y-1/2 bg-[#3b5bff]"
      />
      <p className="font-sans text-xs tracking-widest text-white/60">
        第{turn.round}周 ・ {turn.groupOrder}組目登場
        {onStage ? "（あなたの組です）" : ""}
      </p>
      <motion.h2
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-3 w-full max-w-full break-words px-2 font-sans text-xl font-bold text-[#7ab2ff] sm:text-2xl"
      >
        {stageGroup.memberIds
          .map((id) => getParticipantName(state, id))
          .join(" / ")}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-10 max-w-2xl rounded-[28px] border-[5px] border-[#3b5bff] bg-white px-8 py-10 text-center shadow-[0_0_50px_rgba(59,91,255,0.6)]"
      >
        <span className="rounded-full bg-[#3b5bff] px-4 py-1.5 font-sans text-sm font-bold text-white">
          お題
        </span>
        <p className="mt-4 font-sans text-2xl font-black leading-relaxed text-[#1a1a3a] sm:text-4xl">
          {topicBody}
        </p>
      </motion.div>
    </ScreenShell>
  );
}
