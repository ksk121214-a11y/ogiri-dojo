// 経済（ポイント・ガチャ・コレクション・段位）まわりのダミー実装用の型定義。
// 仕様書.md §5・§6・§15 のデータモデルをベースに、ローカルモック用に簡略化したもの。
// Supabase接続時はこれらの型をベースにテーブル定義へ寄せていく想定。

export type Rarity = "N" | "R" | "SR" | "SSR";

export type ItemType = "costume" | "icon_part" | "bg_pattern";

export interface CollectionItem {
  id: string;
  type: ItemType;
  rarity: Rarity;
  name: string;
  description: string;
  priceForShop: number; // ショップで個別購入する場合の消費ポイント（§5.5）
}

// 段位（8段階、§6.3）
export type RankKey =
  | "minarai"
  | "zenza"
  | "futatsume"
  | "shinuchi"
  | "hanagata_shinuchi"
  | "ookanban"
  | "meijin"
  | "tatsujin";

export interface RankDefinition {
  key: RankKey;
  order: number; // 1〜8
  label: string;
  threshold: number; // masteryMeterがこの値以上で到達（§6.3.5）
}

export interface UserInventory {
  ownedItemIds: string[];
  equipped: {
    costumeId?: string;
    iconPartId?: string;
    bgPatternId?: string;
  };
}

export interface DojoUser {
  displayName: string;
  bio: string; // 一言コメント（プロフィールの自己紹介、§寄合帳プロフィール）
  rank: RankKey;
  masteryMeter: number; // 熟練度メーター（減らない経験値、§6.1）
  points: number; // 消費用ポイント残高（§5.2）
  liveCount: number;
  awardCounts: { first: number; second: number; third: number };
  bestAnswerCount: number;
  inventory: UserInventory;
}
