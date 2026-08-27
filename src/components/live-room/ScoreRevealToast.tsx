"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 誰の回答が確定しても、舞台側・客席側どちらの画面でも同じように「名前：点数」を
// 数秒だけ表示して消す共通トースト。演者本人にだけ出ていた専用ポップアップと、
// 客席側には何も出ていなかった状態を統合し、全員が同じタイミングで同じものを見られるようにする。
// 表示済みIDをSetで管理するので、一度出したものは(画面を跨いでも)二度と出ない。
export default function ScoreRevealToast() {
  const live = useLiveFollowerStore((s) => s.live);
  const turnAnswers = useLiveFollowerStore((s) => s.turnAnswers);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const [toast, setToast] = useState<{ id: string; name: string; points: number } | null>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Realtimeの反映が遅れて、回答受付フェーズが終わった後(次のお題発表時など)に
    // 「確定した」通知が今さら届くことがある。そのタイミングでは新規に出さない。
    if (live?.current_phase !== "answering") return;
    const next = [...turnAnswers]
      .filter((a) => a.resolved && !shownIdsRef.current.has(a.id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    if (!next) return;
    shownIdsRef.current.add(next.id);
    setToast({
      id: next.id,
      name: participantNames[next.participant_id] ?? "（名前未設定）",
      points: next.score_total,
    });
  }, [live?.current_phase, turnAnswers, participantNames]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <AnimatePresence>
      {/* 表示中でも、フェーズが回答受付から外れた瞬間に画面から消す
          (次のお題の演出に古いトーストが被って残らないように)。 */}
      {toast && live?.current_phase === "answering" && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.9 }}
          className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-dojo-curtain-gold px-6 py-3 font-brush text-xl text-dojo-stage-dark shadow-lg"
        >
          {truncateLiveDisplayName(toast.name)}：{toast.points}点！
        </motion.div>
      )}
    </AnimatePresence>
  );
}
