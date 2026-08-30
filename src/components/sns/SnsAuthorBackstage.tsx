"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { getCollectionItem } from "@/data/collectionData";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import {
  DEFAULT_ROOM_BG_CLASS,
  ITEM_TYPE_EMOJI,
  ROOM_BG_CLASS,
} from "@/lib/economyUi";

const GREETING_PHRASES = ["おはようございます", "よろしくお願いします"] as const;

// 「楽屋に挨拶」ボタンから訪れる、他の演者（ダミー投稿者）の楽屋を覗き見る専用ページ。
// 自分の楽屋（backstage-room、こちらは今回のデザイン刷新の対象外）と違い、着せ替え操作は
// 一切できない見学専用の表示。
// 2026-08-30: 外枠・文字色は寄合帳全体の新デザイン（StadiumPageShell）に統一した。
// 部屋の背景グラデーション（ROOM_BG_CLASS/DEFAULT_ROOM_BG_CLASS）はbackstage-room（対象外）と
// 共有しているため変更していない。
export default function SnsAuthorBackstage({ authorId }: { authorId: string }) {
  const author = getDummySnsAuthor(authorId);
  const [sentPhrase, setSentPhrase] = useState<string | null>(null);

  if (!author) {
    return (
      <StadiumPageShell contentTheme="kraft">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-sans text-sm text-[var(--ink)]/70">
            演者が見つかりませんでした。
          </p>
          <SnsBackButton />
        </div>
      </StadiumPageShell>
    );
  }

  const costume = getCollectionItem(author.equippedCostumeId);
  const icon = getCollectionItem(author.equippedIconPartId);
  const bg = getCollectionItem(author.equippedBgPatternId);
  const roomBgClass = bg ? (ROOM_BG_CLASS[bg.id] ?? DEFAULT_ROOM_BG_CLASS) : DEFAULT_ROOM_BG_CLASS;

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton fallbackHref={`/sns/u/${authorId}`} />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">
          楽屋に挨拶
        </p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)] sm:text-3xl">
          {author.displayName}の楽屋
        </h1>
        <p className="mt-2 font-sans text-xs text-[var(--ink)]/70">
          お邪魔します🙇　他の演者の楽屋は見学だけできます（着せ替えは本人のみ）。
        </p>
      </div>

      <motion.div
        initial={{ scale: 0.97, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl border border-[var(--ink)]/15 bg-gradient-to-b p-6 text-center sm:p-8 ${roomBgClass}`}
      >
        <div className="flex w-full items-start justify-end">
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-9 w-14 items-center justify-center rounded-md border-2 border-[var(--ink)]/70 bg-[var(--ink)] text-base shadow-inner sm:h-11 sm:w-20 sm:text-lg">
              📺
            </div>
            <div className="h-1.5 w-7 rounded-full bg-[var(--ink)]/40 sm:w-9" />
          </div>
        </div>

        <div className="relative">
          <AvatarPlaceholder size={104} />
          {icon && (
            <span className={`${stadiumStyles.grainAccent} absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full text-lg text-[var(--paper)] shadow`}>
              {ITEM_TYPE_EMOJI.icon_part}
            </span>
          )}
        </div>
        <p className="font-sans text-xl font-black text-[var(--ink)]">{author.displayName}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full border border-[var(--ink)]/20 bg-[var(--paper)]/70 px-3 py-1 font-sans text-[11px] text-[var(--ink)]/80">
            衣装：{costume ? costume.name : "未装備"}
          </span>
          <span className="rounded-full border border-[var(--ink)]/20 bg-[var(--paper)]/70 px-3 py-1 font-sans text-[11px] text-[var(--ink)]/80">
            アイコン：{icon ? icon.name : "未装備"}
          </span>
          <span className="rounded-full border border-[var(--ink)]/20 bg-[var(--paper)]/70 px-3 py-1 font-sans text-[11px] text-[var(--ink)]/80">
            背景：{bg ? bg.name : "未装備"}
          </span>
        </div>

        <div className="mt-2 flex w-full items-end justify-center gap-3 sm:gap-5">
          <div className="flex h-12 max-w-[110px] flex-1 items-center justify-center rounded-t-2xl rounded-b-md bg-[var(--accent)]/70 text-2xl shadow-sm sm:h-14 sm:text-3xl">
            🛋️
          </div>
          <div className="flex h-8 max-w-[90px] flex-1 items-center justify-center rounded-md border-2 border-[var(--ink)]/50 bg-[var(--paper)]/80 text-lg shadow-sm sm:h-10 sm:text-xl">
            🍵
          </div>
          <div className="flex h-12 max-w-[110px] flex-1 items-center justify-center rounded-t-2xl rounded-b-md bg-[var(--accent)]/70 text-2xl shadow-sm sm:h-14 sm:text-3xl">
            🛋️
          </div>
        </div>
        <p className="font-sans text-[10px] text-[var(--ink)]/60">
          簡易な部屋イメージ（ダミー表示）
        </p>
      </motion.div>

      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-wrap justify-center gap-2">
          {GREETING_PHRASES.map((phrase) => (
            <button
              key={phrase}
              type="button"
              onClick={() => setSentPhrase(phrase)}
              className="rounded-full border border-[var(--ink)]/20 bg-[var(--ink)]/5 px-4 py-2 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/10 active:scale-95"
            >
              {phrase}
            </button>
          ))}
        </div>
        {sentPhrase && (
          <motion.p
            key={sentPhrase}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-sans text-xs font-bold text-[var(--accent)]"
          >
            「{sentPhrase}」と挨拶しました！
          </motion.p>
        )}
      </div>
    </StadiumPageShell>
  );
}
