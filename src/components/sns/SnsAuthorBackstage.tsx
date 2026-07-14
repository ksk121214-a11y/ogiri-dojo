"use client";

import { motion } from "framer-motion";

import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { getCollectionItem } from "@/data/collectionData";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import {
  DEFAULT_ROOM_BG_CLASS,
  ITEM_TYPE_EMOJI,
  ROOM_BG_CLASS,
} from "@/lib/economyUi";

// 「楽屋に挨拶」ボタンから訪れる、他の演者（ダミー投稿者）の楽屋を覗き見る専用ページ。
// 自分の楽屋（backstage-room）と違い、着せ替え操作は一切できない見学専用の表示。
export default function SnsAuthorBackstage({ authorId }: { authorId: string }) {
  const author = getDummySnsAuthor(authorId);

  if (!author) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-dojo-dark-brown">
          演者が見つかりませんでした。
        </p>
        <SnsBackButton className="font-sans text-xs font-bold text-dojo-ink hover:underline" />
      </div>
    );
  }

  const costume = getCollectionItem(author.equippedCostumeId);
  const icon = getCollectionItem(author.equippedIconPartId);
  const bg = getCollectionItem(author.equippedBgPatternId);
  const roomBgClass = bg ? (ROOM_BG_CLASS[bg.id] ?? DEFAULT_ROOM_BG_CLASS) : DEFAULT_ROOM_BG_CLASS;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <SnsBackButton fallbackHref={`/sns/u/${authorId}`} />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          楽屋に挨拶
        </p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
          {author.displayName}の楽屋
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          お邪魔します🙇　他の演者の楽屋は見学だけできます（着せ替えは本人のみ）。
        </p>
      </div>

      <motion.div
        initial={{ scale: 0.97, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl border border-dojo-dark-brown/20 bg-gradient-to-b p-6 text-center sm:p-8 ${roomBgClass}`}
      >
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
          {icon && (
            <span className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-dojo-curtain-gold bg-dojo-tatami-cream text-lg shadow">
              {ITEM_TYPE_EMOJI.icon_part}
            </span>
          )}
        </div>
        <p className="font-brush text-xl text-dojo-ink">{author.displayName}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            衣装：{costume ? costume.name : "未装備"}
          </span>
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            アイコン：{icon ? icon.name : "未装備"}
          </span>
          <span className="rounded-full border border-dojo-dark-brown/25 bg-dojo-tatami-cream/70 px-3 py-1 font-sans text-[11px] text-dojo-dark-brown">
            背景：{bg ? bg.name : "未装備"}
          </span>
        </div>

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
    </div>
  );
}
