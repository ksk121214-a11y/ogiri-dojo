"use client";

import BackToHomeLink from "./BackToHomeLink";
import ScreenShell from "./ScreenShell";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// 閉幕 L14: アーカイブ生成（モックでは演出のみ）
export default function ClosedScreen() {
  const resetLive = useLiveDemoStore((s) => s.resetLive);

  return (
    <ScreenShell>
      <BackToHomeLink />
      <p className="font-sans text-xs tracking-widest text-white/60">
        本日はご来場ありがとうございました
      </p>
      <h2 className="mt-3 font-sans text-3xl font-black text-white drop-shadow-[0_0_20px_rgba(59,91,255,0.8)] sm:text-4xl">
        閉幕
      </h2>
      <p className="mt-4 max-w-md font-sans text-sm text-white/70">
        アーカイブを生成しました（モックのためこの画面まで）。
      </p>
      <button
        type="button"
        onClick={resetLive}
        className="mt-8 rounded-full bg-[#3b5bff] px-8 py-3 font-sans text-sm font-bold text-white shadow-[0_0_25px_rgba(59,91,255,0.6)] transition active:scale-95"
      >
        もう一度最初から体験する
      </button>
    </ScreenShell>
  );
}
