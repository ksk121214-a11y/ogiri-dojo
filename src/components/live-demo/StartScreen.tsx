"use client";

import BackToHomeLink from "./BackToHomeLink";
import ScreenShell from "./ScreenShell";
import { playSfx } from "@/lib/sfx";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

export default function StartScreen() {
  const startLive = useLiveDemoStore((s) => s.startLive);

  return (
    <ScreenShell>
      <BackToHomeLink />
      <p className="font-sans text-xs tracking-[0.4em] text-[#7ab2ff]">
        LIVE OGIRI SHOW
      </p>
      <h1 className="mt-3 font-sans text-5xl font-black text-white drop-shadow-[0_0_20px_rgba(59,91,255,0.8)] sm:text-6xl">
        爆笑スタジアム
      </h1>
      <p className="mt-2 font-sans text-sm text-white/70">
        ライブ体験モック
      </p>
      <p className="mt-6 max-w-xl text-sm leading-relaxed text-white/80">
        あなたは13人の参加者のうちの1人としてライブに参加します。3組に分かれ、
        自分の組の番が来たら舞台に立って回答し、それ以外の間は客席で審査します。
        あなた以外の参加者はすべてボットが自動で演じます。
      </p>
      <button
        type="button"
        onClick={() => {
          playSfx("startLive");
          startLive();
        }}
        className="mt-10 rounded-full bg-[#3b5bff] px-10 py-4 font-sans text-lg font-bold text-white shadow-[0_0_25px_rgba(59,91,255,0.6)] transition active:scale-95"
      >
        開演する
      </button>
    </ScreenShell>
  );
}
