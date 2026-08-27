"use client";

import { motion } from "framer-motion";

import LiveStageBackdropPreview2 from "./LiveStageBackdropPreview2";
import { useLiveDesignPreviewStore2 } from "@/store/useLiveDesignPreviewStore2";

// 「ライブに参加」直後の組分け発表画面。3組それぞれのメンバー名を表示し、
// 自分がどの組にいるかが一目で分かるようにする(本番のOpeningScreen相当を
// design-preview-2のネオン意匠で再現)。ここではまだ回答受付は始まっていない
// (useLiveDesignPreviewStore2.initPreviewが最初のターンのお題だけ用意した状態)。
export default function LiveGroupingScreenPreview2() {
  const groups = useLiveDesignPreviewStore2((s) => s.groups);
  const participants = useLiveDesignPreviewStore2((s) => s.participants);
  const participantNames = useLiveDesignPreviewStore2((s) => s.participantNames);
  const myParticipant = useLiveDesignPreviewStore2((s) => s.myParticipant);

  const orderedGroups = [...groups].sort((a, b) => a.group_order - b.group_order);
  const myGroupId = myParticipant?.group_id ?? null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <LiveStageBackdropPreview2 />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-4 text-center">
        <p className="font-sans text-xs tracking-[0.4em] text-[#7ab2ff]">組分け発表</p>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-2 font-sans text-2xl font-black text-white"
        >
          {myGroupId
            ? `あなたは${orderedGroups.find((g) => g.id === myGroupId)?.group_order ?? "?"}組目です`
            : "組分け中……"}
        </motion.h2>

        <div className="mt-6 flex w-full flex-col gap-3">
          {orderedGroups.map((group, idx) => {
            const members = participants.filter((p) => p.group_id === group.id);
            const isMyGroup = group.id === myGroupId;
            return (
              <motion.div
                key={group.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 * idx, duration: 0.4 }}
                className={`rounded-2xl border p-3 text-left ${
                  isMyGroup
                    ? "border-[#3b5bff] bg-white/10 shadow-[0_0_20px_rgba(59,91,255,0.5)]"
                    : "border-white/15 bg-white/[0.03]"
                }`}
              >
                <p className={`font-sans text-xs font-bold ${isMyGroup ? "text-[#7ab2ff]" : "text-white/50"}`}>
                  {group.group_order}組目{isMyGroup ? "（あなたの組）" : ""}
                </p>
                <p className="mt-1.5 font-sans text-sm leading-relaxed text-white/90">
                  {members
                    .map((p) => `${participantNames[p.id] ?? "（名前未設定）"}${p.id === myParticipant?.id ? "（あなた）" : ""}`)
                    .join(" / ")}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
