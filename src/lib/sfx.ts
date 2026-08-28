"use client";

import { useEffect, useState } from "react";

import * as audioManager from "@/lib/audio/audioManager";

// 2026-08-29: 実装本体はsrc/lib/audio/audioManager.ts（アプリ全体で1つだけの
// AudioManager）に統合した。このファイルは既存の呼び出し箇所（live-room/live-demo系
// 20ファイル以上）を一切変更せずに済むよう、同じ関数名・同じ意味論（muted＝true/false）
// のままaudioManagerへ委譲する薄いラッパーとして残している。
// 新しいコードはできるだけ src/lib/audio/audioManager.ts を直接使うこと
// （seEnabled＝!mutedという反転がある点、SEはAudioBufferの事前デコード方式に
// 変わった点に注意）。
export type { SfxName } from "@/lib/audio/audioManager";

export function isSfxMuted(): boolean {
  return !audioManager.isSeEnabled();
}

export function setSfxMuted(next: boolean): void {
  audioManager.setSeEnabled(!next);
}

export function subscribeSfxMuted(fn: (muted: boolean) => void): () => void {
  return audioManager.subscribe((state) => fn(!state.seEnabled));
}

export function useSfxMuted(): boolean {
  const [value, setValue] = useState(() => isSfxMuted());
  useEffect(() => subscribeSfxMuted(setValue), []);
  return value;
}

export const playSfx = audioManager.playSfx;
