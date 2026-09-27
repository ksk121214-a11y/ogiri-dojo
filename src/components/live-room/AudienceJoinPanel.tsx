"use client";

import { useState } from "react";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 観客として参加するための中央配置のボタン（画面下に固定しない）。明確な観客参加の操作を
// まだしていない人（直接アクセス）と、自動参加に失敗した人の再試行に使う。
// 参加処理中は再度押せない。失敗時は日本語のエラーをボタンのすぐ下に出す。
export default function AudienceJoinPanel() {
  const joinLive = useLiveFollowerStore((s) => s.joinLive);
  const error = useLiveFollowerStore((s) => s.error);
  const [joining, setJoining] = useState(false);

  const handleClick = async () => {
    if (joining) return;
    setJoining(true);
    try {
      await joinLive("audience");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <button
        type="button"
        disabled={joining}
        onClick={handleClick}
        aria-busy={joining}
        className="min-h-[52px] w-full rounded-full bg-[#c8102e] px-8 py-3 font-sans text-base font-black text-white shadow-[0_6px_20px_rgba(200,16,46,0.45)] transition active:scale-95 hover:bg-[#a80d26] disabled:cursor-not-allowed disabled:bg-[#6b1a28] disabled:text-white/80 disabled:shadow-none"
      >
        {joining ? "観客席へ入場中…" : error ? "もう一度、観客として参加する" : "観客として参加する"}
      </button>
      {error && !joining && (
        <p role="alert" className="rounded-lg bg-black/60 px-3 py-2 font-sans text-xs font-bold leading-relaxed text-[#ffb3bf]">
          {error}
        </p>
      )}
    </div>
  );
}
