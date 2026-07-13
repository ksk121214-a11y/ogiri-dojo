// ガチャ・ショップ画面で使うレアリティ／アイテム種別の表示スタイルまとめ。

import type { ItemType, Rarity } from "@/types/economy";

export const RARITY_LABEL: Record<Rarity, string> = {
  N: "N",
  R: "R",
  SR: "SR",
  SSR: "SSR",
};

// ガチャ/ショップは畳生成りベースの明るい画面（§2.5）のため、暗背景前提の
// 灰紫・灯り橙系の淡色ではなく、明るい面でも視認できる濃色をレアリティ表示に使う。
// SSRは幕金（gold）だと薄茶・畳生成りの背景でコントラストが不足するため、
// 同系統の濃い色である深緋（dojo-deep-crimson）を使う（第5ラウンドフィードバック）。
export const RARITY_TEXT_CLASS: Record<Rarity, string> = {
  N: "text-dojo-dark-brown/70",
  R: "text-dojo-tatami-green",
  SR: "text-dojo-cheer-pink",
  SSR: "text-dojo-deep-crimson",
};

export const RARITY_BORDER_CLASS: Record<Rarity, string> = {
  N: "border-dojo-dark-brown/30",
  R: "border-dojo-tatami-green/60",
  SR: "border-dojo-cheer-pink/60",
  SSR: "border-dojo-curtain-gold",
};

export const RARITY_GLOW_CLASS: Record<Rarity, string> = {
  N: "",
  R: "shadow-[0_0_18px_rgba(255,138,61,0.25)]",
  SR: "shadow-[0_0_22px_rgba(255,111,165,0.35)]",
  SSR: "shadow-[0_0_35px_rgba(232,184,76,0.55)]",
};

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  costume: "衣装",
  icon_part: "アイコンパーツ",
  bg_pattern: "背景柄",
};

export const ITEM_TYPE_EMOJI: Record<ItemType, string> = {
  costume: "👘",
  icon_part: "🪭",
  bg_pattern: "🎏",
};
