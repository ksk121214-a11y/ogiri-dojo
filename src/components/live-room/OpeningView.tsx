"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import ScreenShell from "@/components/live-demo/ScreenShell";
import type { ParticipantRole } from "@/lib/liveRoomTypes";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { playSfx } from "@/lib/sfx";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

const ROLE_LABEL: Record<ParticipantRole, string> = {
  player: "プレイヤー希望",
  audience: "観客希望",
};

// 開幕（参加登録受付中）フェーズの実バックエンド版。src/components/live-demo/OpeningScreen.tsxは
// 「組分け発表」の演出だが、実バックエンドのopeningフェーズはまだ組分け前の登録受付そのものなので、
// デモ版をそのまま移植せず、実際の登録状況に合わせた専用の画面として作る。
export default function OpeningView() {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const followerError = useLiveFollowerStore((s) => s.error);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);
  const [joining, setJoining] = useState(false);

  // 参加者一覧に新しい名前が増えるたびに1回鳴らす（マウント時点で既にいる人数ぶんは対象外、
  // その後リアルタイムで増えた分だけ鳴らしたいので初期値をnullにして初回は基準を記録するだけにする）。
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevCountRef.current !== null && participants.length > prevCountRef.current) {
      playSfx("participantJoined");
    }
    prevCountRef.current = participants.length;
  }, [participants.length]);

  if (!live) return null;

  const handleJoin = async (role: ParticipantRole) => {
    if (role === "player") playSfx("joinAsPlayer");
    setJoining(true);
    await joinLive(role);
    setJoining(false);
  };

  return (
    <ScreenShell>
      <p className="font-sans text-xs tracking-widest text-white/60">開幕</p>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-2 font-sans text-3xl font-black text-[#ffcf4a] sm:text-4xl"
      >
        参加登録受付中
      </motion.h2>
      <p className="mt-2 font-sans text-sm text-white/80">
        まもなく組分けが発表されます。参加方法を選んでください。
      </p>

      {!myParticipant ? (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            disabled={joining}
            onClick={() => handleJoin("player")}
            className="rounded-full bg-[#ff3b5b] px-6 py-3 font-sans text-sm font-bold text-white transition hover:bg-[#e02040] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? "参加処理中…" : "プレイヤーとして参加する"}
          </button>
          <button
            type="button"
            disabled={joining}
            onClick={() => handleJoin("audience")}
            className="rounded-full border border-white/40 px-6 py-3 font-sans text-sm font-bold text-white transition hover:border-[#ffcf4a] hover:text-[#ffcf4a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? "参加処理中…" : "観客として参加する"}
          </button>
        </div>
      ) : (
        <p className="mt-6 font-sans text-sm text-[#ffcf4a]">
          {ROLE_LABEL[myParticipant.preferred_role]}で参加登録済みです
        </p>
      )}
      {followerError && (
        <p className="mt-2 font-sans text-xs text-[#ff3b5b]">{followerError}</p>
      )}

      <div className="mt-10 w-full max-w-xl">
        <p className="font-sans text-xs tracking-widest text-white/60">
          現在の参加者：{participants.length}人
        </p>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {participants.map((p, idx) => {
            const isMe = p.id === myParticipant?.id;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx, 20) * 0.03 }}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  isMe ? "border-[#3b5bff] bg-white/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <span className="truncate font-sans text-white/90">
                  {truncateLiveDisplayName(participantNames[p.id] ?? "（名前未設定）")}
                </span>
                <span className="shrink-0 font-sans text-xs text-white/60">
                  {ROLE_LABEL[p.preferred_role]}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </ScreenShell>
  );
}
