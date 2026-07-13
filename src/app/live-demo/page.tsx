"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect } from "react";

import AudienceScreen from "@/components/live-demo/AudienceScreen";
import ClosedScreen from "@/components/live-demo/ClosedScreen";
import FinalResultScreen from "@/components/live-demo/FinalResultScreen";
import GroupResultScreen from "@/components/live-demo/GroupResultScreen";
import InterludeScreen from "@/components/live-demo/InterludeScreen";
import LaughEffectOverlay from "@/components/live-demo/LaughEffectOverlay";
import OpeningScreen from "@/components/live-demo/OpeningScreen";
import StageScreen from "@/components/live-demo/StageScreen";
import StartScreen from "@/components/live-demo/StartScreen";
import TopicRevealScreen from "@/components/live-demo/TopicRevealScreen";
import { isMyGroupOnStage } from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// ライブ体験モック（/live-demo）：ダミーデータ・ローカル状態管理のみで進行するステートマシンのお試し実装。
// 本来はサーバ（Supabase Realtime）基準で全クライアントに同期する（仕様書 §1.4・§13）が、
// このモックでは1台のブラウザ内のタイマーで代用する。
export default function LiveDemoPage() {
  const status = useLiveDemoStore((s) => s.status);
  const phase = useLiveDemoStore((s) => s.phase);
  const judging = useLiveDemoStore((s) => s.judging);
  const tick = useLiveDemoStore((s) => s.tick);
  const sendTsukkomi = useLiveDemoStore((s) => s.sendTsukkomi);
  const onStage = useLiveDemoStore(isMyGroupOnStage);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      tick(Date.now());
    }, 150);
    return () => clearInterval(id);
  }, [status, tick]);

  // 客席のボット観客たちが、サイクル外でランダムに拍手する演出（純演出・スコア非加算 §4.4）。
  // 舞台・客席のどちらの画面を見ていても同じ客席の熱量が伝わるよう、画面に依存せずここで発生させる（§9）。
  useEffect(() => {
    if (status !== "running" || phase !== "answering" || judging) return;
    const id = setInterval(() => {
      if (Math.random() < 0.5) sendTsukkomi("clap", "👏");
    }, 1400);
    return () => clearInterval(id);
  }, [status, phase, judging, sendTsukkomi]);

  let content: React.ReactNode = null;
  if (status === "idle") {
    content = <StartScreen key="start" />;
  } else {
    switch (phase) {
      case "interlude":
        content = <InterludeScreen key="interlude" />;
        break;
      case "opening":
        content = <OpeningScreen key="opening" />;
        break;
      case "topic_reveal":
        content = <TopicRevealScreen key="topic_reveal" />;
        break;
      case "answering":
        content = onStage ? (
          <StageScreen key="stage" />
        ) : (
          <AudienceScreen key="audience" />
        );
        break;
      case "group_result":
        content = <GroupResultScreen key="group_result" />;
        break;
      case "final_result":
        content = <FinalResultScreen key="final_result" />;
        break;
      case "closed":
        content = <ClosedScreen key="closed" />;
        break;
      default:
        content = null;
    }
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-dojo-stage-dark">
      <AnimatePresence mode="wait">{content}</AnimatePresence>
      <LaughEffectOverlay />
    </main>
  );
}
