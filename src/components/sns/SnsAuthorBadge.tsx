"use client";

import Link from "next/link";

import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import { getCollectionItem, getRankByMeter } from "@/data/collectionData";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import { ITEM_TYPE_EMOJI } from "@/lib/economyUi";
import { useUserStore } from "@/store/useUserStore";

// 寄合帳（お題一覧・お題詳細・回答カード）で共通利用する「アイコン(丸)＋演者名＋段位」の投稿者表示。
// authorId === "me" の場合はマイページ（useUserStore）と同じ情報源（演者名・段位・装備中アイコン）を
// そのまま反映し、それ以外は snsAuthors.ts のダミー投稿者プロフィールを参照する。
// 自分（"me"）は寄合帳トップ（/sns、プロフィールカードを直接埋め込み済み）へ、
// それ以外は個別プロフィールページ（/sns/u/[authorId]）へのリンクになる。
// 呼び出し側でカード全体をLinkにしている場合があるため、アンカーのネストを避けるよう呼び出し元は
// SnsAuthorBadgeを外側のLinkでは包まないこと（stopPropagationのみでは<a>のネストは解消できないため）。
export default function SnsAuthorBadge({
  authorId,
  size = 32,
}: {
  authorId: string;
  size?: number;
}) {
  const user = useUserStore((s) => s.user);

  if (authorId === "me") {
    const rank = getRankByMeter(user.masteryMeter);
    const iconItem = user.inventory.equipped.iconPartId
      ? getCollectionItem(user.inventory.equipped.iconPartId)
      : undefined;

    return (
      <Link
        href="/sns"
        onClick={(e) => e.stopPropagation()}
        className="flex min-w-0 items-center gap-2"
      >
        <span
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-dojo-curtain-gold/60 bg-dojo-tatami-cream"
          style={{ width: size, height: size }}
        >
          {iconItem ? (
            <span style={{ fontSize: size * 0.55 }}>
              {ITEM_TYPE_EMOJI[iconItem.type]}
            </span>
          ) : (
            <AvatarPlaceholder size={size} />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-sans text-xs font-bold text-dojo-ink hover:underline">
            {user.displayName}
          </span>
          <span className="font-sans text-[10px] text-dojo-dark-brown">
            {rank.label}
          </span>
        </span>
      </Link>
    );
  }

  const author = getDummySnsAuthor(authorId);

  return (
    <Link
      href={`/sns/u/${authorId}`}
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-0 items-center gap-2"
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full text-dojo-washi-white ${author?.bgColorClass ?? "bg-dojo-dark-brown"}`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {author?.emoji ?? "🎭"}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-xs font-bold text-dojo-ink hover:underline">
          {author?.displayName ?? "名無しの演者"}
        </span>
        <span className="font-sans text-[10px] text-dojo-dark-brown">
          {author?.rankLabel ?? "見習い"}
        </span>
      </span>
    </Link>
  );
}
