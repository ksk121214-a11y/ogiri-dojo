"use client";

import { useState } from "react";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// ゲーム開始後（interlude/opening以降）に途中から観客として参加したい人向けの、
// 没入画面（ダーク・ネオン配色）用の参加ボタン。AudienceHomeButtonと同じ
// 「画面のどこかに小さく固定表示する」パターンで、まだ参加登録していない人にだけ
// 常に出す（観客はいつでも出入りできる方針を、没入画面に入ってからも維持するため）。
export default function AudienceJoinButton() {
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);
  const error = useLiveFollowerStore((s) => s.error);
  const [joining, setJoining] = useState(false);

  if (myParticipant) return null;

  return (
    <div className="fixed inset-x-0 bottom-3 z-[100] flex flex-col items-center gap-1.5 px-3">
      <button
        type="button"
        disabled={joining}
        onClick={async () => {
          setJoining(true);
          await joinLive("audience");
          setJoining(false);
        }}
        className="rounded-full bg-black/70 px-5 py-2.5 font-sans text-sm font-bold text-white backdrop-blur-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {joining ? "参加処理中…" : "観客として参加する"}
      </button>
      {error && (
        <p className="max-w-[80vw] rounded-full bg-black/70 px-3 py-1 text-center font-sans text-[11px] text-[#ff8f8f] backdrop-blur-sm">
          {error}
        </p>
      )}
    </div>
  );
}
