"use client";

import Link from "next/link";

import SnsBackButton from "@/components/sns/SnsBackButton";
import { DUMMY_SNS_AUTHORS } from "@/data/snsAuthors";

// 「楽屋挨拶に行く」の一覧ページ：道場の演者一覧をアイコン付きで並べ、
// それぞれの「楽屋挨拶に行く」から他の演者の楽屋（見学専用）へ移動できる。
export default function BackstageGreetingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <SnsBackButton fallbackHref="/backstage-room" />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          GREETINGS
        </p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
          楽屋挨拶
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          道場の演者一覧です。気になる楽屋に挨拶に行ってみましょう。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {DUMMY_SNS_AUTHORS.map((author) => (
          <div
            key={author.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-dojo-washi-white ${author.bgColorClass}`}
              >
                {author.emoji}
              </span>
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-bold text-dojo-ink">
                  {author.displayName}
                </p>
                <p className="font-sans text-[10px] text-dojo-dark-brown">
                  {author.rankLabel}
                </p>
              </div>
            </div>
            <Link
              href={`/sns/u/${author.id}/backstage`}
              className="flex shrink-0 items-center gap-1 rounded-full bg-dojo-curtain-red px-3 py-1.5 font-sans text-xs font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
            >
              楽屋挨拶に行く →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
