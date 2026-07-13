"use client";

import BackToHomeLink from "./BackToHomeLink";
import ScreenShell from "./ScreenShell";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

export default function StartScreen() {
  const startLive = useLiveDemoStore((s) => s.startLive);

  return (
    <ScreenShell>
      <BackToHomeLink />
      <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
        LIVE EXPERIENCE DEMO
      </p>
      <h1 className="mt-3 font-brush text-5xl text-dojo-curtain-gold sm:text-6xl">
        大喜利道場
      </h1>
      <p className="mt-2 font-sans text-sm text-dojo-washi-white/80">
        ライブ体験モック
      </p>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-dojo-washi-white/90">
        あなたは13人の参加者のうちの1人としてライブに参加します。3組に分かれ、
        自分の組の番が来たら舞台に立って回答し、それ以外の間は客席で審査します。
        あなた以外の参加者はすべてボットが自動で演じます。
      </p>
      <button
        type="button"
        onClick={startLive}
        className="mt-10 rounded-full bg-dojo-curtain-red px-10 py-4 font-sans text-lg font-bold text-dojo-washi-white shadow-[0_0_30px_rgba(192,38,63,0.5)] transition hover:bg-dojo-deep-crimson active:scale-95"
      >
        開演する
      </button>
    </ScreenShell>
  );
}
