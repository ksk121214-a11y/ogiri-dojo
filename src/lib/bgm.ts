"use client";

import { useEffect, useState } from "react";

import { BASE_PATH } from "@/lib/basePath";

// BGMは/public/sounds/bgm/配下のmp3をループ再生する。効果音(sfx.ts)と違い常に1曲だけが
// 鳴っている状態を保ちたいので、モジュール内で「今かかっている1つ」だけを管理し、
// 切り替え時は前の曲をフェードアウトしながら次の曲をフェードインするクロスフェード方式にする。
const BGM_PATHS = {
  waiting: "/sounds/bgm/waiting.mp3", // 開演前・閉幕後の待機画面
  entrance: "/sounds/bgm/entrance.mp3", // 出囃子：お題発表の間
  live: "/sounds/bgm/live.mp3", // 回答〜結果発表までの本編中
} as const;

export type BgmName = keyof typeof BGM_PATHS;

// ライブ中BGMは効果音と重なる場面が一番多いので、他の2曲よりさらに控えめにする。
// 2026-08-27改訂：全体的にもう少し控えめにしたいとの要望で1割ほど下げた。
const BGM_VOLUME: Record<BgmName, number> = {
  waiting: 0.13,
  entrance: 0.13,
  live: 0.06,
};
const FADE_MS = 700;

let current: { name: BgmName; audio: HTMLAudioElement } | null = null;
const fadeTimers = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

function fadeAudio(audio: HTMLAudioElement, from: number, to: number, ms: number, onDone?: () => void) {
  const existing = fadeTimers.get(audio);
  if (existing) clearInterval(existing);
  const steps = 20;
  const stepMs = ms / steps;
  let i = 0;
  audio.volume = from;
  const timer = setInterval(() => {
    i++;
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
    if (i >= steps) {
      clearInterval(timer);
      fadeTimers.delete(audio);
      audio.volume = to;
      onDone?.();
    }
  }, stepMs);
  fadeTimers.set(audio, timer);
}

const MUTE_STORAGE_KEY = "ogiri-bgm-muted";

let muted =
  typeof window !== "undefined" &&
  window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
const muteListeners = new Set<(muted: boolean) => void>();

export function isBgmMuted() {
  return muted;
}

export function setBgmMuted(next: boolean) {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
  }
  // 再生自体は止めず、音量だけフェードで0⇔通常に切り替える（曲の再生位置は保ったまま）。
  if (current) {
    const target = next ? 0 : BGM_VOLUME[current.name];
    fadeAudio(current.audio, current.audio.volume, target, FADE_MS);
  }
  muteListeners.forEach((fn) => fn(muted));
}

export function subscribeBgmMuted(fn: (muted: boolean) => void) {
  muteListeners.add(fn);
  return () => {
    muteListeners.delete(fn);
  };
}

export function useBgmMuted() {
  const [value, setValue] = useState(isBgmMuted());
  useEffect(() => subscribeBgmMuted(setValue), []);
  return value;
}

export function playBgm(name: BgmName) {
  if (typeof window === "undefined") return;
  if (current?.name === name) {
    // 自動再生ブロック等で実際には鳴っていなかった場合の再試行（同名リクエストは通常no-op）。
    if (current.audio.paused && !muted) current.audio.play().catch(() => {});
    return;
  }
  const prev = current;
  const audio = new Audio(`${BASE_PATH}${BGM_PATHS[name]}`);
  audio.loop = true;
  audio.volume = 0;
  current = { name, audio };
  audio.play().catch(() => {
    // 自動再生制限で失敗しても無視する（次のユーザー操作契機の切り替えで自然に鳴り出す）
  });
  fadeAudio(audio, 0, muted ? 0 : BGM_VOLUME[name], FADE_MS);
  if (prev) {
    fadeAudio(prev.audio, prev.audio.volume, 0, FADE_MS, () => {
      prev.audio.pause();
    });
  }
}

// ブラウザの自動再生制限で鳴らせなかったBGMを、ユーザーの最初の操作（クリック/タップ）を
// きっかけに再試行するための関数。「途中から参加すると音が鳴らないことがある」対策として
// document全体の最初のクリック/タッチで1回だけ呼ぶ想定（呼び出し側はLivePage参照）。
export function retryCurrentBgm() {
  if (typeof window === "undefined" || !current) return;
  if (current.audio.paused && !muted) {
    current.audio.play().catch(() => {});
  }
}

export function stopBgm() {
  if (!current) return;
  const prev = current;
  current = null;
  fadeAudio(prev.audio, prev.audio.volume, 0, FADE_MS, () => {
    prev.audio.pause();
  });
}
