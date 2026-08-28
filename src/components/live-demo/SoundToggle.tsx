"use client";

import { useAudioState } from "@/components/app/AudioProvider";
import * as audioManager from "@/lib/audio/audioManager";
import { setBgmMuted, useBgmMuted } from "@/lib/bgm";
import { setSfxMuted, useSfxMuted } from "@/lib/sfx";

// 右上に置く小さな音のオンオフスイッチ。効果音とBGMを別々に切り替えられるよう横に並べる。
// 2026-08-29: ヘッダーのSoundSettingsToggleと同じAudioManagerを共有するようにし、
// 自動再生制限でBGMが再生できなかった場合は「！」バッジ＋「BGMを再開」ボタンを出す。
// OFF→ONの切り替えはそのクリックイベントの冒頭でAudioContextをresumeする。
export default function SoundToggle() {
  const bgmMuted = useBgmMuted();
  const sfxMuted = useSfxMuted();
  const { needsAudioResume, bgmLoading } = useAudioState();

  const handleToggleBgm = () => {
    const turningOn = bgmMuted;
    if (turningOn) audioManager.resumeAudioContext();
    setBgmMuted(!bgmMuted);
  };

  const handleToggleSfx = () => {
    const turningOn = sfxMuted;
    if (turningOn) audioManager.resumeAudioContext();
    setSfxMuted(!sfxMuted);
  };

  return (
    <div className="fixed right-3 top-3 z-[100] flex flex-col items-end gap-1.5">
      <div className="flex flex-row gap-1.5">
        <ToggleButton
          label="BGM"
          muted={bgmMuted}
          onClick={handleToggleBgm}
          ariaLabel={bgmMuted ? "BGMを有効にする" : "BGMを消す"}
          showAlert={needsAudioResume}
        />
        <ToggleButton
          label="SE"
          muted={sfxMuted}
          onClick={handleToggleSfx}
          ariaLabel={sfxMuted ? "効果音を有効にする" : "効果音を消す"}
        />
      </div>
      {bgmLoading && (
        <p className="rounded-full bg-black/45 px-2.5 py-1 font-sans text-[10px] text-white/80 backdrop-blur">
          BGM準備中…
        </p>
      )}
      {needsAudioResume && (
        <button
          type="button"
          onClick={() => audioManager.retryCurrentBgm()}
          className="rounded-full bg-[#ff3b5b] px-2.5 py-1 font-sans text-[10px] font-bold text-white shadow transition active:scale-95"
        >
          BGMを再開
        </button>
      )}
    </div>
  );
}

function ToggleButton({
  label,
  muted,
  onClick,
  ariaLabel,
  showAlert,
}: {
  label: string;
  muted: boolean;
  onClick: () => void;
  ariaLabel: string;
  showAlert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`relative flex h-7 items-center gap-1 rounded-full border px-2.5 font-sans text-[10px] font-bold backdrop-blur transition active:scale-90 ${
        muted
          ? "border-white/15 bg-black/30 text-white/35"
          : "border-white/30 bg-black/45 text-white/90"
      }`}
    >
      <SpeakerIcon muted={muted} />
      {label}
      {showAlert && (
        <span
          className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ff3b5b] text-[9px] font-black leading-none text-white"
          aria-hidden
        >
          !
        </span>
      )}
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
