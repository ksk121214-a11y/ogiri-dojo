"use client";

import { useState } from "react";

import { useAudioState } from "@/components/app/AudioProvider";
import * as audioManager from "@/lib/audio/audioManager";
import { setBgmMuted, useBgmMuted } from "@/lib/bgm";
import { setSfxMuted, useSfxMuted } from "@/lib/sfx";

import styles from "./StadiumHome.module.css";

// ヘッダーの表示名の横に置く音量アイコン。タップするとBGM／SEを個別にON/OFFできる
// 小さなポップオーバーを開く（ミュート状態自体は既存のbgm.ts/sfx.tsのlocalStorage永続化を
// そのまま利用するため、ライブ画面（/live・/live-demo）のSoundToggleと設定を共有する）。
// 2026-08-29: ブラウザの自動再生制限でBGMが再生できなかった場合、AudioProvider経由の
// needsAudioResumeを見てアイコンに「！」バッジを出し、メニュー内に「BGMを再開」ボタンを
// 表示するようにした。OFF→ONへの切り替えはそのクリックイベントの冒頭でAudioContextの
// resumeを呼び、モバイルの自動再生制限をそのユーザー操作で突破する。
// メインボタンにはdata-sfx="home"を付け、下部ナビ等と同じhomeClick音が鳴るようにしている
// （StadiumSfxController.tsx参照。付けなければ既定のpageTurn音になる）。
export default function SoundSettingsToggle() {
  const [open, setOpen] = useState(false);
  const bgmMuted = useBgmMuted();
  const sfxMuted = useSfxMuted();
  const { needsAudioResume, bgmLoading } = useAudioState();
  const allMuted = bgmMuted && sfxMuted;

  const handleToggleBgm = () => {
    const turningOn = bgmMuted;
    // 要件：OFF→ONのクリックイベントの冒頭でAudioContextをresumeする。
    if (turningOn) audioManager.resumeAudioContext();
    setBgmMuted(!bgmMuted);
  };

  const handleToggleSfx = () => {
    const turningOn = sfxMuted;
    if (turningOn) audioManager.resumeAudioContext();
    setSfxMuted(!sfxMuted);
  };

  const handleResumeBgm = () => {
    audioManager.retryCurrentBgm();
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="音の設定を開く"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-sfx="home"
        className="relative flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted-on-dark)] transition hover:text-[var(--text-on-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <SpeakerIcon muted={allMuted} />
        {needsAudioResume && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--accent)] text-[8px] font-black leading-none text-white"
            aria-hidden
          >
            !
          </span>
        )}
      </button>

      {open && (
        <>
          {/* ポップオーバーの外側をタップすると閉じる透明オーバーレイ。 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="音の設定"
            className={`${styles.grainDark} absolute top-full right-0 z-50 mt-2 flex w-36 flex-col gap-1 rounded-xl border border-[var(--border-dark)] p-2 shadow-xl`}
          >
            <SoundRow label="BGM" muted={bgmMuted} onToggle={handleToggleBgm} />
            <SoundRow label="SE" muted={sfxMuted} onToggle={handleToggleSfx} />
            {bgmLoading && (
              <p className="px-2 py-1 font-sans text-[10px] text-[var(--muted-on-dark)]">
                BGM準備中…
              </p>
            )}
            {needsAudioResume && (
              <button
                type="button"
                onClick={handleResumeBgm}
                className="rounded-lg bg-[var(--accent)] px-2 py-1.5 font-sans text-[11px] font-bold text-white transition hover:opacity-90"
              >
                BGMを再開
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SoundRow({
  label,
  muted,
  onToggle,
}: {
  label: string;
  muted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 font-sans text-xs font-bold text-[var(--text-on-dark)] transition hover:bg-[var(--text-on-dark)]/10"
    >
      <span className="flex items-center gap-1.5">
        <SpeakerIcon muted={muted} />
        {label}
      </span>
      <span className={muted ? "text-[var(--muted-on-dark)]" : "text-[var(--accent)]"}>
        {muted ? "OFF" : "ON"}
      </span>
    </button>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" className="shrink-0" fill="none" aria-hidden>
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
