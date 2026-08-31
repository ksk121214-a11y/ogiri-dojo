"use client";

import Link from "next/link";

// ガチャ・衣装蔵・楽屋・番付表など、まだサーバー側の実データと繋がっていない
// （ローカルのダミー経済のみで動いている）画面の「近日公開」プレースホルダー。
// 2026-09-01：初回のライブ実開催に向けて、実データで動くライブ本体・寄合帳・マイページの
// 段位/ポイントだけを見せ、ダミーのままの経済機能（ガチャ/ショップ/楽屋/ランキング）は
// 一旦非表示にする方針になった（部署横断会議の結論）。実装自体は削除せず、各page.tsxの
// 描画をこのコンポーネントに差し替えるだけにとどめている（配信解禁時にすぐ戻せるように）。
export default function ComingSoonScreen({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <span className="text-6xl" aria-hidden>
        {emoji}
      </span>
      <div>
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          COMING SOON
        </p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          {title}
        </h1>
      </div>
      <p className="max-w-sm font-sans text-sm text-dojo-dark-brown">
        {description}
      </p>
      <Link
        href="/"
        className="rounded-full bg-dojo-curtain-red px-6 py-2.5 font-sans text-sm font-bold text-dojo-washi-white shadow-[0_0_20px_rgba(192,38,63,0.35)] transition hover:bg-dojo-deep-crimson"
      >
        ホームに戻る
      </Link>
    </div>
  );
}
