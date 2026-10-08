"use client";

import BackToHomeLink from "./BackToHomeLink";
import ScreenShell from "./ScreenShell";
import {
  canStartRecording,
  normalizeRecordingSettings,
  RECORDING_NAME_MAX_LENGTH,
  RECORDING_TOPIC_MAX_LENGTH,
  type LiveDemoMode,
  type RecordingSettings,
} from "@/lib/liveDemoMode";
import * as audioManager from "@/lib/audio/audioManager";
import { playSfx } from "@/lib/sfx";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// 開演前の画面。開発確認モードは従来の説明文を出す（体験版だけの文言）。
// 動画撮影モードは本番にない文字を出さず、タイトル・名前とお題の入力・開演だけにする。
// 入力値は撮影セッションの画面全体で使い、本番DBやlocalStorageには保存しない（撮り直しでは維持）。
// 「開演する」は利用者の操作。その同期的なクリック処理の中で音声をアンロックし、効果音を事前読み込みする
// （開演後に最初の回答音が読み込み待ちで遅れないようにする）。
function prepareLiveAudio() {
  audioManager.resumeAudioContext();
  audioManager.preloadAllSfx();
}

export default function StartScreen({
  mode,
  settings,
  onSettingsChange,
}: {
  mode: LiveDemoMode;
  settings?: RecordingSettings;
  onSettingsChange?: (next: RecordingSettings) => void;
}) {
  const startLive = useLiveDemoStore((s) => s.startLive);

  if (mode.recording && settings && onSettingsChange) {
    const canStart = canStartRecording(settings);
    return (
      <ScreenShell>
        <h1 className="font-sans text-5xl font-black text-white drop-shadow-[0_0_20px_rgba(59,91,255,0.8)] sm:text-6xl">
          爆笑スタジアム
        </h1>
        <form
          className="mt-6 flex w-full max-w-sm flex-col gap-3 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canStart) return;
            prepareLiveAudio();
            startLive({ recording: true, seed: mode.seed, settings: normalizeRecordingSettings(settings) });
          }}
        >
          <label className="font-sans text-xs text-white/80">
            自分の名前（{RECORDING_NAME_MAX_LENGTH}文字まで）
            <input
              type="text"
              value={settings.displayName}
              maxLength={RECORDING_NAME_MAX_LENGTH}
              onChange={(e) => onSettingsChange({ ...settings, displayName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/25 bg-white/10 px-3 py-2 font-sans text-sm text-white outline-none focus:border-[#3b5bff]"
            />
          </label>
          <label className="font-sans text-xs text-white/80">
            お題（{RECORDING_TOPIC_MAX_LENGTH}文字まで）
            <textarea
              value={settings.topic}
              maxLength={RECORDING_TOPIC_MAX_LENGTH}
              rows={2}
              onChange={(e) => onSettingsChange({ ...settings, topic: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/25 bg-white/10 px-3 py-2 font-sans text-sm text-white outline-none focus:border-[#3b5bff]"
            />
          </label>
          <label className="flex items-center gap-2 font-sans text-sm text-white/80">
            <input
              type="checkbox"
              checked={settings.botAnswers}
              onChange={(e) => onSettingsChange({ ...settings, botAnswers: e.target.checked })}
            />
            ボットの回答を使う（既定はOFF）
          </label>
          {canStart ? null : (
            <p className="font-sans text-xs text-red-300">名前とお題を入力してください</p>
          )}
          <button
            type="submit"
            disabled={!canStart}
            className="mt-2 self-center rounded-full bg-[#3b5bff] px-10 py-4 font-sans text-lg font-bold text-white shadow-[0_0_25px_rgba(59,91,255,0.6)] transition active:scale-95 disabled:opacity-50"
          >
            開演する
          </button>
        </form>
      </ScreenShell>
    );
  }

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
          prepareLiveAudio();
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
