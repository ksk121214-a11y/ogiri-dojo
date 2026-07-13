"use client";

import Link from "next/link";

// ホーム画面の導線タイル（ライブ体験・ガチャ・ショップ・ランキング・マイページ）で共通利用。
export default function NavTile({
  href,
  emoji,
  title,
  description,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/60 p-5 text-left transition hover:border-dojo-curtain-gold hover:bg-dojo-light-brown"
    >
      <span className="text-3xl">{emoji}</span>
      <span className="font-sans text-base font-bold text-dojo-ink group-hover:text-dojo-dark-brown">
        {title}
      </span>
      <span className="font-sans text-xs text-dojo-dark-brown">
        {description}
      </span>
    </Link>
  );
}
