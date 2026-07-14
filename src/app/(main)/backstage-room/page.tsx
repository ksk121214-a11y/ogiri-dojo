"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import { getCollectionItem, groupOwnedItems } from "@/data/collectionData";
import {
  DEFAULT_ROOM_BG_CLASS,
  ITEM_TYPE_EMOJI,
  ITEM_TYPE_LABEL,
  RARITY_TEXT_CLASS,
  ROOM_BG_CLASS,
} from "@/lib/economyUi";
import { useUserStore } from "@/store/useUserStore";
import type { CollectionItem, ItemType } from "@/types/economy";

const TYPE_ORDER: ItemType[] = ["costume", "icon_part", "bg_pattern"];

const EQUIPPED_KEY: Record<ItemType, "costumeId" | "iconPartId" | "bgPatternId"> = {
  costume: "costumeId",
  icon_part: "iconPartId",
  bg_pattern: "bgPatternId",
};

// 楽屋（カスタム専用の部屋）画面：所持している衣装・アイコンパーツ・背景柄を選んで
// 見た目を切り替えられるダミーUI。マイページ（実績・段位の確認）とは役割を分け、
// ここでは「着せ替え・模様替え」の操作そのものを主役にする。
// 装備状態はマイページ・ショップと共有のuseUserStoreにそのまま反映する（永続化・Supabase接続は不要）。
export default function BackstageRoomPage() {
  const user = useUserStore((s) => s.user);
  const equipItem = useUserStore((s) => s.equipItem);
  const [activeType, setActiveType] = useState<ItemType>("costume");
  const [message, setMessage] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  const handleEquip = (item: NonNullable<ReturnType<typeof getCollectionItem>>) => {
    equipItem(item);
    setMessage(`${item.name}に着替えました。部屋の見た目に反映されました！`);
    setFlashKey((k) => k + 1);
  };

  // 所持アイテムはアイテムIDごとに集計し、1アイテム1カード＋所持数バッジで表示する（第7ラウンドフィードバック）。
  const ownedByType = useMemo(() => {
    const map = new Map<ItemType, { item: CollectionItem; count: number }[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const grouped of groupOwnedItems(user.inventory.ownedItemIds)) {
      map.get(grouped.item.type)?.push(grouped);
    }
    return map;
  }, [user.inventory.ownedItemIds]);

  const equippedCostume = user.inventory.equipped.costumeId
    ? getCollectionItem(user.inventory.equipped.costumeId)
    : undefined;
  const equippedIcon = user.inventory.equipped.iconPartId
    ? getCollectionItem(user.inventory.equipped.iconPartId)
    : undefined;
  const equippedBg = user.inventory.equipped.bgPatternId
    ? getCollectionItem(user.inventory.equipped.bgPatternId)
    : undefined;

  const roomBgClass = equippedBg
    ? (ROOM_BG_CLASS[equippedBg.id] ?? DEFAULT_ROOM_BG_CLASS)
    : DEFAULT_ROOM_BG_CLASS;

  const activeItems = ownedByType.get(activeType) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          BACKSTAGE ROOM
        </p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          楽屋
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          ここでは所持している衣装・アイコンパーツ・背景柄をタップするだけで、その場ですぐに模様替え・着せ替えができます。買い物は「ガチャ」内の衣装蔵で。
        </p>
      </div>

      {message && (
        <p className="rounded-lg border border-dojo-curtain-gold/40 bg-dojo-light-brown px-4 py-2 text-center font-sans text-xs font-bold text-dojo-ink">
          {message}
        </p>
      )}

      {/* 部屋プレビュー：ソファ・テーブル・テレビを配置した簡易な部屋の中に、
          装備中のアバター・背景柄をその場で反映する（第6ラウンドフィードバック） */}
      <motion.div
        key={flashKey}
        initial={{ scale: 0.97, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl border border-dojo-dark-brown/20 bg-gradient-to-b p-6 text-center sm:p-8 ${roomBgClass}`}
      >
        {/* 壁掛けテレビ */}
        <div className="flex w-full items-start justify-end">
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-9 w-14 items-center justify-center rounded-md border-2 border-dojo-ink/70 bg-dojo-ink text-base shadow-inner sm:h-11 sm:w-20 sm:text-lg">
              📺
            </div>
            <div className="h-1.5 w-7 rounded-full bg-dojo-dark-brown/50 sm:w-9" />
          </div>
        </div>

        <div className="relative">
          <AvatarPlaceholder size={104} />
          {equippedIcon && (
            <span className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-dojo-curtain-gold bg-dojo-tatami-cream text-lg shadow">
              {ITEM_TYPE_EMOJI.icon_part}
            </span>
          )}
        </div>
        <p className="font-brush text-xl text-dojo-ink">{user.displayName}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            衣装：{equippedCostume ? equippedCostume.name : "未装備"}
          </span>
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            アイコン：{equippedIcon ? equippedIcon.name : "未装備"}
          </span>
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            背景：{equippedBg ? equippedBg.name : "未装備"}
          </span>
        </div>

        {/* ソファ・テーブル（簡易ダミーの家具） */}
        <div className="mt-2 flex w-full items-end justify-center gap-3 sm:gap-5">
          <div className="flex h-12 max-w-[110px] flex-1 items-center justify-center rounded-t-2xl rounded-b-md bg-dojo-curtain-red/70 text-2xl shadow-sm sm:h-14 sm:text-3xl">
            🛋️
          </div>
          <div className="flex h-8 max-w-[90px] flex-1 items-center justify-center rounded-md border-2 border-dojo-dark-brown/60 bg-dojo-light-brown/80 text-lg shadow-sm sm:h-10 sm:text-xl">
            🍵
          </div>
          <div className="flex h-12 max-w-[110px] flex-1 items-center justify-center rounded-t-2xl rounded-b-md bg-dojo-curtain-red/70 text-2xl shadow-sm sm:h-14 sm:text-3xl">
            🛋️
          </div>
        </div>
        <p className="font-sans text-[10px] text-dojo-dark-brown/70">
          簡易な部屋イメージ（ダミー表示）
        </p>
      </motion.div>

      <p className="rounded-full bg-dojo-curtain-gold/20 px-4 py-2 text-center font-sans text-[11px] font-bold text-dojo-dark-brown">
        🪄 下のカードをタップすると、その場ですぐに着せ替えできます
      </p>

      <div className="flex gap-2 rounded-full border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-1">
        {TYPE_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveType(type)}
            title={ITEM_TYPE_LABEL[type]}
            aria-label={ITEM_TYPE_LABEL[type]}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 py-2 font-sans text-xs font-bold transition sm:text-sm ${
              activeType === type
                ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
                : "text-dojo-dark-brown hover:bg-dojo-light-brown"
            }`}
          >
            <span className="text-xl">{ITEM_TYPE_EMOJI[type]}</span>
            <span className="text-[10px] font-normal opacity-70">
              ({ownedByType.get(type)?.length ?? 0})
            </span>
          </button>
        ))}
      </div>

      {activeItems.length === 0 ? (
        <p className="rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/40 p-6 text-center font-sans text-xs text-dojo-dark-brown">
          {ITEM_TYPE_LABEL[activeType]}をまだ所持していません。
          <Link href="/gacha" className="font-bold text-dojo-ink hover:underline">
            ガチャ・衣装蔵
          </Link>
          で手に入れましょう。
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {activeItems.map(({ item, count }) => {
            const equipped = user.inventory.equipped[EQUIPPED_KEY[item.type]] === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleEquip(item)}
                disabled={equipped}
                className={`relative flex flex-col items-center gap-0.5 rounded-lg border bg-dojo-light-brown/60 p-1.5 text-center transition disabled:cursor-default ${
                  equipped
                    ? "border-dojo-curtain-gold shadow-[0_0_14px_rgba(232,184,76,0.35)]"
                    : "border-dojo-dark-brown/20 hover:border-dojo-curtain-gold hover:shadow-[0_0_10px_rgba(232,184,76,0.25)]"
                }`}
              >
                {count > 1 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-dojo-curtain-red px-1.5 py-0.5 font-sans text-[9px] font-bold leading-none text-dojo-washi-white shadow">
                    ×{count}
                  </span>
                )}
                {equipped && (
                  <span className="absolute -left-1 -top-1 rounded-full bg-dojo-curtain-gold px-1.5 py-0.5 font-sans text-[8px] font-bold leading-none text-dojo-ink shadow">
                    着用中
                  </span>
                )}
                <span className="text-lg">{ITEM_TYPE_EMOJI[item.type]}</span>
                <p className="w-full truncate font-sans text-[9px] font-bold text-dojo-ink">
                  {item.name}
                </p>
                <p className={`font-sans text-[8px] ${RARITY_TEXT_CLASS[item.rarity]}`}>
                  {item.rarity}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
