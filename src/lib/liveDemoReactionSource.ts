"use client";

// 体験版（/live-demo）の笑い・ツッコミ演出の取り出し口。実ライブと同じ表示部品（live-room）を使うため、
// 文脈（LiveReactionSourceContext）に体験版のストアを渡す。
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import type { LiveReactionSource } from "@/lib/liveReactionSource";

export const liveDemoReactionSource: LiveReactionSource = {
  claimReactionEvent: (predicate, now) => useLiveDemoStore.getState().claimReactionEvent(predicate, now),
  useLaughEventSeq: () => useLiveDemoStore((s) => s.laughEventSeq),
};
