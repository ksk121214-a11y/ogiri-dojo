"use client";

import Link from "next/link";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 観客としてライブを見ている人だけに表示する「ホームに戻る」ボタン。
// プレイヤーは進行に関わる（回答・審査を待たれる）ため表示しない。観客は進行に
// 影響しないため、ライブ中いつでも自由に出入りできるようにする
// （要望：「観客は出入りできるようにしよう」）。
export default function AudienceHomeButton() {
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  if (myParticipant?.role !== "audience") return null;

  return (
    <Link
      href="/"
      className="fixed left-3 top-3 z-[100] rounded-full bg-black/60 px-3 py-1.5 font-sans text-xs font-bold text-white backdrop-blur-sm transition hover:bg-black/80"
    >
      ← ホームに戻る
    </Link>
  );
}
