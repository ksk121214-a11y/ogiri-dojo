"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { COLLECTION_ITEMS, GACHA_COST, GACHA_RATES } from "@/data/collectionData";
import {
  ITEM_TYPE_EMOJI,
  ITEM_TYPE_LABEL,
  RARITY_BORDER_CLASS,
  RARITY_GLOW_CLASS,
  RARITY_TEXT_CLASS,
} from "@/lib/economyUi";
import { useUserStore } from "@/store/useUserStore";
import type { CollectionItem, ItemType } from "@/types/economy";

interface PullResult {
  key: number;
  item: CollectionItem;
  isNew: boolean;
}

const MULTI_PULL_COUNT = 10;

type MainTab = "gacha" | "shop";

const TYPE_ORDER: ItemType[] = ["costume", "icon_part", "bg_pattern"];

const EQUIPPED_KEY: Record<ItemType, "costumeId" | "iconPartId" | "bgPatternId"> = {
  costume: "costumeId",
  icon_part: "iconPartId",
  bg_pattern: "bgPatternId",
};

const MAIN_TABS: { key: MainTab; label: string; emoji: string }[] = [
  { key: "gacha", label: "ガチャ", emoji: "🎰" },
  { key: "shop", label: "衣装蔵（ショップ）", emoji: "🛍️" },
];

// ガチャ・ショップ画面：第6ラウンドフィードバックでナビ項目を減らすため、
// ガチャ（抽選体験）と衣装蔵＝ショップ（個別購入・装備）をページ内タブで統合した。
// ガチャ＝運試しの体験、ショップ＝欲しいものを狙って買う体験、と性質が違うため
// 見た目もタブで明確に切り替える（仕様書§5.3.2）。
export default function GachaPage() {
  const [mainTab, setMainTab] = useState<MainTab>("gacha");

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          {mainTab === "gacha" ? "GACHA" : "SHOP / COLLECTION"}
        </p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          {mainTab === "gacha" ? "寄席のくじ引き" : "衣装蔵"}
        </h1>
        <p className="mt-2 max-w-md font-sans text-xs text-dojo-dark-brown">
          {mainTab === "gacha"
            ? "衣装・アイコンパーツ・背景柄がランダムで手に入ります。段位による排出率の差はありません（§5.3.2）。"
            : "欲しいアイテムを狙って個別購入できます。着せ替え・模様替えは「楽屋」で行えます。"}
        </p>
      </div>

      <div className="flex w-full max-w-sm gap-2 rounded-full border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-1">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMainTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 font-sans text-xs font-bold transition sm:text-sm ${
              mainTab === tab.key
                ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
                : "text-dojo-dark-brown hover:bg-dojo-light-brown"
            }`}
          >
            <span>{tab.emoji}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "gacha" ? <GachaTab /> : <ShopTab />}
    </div>
  );
}

function GachaTab() {
  const points = useUserStore((s) => s.user.points);
  const pullGacha = useUserStore((s) => s.pullGacha);
  const pullGachaMulti = useUserStore((s) => s.pullGachaMulti);
  const [drawing, setDrawing] = useState(false);
  const [result, setResult] = useState<PullResult | null>(null);
  const [multiResults, setMultiResults] = useState<
    { item: CollectionItem; isNew: boolean }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState(0);

  const multiCost = GACHA_COST * MULTI_PULL_COUNT;

  const handlePull = () => {
    setError(null);
    setDrawing(true);
    setResult(null);
    setMultiResults(null);
    // 抽選そのものは一瞬だが、演出のための「間」をわずかに作る（デザイン方針§4.1のノリを踏襲）
    window.setTimeout(() => {
      const outcome = pullGacha();
      setDrawing(false);
      if (!outcome.ok) {
        setError(outcome.reason);
        return;
      }
      setResultKey((k) => k + 1);
      setResult({ key: resultKey + 1, item: outcome.item, isNew: outcome.isNew });
    }, 650);
  };

  const handlePullMulti = () => {
    setError(null);
    setDrawing(true);
    setResult(null);
    setMultiResults(null);
    window.setTimeout(() => {
      const outcome = pullGachaMulti(MULTI_PULL_COUNT);
      setDrawing(false);
      if (!outcome.ok) {
        setError(outcome.reason);
        return;
      }
      setResultKey((k) => k + 1);
      setMultiResults(outcome.results);
    }, 650);
  };

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex items-center gap-6 rounded-2xl border border-dojo-curtain-gold/30 bg-dojo-light-brown/70 px-6 py-4">
        <div className="text-center">
          <p className="font-sans text-[10px] text-dojo-dark-brown">所持pt</p>
          <p className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
            {points.toLocaleString()}
          </p>
        </div>
        <div className="h-8 w-px bg-dojo-dark-brown/30" />
        <div className="text-center">
          <p className="font-sans text-[10px] text-dojo-dark-brown">1回の消費</p>
          <p className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
            {GACHA_COST}pt
          </p>
        </div>
      </div>

      <div
        className={`relative flex w-full items-center justify-center ${
          multiResults ? "max-w-2xl" : "h-56 max-w-sm"
        }`}
      >
        <AnimatePresence mode="wait">
          {drawing ? (
            <motion.div
              key="drawing"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, rotate: [0, 8, -8, 0] }}
              exit={{ opacity: 0 }}
              transition={{ rotate: { duration: 0.5, repeat: Infinity } }}
              className="flex h-40 w-40 items-center justify-center rounded-full border-4 border-dojo-curtain-gold bg-dojo-light-brown text-5xl shadow-[0_0_40px_rgba(232,184,76,0.5)]"
            >
              🎁
            </motion.div>
          ) : result ? (
            <motion.div
              key={`result-${result.key}`}
              initial={{ opacity: 0, scale: 0.6, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 16 }}
              className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 bg-dojo-light-brown p-6 text-center ${RARITY_BORDER_CLASS[result.item.rarity]} ${RARITY_GLOW_CLASS[result.item.rarity]}`}
            >
              <span
                className={`font-brush text-2xl ${RARITY_TEXT_CLASS[result.item.rarity]}`}
              >
                {result.item.rarity}
              </span>
              <span className="text-5xl">{ITEM_TYPE_EMOJI[result.item.type]}</span>
              <p className="font-sans text-lg font-bold text-dojo-ink">
                {result.item.name}
              </p>
              <p className="font-sans text-[11px] text-dojo-dark-brown">
                {ITEM_TYPE_LABEL[result.item.type]}
              </p>
              <p className="font-sans text-xs text-dojo-dark-brown">
                {result.item.description}
              </p>
              <span
                className={`mt-1 rounded-full px-3 py-1 font-sans text-[10px] ${
                  result.isNew
                    ? "bg-dojo-curtain-red text-dojo-washi-white"
                    : "bg-dojo-dark-brown/15 text-dojo-dark-brown"
                }`}
              >
                {result.isNew ? "NEW!" : "所持済み（重複）"}
              </span>
            </motion.div>
          ) : multiResults ? (
            <motion.div
              key={`multi-${resultKey}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid w-full grid-cols-3 gap-2 sm:grid-cols-5"
            >
              {multiResults.map((r, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.5, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{
                    delay: idx * 0.06,
                    type: "spring",
                    stiffness: 260,
                    damping: 18,
                  }}
                  className={`relative flex flex-col items-center gap-1 rounded-xl border-2 bg-dojo-light-brown p-2 text-center ${RARITY_BORDER_CLASS[r.item.rarity]} ${RARITY_GLOW_CLASS[r.item.rarity]}`}
                >
                  {r.isNew && (
                    <span className="absolute -right-1.5 -top-1.5 rounded-full bg-dojo-curtain-red px-1.5 py-0.5 font-sans text-[8px] font-bold text-dojo-washi-white">
                      NEW
                    </span>
                  )}
                  <span
                    className={`font-brush text-xs ${RARITY_TEXT_CLASS[r.item.rarity]}`}
                  >
                    {r.item.rarity}
                  </span>
                  <span className="text-2xl">{ITEM_TYPE_EMOJI[r.item.type]}</span>
                  <p className="w-full truncate font-sans text-[10px] font-bold text-dojo-ink">
                    {r.item.name}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex h-40 w-40 items-center justify-center rounded-full border-4 border-dashed border-dojo-dark-brown/40 text-5xl"
            >
              🎁
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <p className="font-sans text-xs text-dojo-curtain-red">{error}</p>
      )}

      <div className="flex w-full max-w-sm flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handlePull}
          disabled={drawing || points < GACHA_COST}
          className="flex-1 rounded-full bg-dojo-curtain-red px-8 py-4 font-sans text-base font-bold text-dojo-washi-white shadow-[0_0_30px_rgba(192,38,63,0.4)] transition hover:bg-dojo-deep-crimson active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {drawing ? "抽選中……" : `ガチャを引く（${GACHA_COST}pt）`}
        </button>
        <button
          type="button"
          onClick={handlePullMulti}
          disabled={drawing || points < multiCost}
          className="flex-1 rounded-full border-2 border-dojo-curtain-gold bg-dojo-backstage-navy px-8 py-4 font-sans text-base font-bold text-dojo-curtain-gold shadow-[0_0_30px_rgba(232,184,76,0.3)] transition hover:bg-dojo-backstage-navy/80 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {drawing
            ? "抽選中……"
            : `${MULTI_PULL_COUNT}連引く（${multiCost.toLocaleString()}pt）`}
        </button>
      </div>

      <div className="w-full max-w-sm rounded-xl border border-dojo-dark-brown/20 bg-dojo-light-brown/40 p-4">
        <p className="mb-2 font-sans text-[11px] tracking-widest text-dojo-dark-brown">
          排出率
        </p>
        <ul className="space-y-1 font-sans text-xs text-dojo-ink">
          {(Object.keys(GACHA_RATES) as Array<keyof typeof GACHA_RATES>).map(
            (rarity) => (
              <li key={rarity} className="flex items-center justify-between">
                <span className={RARITY_TEXT_CLASS[rarity]}>{rarity}</span>
                <span className="tabular-nums">
                  {(GACHA_RATES[rarity] * 100).toFixed(0)}%
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

// ショップ/コレクションタブ：仕様書§5.3.2の具体アイテムをカテゴリタブで切り替えて一覧表示し、
// 個別購入・装備をダミーで行える（所持中/未所持/装備中を視覚的に区別、§14）。
// 装備ボタンも残すが、着せ替えを楽しむ場所は「楽屋」であることを案内する（第6ラウンドフィードバック）。
function ShopTab() {
  const user = useUserStore((s) => s.user);
  const purchaseItem = useUserStore((s) => s.purchaseItem);
  const equipItem = useUserStore((s) => s.equipItem);
  const [message, setMessage] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ItemType>("costume");

  const grouped = useMemo(() => {
    const map = new Map<ItemType, typeof COLLECTION_ITEMS>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const item of COLLECTION_ITEMS) {
      map.get(item.type)?.push(item);
    }
    return map;
  }, []);

  const activeItems = grouped.get(activeType) ?? [];

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/90 px-4 py-3">
        <span className="font-sans text-xs text-dojo-dark-brown">所持pt</span>
        <span className="flex items-center gap-1 font-sans text-lg font-bold tabular-nums text-dojo-ink">
          🪙{user.points.toLocaleString()}
          <span className="text-xs font-normal text-dojo-dark-brown">pt</span>
        </span>
      </div>

      {message && (
        <p className="rounded-lg border border-dojo-curtain-gold/40 bg-dojo-light-brown px-4 py-2 text-center font-sans text-xs font-bold text-dojo-ink">
          {message}
        </p>
      )}

      <div className="flex gap-2 rounded-full border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-1">
        {TYPE_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveType(type)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 font-sans text-xs font-bold transition sm:text-sm ${
              activeType === type
                ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
                : "text-dojo-dark-brown hover:bg-dojo-light-brown"
            }`}
          >
            <span>{ITEM_TYPE_EMOJI[type]}</span>
            {ITEM_TYPE_LABEL[type]}
            <span className="text-[10px] font-normal opacity-70">
              ({grouped.get(type)?.length ?? 0})
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activeItems.map((item) => {
          const ownedCount = user.inventory.ownedItemIds.filter((id) => id === item.id).length;
          const owned = ownedCount > 0;
          const equipped = user.inventory.equipped[EQUIPPED_KEY[item.type]] === item.id;
          const affordable = user.points >= item.priceForShop;
          return (
            <div
              key={item.id}
              className={`flex flex-col gap-2 rounded-xl border bg-dojo-light-brown/60 p-4 ${RARITY_BORDER_CLASS[item.rarity]} ${equipped ? RARITY_GLOW_CLASS[item.rarity] : ""}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-brush text-sm ${RARITY_TEXT_CLASS[item.rarity]}`}
                >
                  {item.rarity}
                </span>
                {equipped && (
                  <span className="rounded-full bg-dojo-curtain-gold px-2 py-0.5 font-sans text-[10px] font-bold text-dojo-ink">
                    装備中
                  </span>
                )}
              </div>
              <div className="flex items-center justify-center rounded-lg bg-dojo-dark-brown/10 py-4 text-3xl">
                {ITEM_TYPE_EMOJI[item.type]}
              </div>
              <p className="font-sans text-sm font-bold text-dojo-ink">
                {item.name}
              </p>
              <p className="min-h-8 font-sans text-[11px] text-dojo-dark-brown">
                {item.description}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-dojo-dark-brown/15 pt-2.5">
                <span className="flex items-center gap-1 font-sans text-sm font-bold tabular-nums text-dojo-ink">
                  {owned ? (
                    <span className="text-xs font-normal text-dojo-dark-brown">
                      所持済み{ownedCount > 1 ? ` ×${ownedCount}` : ""}
                    </span>
                  ) : (
                    <>
                      🪙{item.priceForShop}
                      <span className="text-[10px] font-normal text-dojo-dark-brown">
                        pt
                      </span>
                    </>
                  )}
                </span>
                {owned ? (
                  <button
                    type="button"
                    disabled={equipped}
                    onClick={() => {
                      equipItem(item);
                      setMessage(`${item.name}を装備しました`);
                    }}
                    className="rounded-full border border-dojo-curtain-gold/60 px-4 py-2 font-sans text-xs font-bold text-dojo-ink transition hover:bg-dojo-curtain-gold hover:text-dojo-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {equipped ? "装備中" : "装備する"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const outcome = purchaseItem(item.id, item.priceForShop);
                      setMessage(
                        outcome.ok
                          ? `${item.name}を購入しました`
                          : outcome.reason ?? "購入できませんでした",
                      );
                    }}
                    disabled={!affordable}
                    className={`rounded-full px-4 py-2 font-sans text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      affordable
                        ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.35)] hover:bg-dojo-deep-crimson"
                        : "bg-dojo-dark-brown/15 text-dojo-dark-brown"
                    }`}
                  >
                    {affordable ? "購入する" : "pt不足"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center font-sans text-[11px] text-dojo-dark-brown">
        買った衣装のコーディネートは「楽屋」でその場で着せ替えできます。
      </p>
    </div>
  );
}
