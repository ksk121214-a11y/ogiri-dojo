"use client";

import { useEffect, useState } from "react";

import { BASE_PATH } from "@/lib/basePath";

// 効果音は実音源ファイル方式（/public/sounds/配下に置いたmp3を再生する）。
// ファイルが未配置でもplay()が失敗するだけで(catchして無視)アプリの動作自体は壊れない。
// 以前ffmpeg/soxが無い環境でPython標準ライブラリのみで合成した仮素材(.wav)を
// 一通り置いていたが、電子音っぽく質が良くないため全て削除済み。ここに残っている
// キーのうちファイルが実際には無いもの(countdownTick/perfect/spotlightIn/bigLaugh/
// rankReveal/masteryLevelup/startLive)は、実音源が届くまで意図的に「鳴らない」状態にしてある。
const SFX_PATHS = {
  buttonPress: "/sounds/button-press.mp3",
  countdownTick: "/sounds/countdown-tick.mp3",
  scoreReveal: "/sounds/score-reveal.mp3",
  perfect: "/sounds/perfect.mp3",
  curtainOpen: "/sounds/curtain-open.mp3",
  answerSubmit: "/sounds/answer-submit.mp3",
  spotlightIn: "/sounds/spotlight-in.mp3",
  bigLaugh: "/sounds/big-laugh.mp3",
  topicReveal: "/sounds/topic-reveal.mp3",
  groupResult: "/sounds/group-result.mp3",
  rankReveal: "/sounds/rank-reveal.mp3",
  masteryLevelup: "/sounds/mastery-levelup.mp3",
  startLive: "/sounds/start-live.mp3",
  // 参加登録受付中の画面(OpeningView.tsx)専用。「プレイヤーとして参加する」ボタン押下音。
  joinAsPlayer: "/sounds/join-as-player.mp3",
  // 同じくOpeningView.tsx専用。参加者一覧に新しい名前が増えるたびに鳴らす。
  participantJoined: "/sounds/participant-joined.mp3",
} as const;

export type SfxName = keyof typeof SFX_PATHS;

const SE_VOLUME = 0.7;

const MUTE_STORAGE_KEY = "ogiri-sfx-muted";

let muted =
  typeof window !== "undefined" &&
  window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
const listeners = new Set<(muted: boolean) => void>();

export function isSfxMuted() {
  return muted;
}

export function setSfxMuted(next: boolean) {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
  }
  listeners.forEach((fn) => fn(muted));
}

export function subscribeSfxMuted(fn: (muted: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ミュート切り替えボタン等、Reactコンポーネント側でミュート状態を購読したい時用。
export function useSfxMuted() {
  const [value, setValue] = useState(isSfxMuted());
  useEffect(() => subscribeSfxMuted(setValue), []);
  return value;
}

// 連打で同じ効果音が重なって鳴ってもよいよう、1個のAudioを使い回さず毎回cloneして再生する
// （使い回すと連打時に前の再生が途中で打ち切られる）。
const audioCache = new Map<SfxName, HTMLAudioElement>();

export function playSfx(name: SfxName) {
  if (typeof window === "undefined" || muted) return;
  let base = audioCache.get(name);
  if (!base) {
    base = new Audio(`${BASE_PATH}${SFX_PATHS[name]}`);
    base.preload = "auto";
    audioCache.set(name, base);
  }
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = SE_VOLUME;
  node.play().catch(() => {
    // 音源ファイル未配置・自動再生制限などで失敗しても無視する
  });
}
