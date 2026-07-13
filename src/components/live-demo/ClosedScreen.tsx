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
      <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
        本日はご来場ありがとうございました
      </p>
      <h2 className="mt-3 font-brush text-3xl text-dojo-curtain-gold sm:text-4xl">
        閉幕
      </h2>
      <p className="mt-4 max-w-md font-sans text-sm text-dojo-washi-white/80">
        アーカイブを生成しました（モックのためこの画面まで）。
      </p>
      <button
        type="button"
        onClick={resetLive}
        className="mt-8 rounded-full bg-dojo-curtain-red px-8 py-3 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
      >
        もう一度最初から体験する
      </button>
    </ScreenShell>
  );
}
