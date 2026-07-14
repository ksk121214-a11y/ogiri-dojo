"use client";

import Link from "next/link";

import ReportButton from "@/components/app/ReportButton";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import type { SnsAuthorProfile } from "@/data/snsAuthors";

// フォロー中一覧・フォロワー一覧で共通利用する1行分の表示（アイコン＋演者名＋段位＋フォローボタン＋通報ボタン）。
export default function SnsFollowListRow({ author }: { author: SnsAuthorProfile }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 p-3">
      <Link href={`/sns/u/${author.id}`} className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-dojo-washi-white ${author.bgColorClass}`}
        >
          {author.emoji}
        </span>
        <div className="min-w-0">
          <p className="truncate font-sans text-sm font-bold text-dojo-ink hover:underline">
            {author.displayName}
          </p>
          <p className="font-sans text-[10px] text-dojo-dark-brown">{author.rankLabel}</p>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1.5">
        <ReportButton size={18} />
        <SnsFollowButton authorId={author.id} size="compact" />
      </div>
    </div>
  );
}
