"use client";

import { useEffect, useState } from "react";

import * as audioManager from "@/lib/audio/audioManager";

// 2026-08-29: 実装本体はsrc/lib/audio/audioManager.ts（アプリ全体で1つだけの
// AudioManager）に統合した。このファイルは既存の呼び出し箇所（20箇所以上）を
// 一切変更せずに済むよう、同じ関数名・同じ意味論（muted＝true/false）のまま
// audioManagerへ委譲する薄いラッパーとして残している。
// 新しいコードはできるだけ src/lib/audio/audioManager.ts を直接使うこと
// （bgmEnabled＝!mutedという反転がある点に注意）。
export type { BgmName } from "@/lib/audio/audioManager";

export function isBgmMuted(): boolean {
  return !audioManager.isBgmEnabled();
}

export function setBgmMuted(next: boolean): void {
  audioManager.setBgmEnabled(!next);
}

export function subscribeBgmMuted(fn: (muted: boolean) => void): () => void {
  return audioManager.subscribe((state) => fn(!state.bgmEnabled));
}

export function useBgmMuted(): boolean {
  const [value, setValue] = useState(() => isBgmMuted());
  useEffect(() => subscribeBgmMuted(setValue), []);
  return value;
}

export const playBgm = audioManager.playBgm;
export const stopBgm = audioManager.stopBgm;
export const retryCurrentBgm = audioManager.retryCurrentBgm;
