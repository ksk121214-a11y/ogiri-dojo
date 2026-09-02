"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import ParticipantIconAvatar from "@/components/app/ParticipantIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { playSfx } from "@/lib/sfx";
import type { GroupResultData, ParticipantAvatarInfo } from "@/store/useLiveFollowerStore";

const EMPTY_AVATARS: Record<string, ParticipantAvatarInfo> = {};

// 実バックエンド版ライブの組結果発表。src/components/live-demo/GroupResultScreen.tsxと
// 同じ見た目（白カード＋青枠）だが、useLiveDemoStore/MY_PARTICIPANT_IDには依存せず、
// useLiveFollowerStoreが集計したデータをpropsで受け取るだけの表示専用コンポーネント。
export default function GroupResultView({
  data,
  myParticipantId,
  participantAvatars = EMPTY_AVATARS,
}: {
  data: GroupResultData;
  myParticipantId: string | null;
  participantAvatars?: Record<string, ParticipantAvatarInfo>;
}) {
  // Strict Mode（開発時）はマウント直後のeffectを2回連続で実行するため、ガード無しだと
  // 音が二重に重なって鳴ってしまう。refで「もう鳴らした」を記録して2回目を防ぐ。
  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playSfx("groupResult");
  }, []);

  return (
    <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white p-5 text-left shadow-[0_0_40px_rgba(59,91,255,0.45)]">
      <p className="text-center font-sans text-xs font-bold tracking-widest text-[#3b5bff]">
        組結果発表
      </p>
      <p className="mt-1 text-center font-sans text-xs text-[#6b6b90]">
        第{data.round}周・組{data.groupOrder}・お題：{data.topicBody}
      </p>

      <div className="mt-4 space-y-2">
        {data.ranking.map((entry, idx) => {
          const isMe = entry.participantId === myParticipantId;
          return (
            <motion.div
              key={entry.participantId}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.12 }}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                isMe ? "border-[#3b5bff] bg-[#eef1ff]" : "border-[#e4e6f5] bg-white"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5 font-sans text-sm text-[#1a1a3a]">
                {/* 2026-09-03: 配列の位置(idx+1)ではなく、同点を同じ順位にするentry.rankを表示する。 */}
                <span className="text-[#8a8ab0]">{entry.rank}位</span>
                {isMe ? (
                  <MyIconAvatar size={28} bare />
                ) : (
                  <ParticipantIconAvatar
                    participantId={entry.participantId}
                    avatarIcon={participantAvatars[entry.participantId]?.icon}
                    avatarColor={participantAvatars[entry.participantId]?.color}
                    size={28}
                    bare
                  />
                )}
                <span className="truncate">{truncateLiveDisplayName(entry.name)}</span>
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

      {data.laughCount > 0 && (
        <p className="mt-4 text-center font-sans text-xs font-bold text-[#ff3b5b]">
          笑いエフェクト発生：{data.laughCount}件
        </p>
      )}
    </div>
  );
}
