// アプリ全体（ホーム/ガチャ/ショップ/ランキング/マイページ）で共有するダミーのログイン中ユーザー状態。
// Supabase接続前のモックのため、すべてローカルのzustandストアで完結させる。
// ライブ体験（useLiveDemoStore）とは独立管理し、最終結果画面から表彰ボーナスを加算する（§5.4・§6.2）。

import { create } from "zustand";

import { drawGachaItem, getRankByMeter, GACHA_COST } from "@/data/collectionData";
import type { CollectionItem, DojoUser, ItemType } from "@/types/economy";

const INITIAL_USER: DojoUser = {
  displayName: "あなた",
  bio: "高座に立つのが夢の見習いです。よろしくお願いします！",
  rank: "zenza",
  masteryMeter: 260, // 「前座」到達済み・「二ツ目」まであと少し、という体験しやすい初期値
  points: 5000, // ガチャ・ショップを試しやすいよう多めに設定
  liveCount: 4,
  awardCounts: { first: 1, second: 1, third: 0 },
  bestAnswerCount: 1,
  inventory: {
    ownedItemIds: ["costume-keiko-maekake", "icon-sensu", "bg-chochin"],
    equipped: {
      costumeId: "costume-keiko-maekake",
      iconPartId: "icon-sensu",
      bgPatternId: "bg-chochin",
    },
  },
};

interface UserState {
  user: DojoUser;
  addPoints: (amount: number) => void;
  addMastery: (amount: number) => void;
  pullGacha: () => { ok: true; item: CollectionItem; isNew: boolean } | { ok: false; reason: string };
  pullGachaMulti: (
    count: number,
  ) =>
    | { ok: true; results: { item: CollectionItem; isNew: boolean }[] }
    | { ok: false; reason: string };
  purchaseItem: (itemId: string, price: number) => { ok: boolean; reason?: string };
  equipItem: (item: CollectionItem) => void;
  updateBio: (bio: string) => void;
  resetUser: () => void;
}

export const useUserStore = create<UserState>()((set, get) => ({
  user: INITIAL_USER,

  addPoints: (amount) => {
    set((s) => ({ user: { ...s.user, points: Math.max(0, s.user.points + amount) } }));
  },

  addMastery: (amount) => {
    set((s) => {
      const masteryMeter = s.user.masteryMeter + amount;
      return {
        user: { ...s.user, masteryMeter, rank: getRankByMeter(masteryMeter).key },
      };
    });
  },

  pullGacha: () => {
    const { user } = get();
    if (user.points < GACHA_COST) {
      return { ok: false, reason: "ポイントが足りません" };
    }
    const item = drawGachaItem();
    // NEW!演出の判定は「初取得かどうか」のまま。所持数自体は重複所持を許可してカウントする（第7ラウンドフィードバック）。
    const isNew = !user.inventory.ownedItemIds.includes(item.id);
    set((s) => ({
      user: {
        ...s.user,
        points: s.user.points - GACHA_COST,
        inventory: {
          ...s.user.inventory,
          ownedItemIds: [...s.user.inventory.ownedItemIds, item.id],
        },
      },
    }));
    return { ok: true, item, isNew };
  },

  pullGachaMulti: (count) => {
    const { user } = get();
    const totalCost = GACHA_COST * count;
    if (user.points < totalCost) {
      return { ok: false, reason: "ポイントが足りません" };
    }
    const results: { item: CollectionItem; isNew: boolean }[] = [];
    let ownedItemIds = user.inventory.ownedItemIds;
    for (let i = 0; i < count; i += 1) {
      const item = drawGachaItem();
      const isNew = !ownedItemIds.includes(item.id);
      ownedItemIds = [...ownedItemIds, item.id];
      results.push({ item, isNew });
    }
    set((s) => ({
      user: {
        ...s.user,
        points: s.user.points - totalCost,
        inventory: { ...s.user.inventory, ownedItemIds },
      },
    }));
    return { ok: true, results };
  },

  purchaseItem: (itemId, price) => {
    const { user } = get();
    if (user.inventory.ownedItemIds.includes(itemId)) {
      return { ok: false, reason: "すでに所持しています" };
    }
    if (user.points < price) {
      return { ok: false, reason: "ポイントが足りません" };
    }
    set((s) => ({
      user: {
        ...s.user,
        points: s.user.points - price,
        inventory: {
          ...s.user.inventory,
          ownedItemIds: [...s.user.inventory.ownedItemIds, itemId],
        },
      },
    }));
    return { ok: true };
  },

  equipItem: (item: CollectionItem) => {
    const equippedKey: Record<ItemType, keyof DojoUser["inventory"]["equipped"]> = {
      costume: "costumeId",
      icon_part: "iconPartId",
      bg_pattern: "bgPatternId",
    };
    set((s) => ({
      user: {
        ...s.user,
        inventory: {
          ...s.user.inventory,
          equipped: {
            ...s.user.inventory.equipped,
            [equippedKey[item.type]]: item.id,
          },
        },
      },
    }));
  },

  updateBio: (bio) => {
    set((s) => ({ user: { ...s.user, bio } }));
  },

  resetUser: () => set({ user: INITIAL_USER }),
}));
