"use client";

// 笑い・ツッコミの演出（LaughEffectOverlay・LaughMarkOverlay・TsukkomiDanmakuOverlay）が、
// 「どの待機列から」「どの笑いの発生回数を」見るかを差し替えるための文脈。
// 既定は実ライブ（useLiveFollowerStore）なので、実ライブの挙動は変わらない。
// 体験版（/live-demo）は LiveReactionSourceContext.Provider で体験版のストアを渡し、
// 実ライブと同じ表示部品をそのまま使う（表示の乖離を防ぐため）。
import { createContext, useContext } from "react";

import { useLiveFollowerStore, type TsukkomiEvent } from "@/store/useLiveFollowerStore";

export interface LiveReactionSource {
  // 待機列から、predicateに合う1件を取り出す（先頭から順に、古すぎるものは捨てる）
  claimReactionEvent: (predicate: (event: TsukkomiEvent) => boolean, now?: number) => TsukkomiEvent | null;
  // 笑いの発生回数（増えるたびに笑いの演出を1回出す）
  useLaughEventSeq: () => number;
}

export const followerReactionSource: LiveReactionSource = {
  claimReactionEvent: (predicate, now) => useLiveFollowerStore.getState().claimReactionEvent(predicate, now),
  useLaughEventSeq: () => useLiveFollowerStore((s) => s.laughEventSeq),
};

export const LiveReactionSourceContext = createContext<LiveReactionSource>(followerReactionSource);

export function useLiveReactionSource(): LiveReactionSource {
  return useContext(LiveReactionSourceContext);
}
