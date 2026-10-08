"use client";

import Link from "next/link";

import { useLiveDemoStore } from "@/store/useLiveDemoStore";

import ScreenShell from "./ScreenShell";

// 閉幕：実ライブの閉幕（live/page.tsx の closed 表示）と同じ文言・ホームへの導線。
// 「もう一度最初から体験する」だけは体験版だけの操作（実ライブにはない）。
export default function ClosedScreen() {
  const resetLive = useLiveDemoStore((s) => s.resetLive);
  const recording = useLiveDemoStore((s) => s.recording);
  return (
    <ScreenShell>
      <p className="font-sans text-sm text-white/85">本日のライブは終了しました。お疲れさまでした！</p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-dojo-curtain-red px-5 py-2.5 font-sans text-sm font-bold text-dojo-on-dark transition hover:bg-dojo-deep-crimson"
      >
        ホームに戻る
      </Link>
      {recording ? null : (
        <button
          type="button"
          onClick={resetLive}
          className="mt-4 rounded-full border border-white/40 px-5 py-2 font-sans text-sm font-bold text-white/80 transition hover:bg-white/10"
        >
          もう一度最初から体験する
        </button>
      )}
    </ScreenShell>
  );
}
