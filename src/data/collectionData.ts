// ガチャ・コレクション・段位のダミーデータ。
// 仕様書.md §5.3.2（衣装14種・アイコンパーツ10種・背景柄7種）・§6.3（8段位）・
// §6.3.5（昇段閾値）・§5.4/§5.5（ポイント経済の初期値）をそのままダミー実装に落とし込む。

import type { CollectionItem, RankDefinition, Rarity } from "@/types/economy";

// ① 衣装（costume）14種
const COSTUMES: CollectionItem[] = [
  { id: "costume-keiko-maekake", type: "costume", rarity: "N", name: "稽古着まえかけ", description: "下積み感のある楽屋の普段着。裾に汗染みのワンポイント", priceForShop: 150 },
  { id: "costume-gakuran", type: "costume", rarity: "N", name: "学ラン風燕尾襟", description: "バイト芸人・学生ノリを感じさせる普段着", priceForShop: 150 },
  { id: "costume-jinbei", type: "costume", rarity: "N", name: "甚平（夏の道場）", description: "夏場の稽古風景をイメージしたラフな和装", priceForShop: 150 },
  { id: "costume-parka", type: "costume", rarity: "N", name: "パーカー楽屋着", description: "素の自分感を出すカジュアル私服", priceForShop: 150 },
  { id: "costume-yoreyore-suit", type: "costume", rarity: "N", name: "よれよれスーツ", description: "新人営業風、崩れたネクタイがポイント", priceForShop: 150 },
  { id: "costume-kuromontsuki", type: "costume", rarity: "R", name: "黒紋付羽織", description: "寄席の正装。二ツ目クラスの格を感じさせる装い", priceForShop: 220 },
  { id: "costume-shimarakugo", type: "costume", rarity: "R", name: "縞落語着物", description: "粋な縞柄の和装", priceForShop: 220 },
  { id: "costume-ohayashi", type: "costume", rarity: "R", name: "お囃子祭り半纏", description: "威勢のいい祭り柄の半纏", priceForShop: 220 },
  { id: "costume-mitsuzoroi", type: "costume", rarity: "R", name: "三ツ揃いスーツ", description: "漫才コンビ風の、かっちり決まったスーツ", priceForShop: 220 },
  { id: "costume-nishikie", type: "costume", rarity: "SR", name: "錦絵羽織", description: "金糸刺繍が入った豪華な羽織。真打クラスの晴れ舞台衣装", priceForShop: 300 },
  { id: "costume-enbifuku", type: "costume", rarity: "SR", name: "舞台燕尾服", description: "洋風のステージ衣装。スポットライトに映える仕立て", priceForShop: 300 },
  { id: "costume-neon-haori", type: "costume", rarity: "SR", name: "ネオン紋様羽織", description: "「ネオン寄席」らしい発光風の柄を纏った現代的な羽織", priceForShop: 300 },
  { id: "costume-donchou", type: "costume", rarity: "SSR", name: "緞帳纏い", description: "緞帳赤×幕金の特殊衣装。緞帳そのものを羽織ったような唯一無二のビジュアル", priceForShop: 500 },
  { id: "costume-hikari-matoi", type: "costume", rarity: "SSR", name: "光の纏（まとい）", description: "歓声ピンク〜灯り橙に発光するエフェクト付き特殊衣装。「達人」の証にふさわしい一着", priceForShop: 500 },
];

// ② アイコンパーツ（icon_part）10種
const ICON_PARTS: CollectionItem[] = [
  { id: "icon-sensu", type: "icon_part", rarity: "N", name: "扇子", description: "演芸の定番小物", priceForShop: 150 },
  { id: "icon-tenugui", type: "icon_part", rarity: "N", name: "手ぬぐい", description: "首・肩にかけるスタイル", priceForShop: 150 },
  { id: "icon-datemegane", type: "icon_part", rarity: "N", name: "伊達めがね", description: "芸人風の顔まわりアクセント", priceForShop: 150 },
  { id: "icon-tachimic", type: "icon_part", rarity: "R", name: "立ちマイク", description: "顔の近くに配置するアイコン", priceForShop: 220 },
  { id: "icon-zabuton-badge", type: "icon_part", rarity: "R", name: "座布団バッジ", description: "小さく添える勲章的アイコン", priceForShop: 220 },
  { id: "icon-maneki-badge", type: "icon_part", rarity: "R", name: "招き猫バッジ", description: "縁起物モチーフ", priceForShop: 220 },
  { id: "icon-taiko-bachi", type: "icon_part", rarity: "SR", name: "太鼓のバチ", description: "お囃子・寄席らしさのある小物", priceForShop: 300 },
  { id: "icon-matoi-mini", type: "icon_part", rarity: "SR", name: "纏（まとい）ミニチュア", description: "江戸情緒のある特別感ある小物", priceForShop: 300 },
  { id: "icon-kinsen-aura", type: "icon_part", rarity: "SSR", name: "金扇オーラ", description: "金の扇子＋常時発光エフェクト", priceForShop: 500 },
  { id: "icon-kamifubuki-ring", type: "icon_part", rarity: "SSR", name: "紙吹雪リング", description: "アイコン枠を常時紙吹雪パーティクルが囲む演出付きパーツ", priceForShop: 500 },
];

// ③ 背景柄（bg_pattern）7種
const BG_PATTERNS: CollectionItem[] = [
  { id: "bg-chochin", type: "bg_pattern", rarity: "N", name: "提灯柄", description: "幕金の提灯シルエットが並ぶ、和の記号的な柄", priceForShop: 100 },
  { id: "bg-seigaiha", type: "bg_pattern", rarity: "N", name: "青海波", description: "伝統紋様。舞台闇寄りの藍〜紫トーン", priceForShop: 100 },
  { id: "bg-kinpaku", type: "bg_pattern", rarity: "R", name: "金箔散らし", description: "幕金・光箔の箔押し風パターン、和紙白ベース", priceForShop: 180 },
  { id: "bg-donchou-gara", type: "bg_pattern", rarity: "R", name: "緞帳幕柄", description: "緞帳赤ベース＋金縁の波模様", priceForShop: 180 },
  { id: "bg-spotlight", type: "bg_pattern", rarity: "SR", name: "スポットライト光条", description: "灯り橙のグラデーション光条が放射状に広がる柄", priceForShop: 260 },
  { id: "bg-neon-yose", type: "bg_pattern", rarity: "SR", name: "ネオン寄席ネオンライン", description: "歓声ピンク×灯り橙のネオンライン、現代的な「ネオン寄席」感", priceForShop: 260 },
  { id: "bg-kamifubuki", type: "bg_pattern", rarity: "SSR", name: "紙吹雪舞い散る柄", description: "表彰演出をイメージした金・ピンクの紙吹雪パターン", priceForShop: 400 },
];

export const COLLECTION_ITEMS: CollectionItem[] = [
  ...COSTUMES,
  ...ICON_PARTS,
  ...BG_PATTERNS,
];

export function getCollectionItem(id: string): CollectionItem | undefined {
  return COLLECTION_ITEMS.find((item) => item.id === id);
}

// 所持アイテムIDの配列（重複あり）をアイテムIDごとに集計し、所持数付きの一覧にする（第7ラウンドフィードバック）。
export function groupOwnedItems(
  ownedItemIds: string[],
): { item: CollectionItem; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ownedItemIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const grouped: { item: CollectionItem; count: number }[] = [];
  for (const [id, count] of counts) {
    const item = getCollectionItem(id);
    if (item) grouped.push({ item, count });
  }
  return grouped;
}

// ④ レアリティ別排出率（B案・推奨：バランス型、§5.3.2④）
export const GACHA_RATES: Record<Rarity, number> = {
  N: 0.55,
  R: 0.33,
  SR: 0.1,
  SSR: 0.02,
};

export const GACHA_COST = 100; // ガチャ1回の消費ポイント（§5.5）

export function drawGachaItem(): CollectionItem {
  const r = Math.random();
  let rarity: Rarity;
  if (r < GACHA_RATES.SSR) {
    rarity = "SSR";
  } else if (r < GACHA_RATES.SSR + GACHA_RATES.SR) {
    rarity = "SR";
  } else if (r < GACHA_RATES.SSR + GACHA_RATES.SR + GACHA_RATES.R) {
    rarity = "R";
  } else {
    rarity = "N";
  }
  const pool = COLLECTION_ITEMS.filter((item) => item.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 8段位（§6.3）
export const RANK_DEFINITIONS: RankDefinition[] = [
  { key: "minarai", order: 1, label: "見習い", threshold: 0 },
  { key: "zenza", order: 2, label: "前座", threshold: 150 },
  { key: "futatsume", order: 3, label: "二ツ目", threshold: 400 },
  { key: "shinuchi", order: 4, label: "真打", threshold: 900 },
  { key: "hanagata_shinuchi", order: 5, label: "花形真打", threshold: 1800 },
  { key: "ookanban", order: 6, label: "大看板", threshold: 3200 },
  { key: "meijin", order: 7, label: "名人", threshold: 5500 },
  { key: "tatsujin", order: 8, label: "達人", threshold: 9000 },
];

export function getRankByMeter(masteryMeter: number): RankDefinition {
  let current = RANK_DEFINITIONS[0];
  for (const def of RANK_DEFINITIONS) {
    if (masteryMeter >= def.threshold) current = def;
  }
  return current;
}

export function getNextRank(masteryMeter: number): RankDefinition | null {
  const current = getRankByMeter(masteryMeter);
  return (
    RANK_DEFINITIONS.find((def) => def.order === current.order + 1) ?? null
  );
}

// 表彰ボーナス（順位別、§5.4）
export const BONUS_BY_RANK = { first: 300, second: 200, third: 100, participation: 30 } as const;
export const BEST_ANSWER_BONUS_POINTS = 100;

// 熟練度メーター加算（§6.2）
export const MASTERY_GAIN = {
  participation: 10,
  rankBonus: { first: 100, second: 60, third: 30 },
  bestAnswer: 50,
} as const;
