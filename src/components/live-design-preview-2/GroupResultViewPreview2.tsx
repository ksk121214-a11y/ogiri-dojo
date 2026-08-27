"use client";

import { motion } from "framer-motion";

import type { GroupResultData } from "@/store/useLiveFollowerStore";

// 本番のsrc/components/live-room/GroupResultView.tsxと同じデータ形(GroupResultData)・
// 同じ役割(組結果発表)を、大喜利素材2のネオン意匠(お題ボードと同じ白地・青枠)で
// 表示するdesign-preview-2専用コピー。ロジックは一切持たず、propsで受け取った
// 集計済みデータを表示するだけ。
const AVATAR_GRADIENTS = [
  "from-[#3b5bff] to-[#7ab2ff]",
  "from-[#ff3b5b] to-[#ff8f9f]",
  "from-[#ffcf4a] to-[#ffe9a8]",
  "from-[#7a3bff] to-[#b28cff]",
  "from-[#3bd0ff] to-[#8ce9ff]",
];

function ResultAvatar({ name, seed }: { name: string; seed: number }) {
  const idx = ((seed % AVATAR_GRADIENTS.length) + AVATAR_GRADIENTS.length) % AVATAR_GRADIENTS.length;
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/30 bg-gradient-to-br font-sans text-sm font-bold text-white ${AVATAR_GRADIENTS[idx]}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export default function GroupResultViewPreview2({
  data,
  myParticipantId,
}: {
  data: GroupResultData;
  myParticipantId: string | null;
}) {
  return (
    <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white p-5 text-left shadow-[0_0_40px_rgba(59,91,255,0.45)]">
      <p className="text-center font-sans text-xs font-bold tracking-widest text-[#3b5bff]">
        組結果発表
      </p>
      <p className="mt-1 text-center font-sans text-xs text-[#6b6b90]">
        第{data.round}周・{data.groupOrder}組目・お題：{data.topicBody}
      </p>

      <div className="mt-4 space-y-2">
        {data.ranking.map((entry, idx) => {
          const isMe = entry.participantId === myParticipantId;
          return (
            <motion.div
              key={entry.participantId}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.12 }}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                isMe ? "border-[#3b5bff] bg-[#eef1ff]" : "border-[#e4e6f5] bg-white"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5 font-sans text-sm text-[#1a1a3a]">
                <span className="text-[#8a8ab0]">{idx + 1}位</span>
                <ResultAvatar name={entry.name} seed={idx} />
                <span className="truncate">
                  {entry.name}
                  {isMe ? "（あなた）" : ""}
                </span>
              </span>
              <span className="shrink-0 font-sans font-bold tabular-nums text-[#ff8f00]">
                {entry.total}点
              </span>
            </motion.div>
          );
        })}
      </div>

      {data.laughCount > 0 && (
        <p className="mt-4 text-center font-sans text-xs font-bold text-[#ff3b5b]">
          笑いエフェクト発生：{data.laughCount}件
        </p>
      )}
    </div>
  );
}
