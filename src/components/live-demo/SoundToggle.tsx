"use client";

import { setBgmMuted, useBgmMuted } from "@/lib/bgm";
import { setSfxMuted, useSfxMuted } from "@/lib/sfx";

// 右上に置く小さな音のオンオフスイッチ。効果音とBGMを別々に切り替えられるよう横に並べる。
export default function SoundToggle() {
  const bgmMuted = useBgmMuted();
  const sfxMuted = useSfxMuted();

  return (
    <div className="fixed right-3 top-3 z-[100] flex flex-row gap-1.5">
      <ToggleButton
        label="BGM"
        muted={bgmMuted}
        onClick={() => setBgmMuted(!bgmMuted)}
        ariaLabel={bgmMuted ? "BGMを有効にする" : "BGMを消す"}
      />
      <ToggleButton
        label="SE"
        muted={sfxMuted}
        onClick={() => setSfxMuted(!sfxMuted)}
        ariaLabel={sfxMuted ? "効果音を有効にする" : "効果音を消す"}
      />
    </div>
  );
}

function ToggleButton({
  label,
  muted,
  onClick,
  ariaLabel,
}: {
  label: string;
  muted: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`flex h-7 items-center gap-1 rounded-full border px-2.5 font-sans text-[10px] font-bold backdrop-blur transition active:scale-90 ${
        muted
          ? "border-white/15 bg-black/30 text-white/35"
          : "border-white/30 bg-black/45 text-white/90"
      }`}
    >
      <SpeakerIcon muted={muted} />
      {label}
    </button>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      {muted ? (
        <path
          d="M15.5 9.5l5 5m0-5l-5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M16.5 8.5a5 5 0 0 1 0 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
