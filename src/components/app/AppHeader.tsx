"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { getRankByMeter } from "@/data/collectionData";
import { useUserStore } from "@/store/useUserStore";

const NAV_LINKS = [
  { href: "/", label: "ホーム" },
  { href: "/live-demo", label: "ライブ体験" },
  { href: "/gacha", label: "ガチャ" },
  { href: "/backstage-room", label: "楽屋" },
  { href: "/ranking", label: "ランキング" },
  { href: "/sns", label: "寄合帳" },
] as const;

// ホーム/ガチャ/楽屋/ランキング/SNSで共通利用する簡易ナビゲーション。
// 第6ラウンドフィードバックでショップ→ガチャ、過去のライブ→ランキング、マイページ→ホームに
// それぞれページ内タブ/セクションとして統合し、ナビ項目を8→5に整理した。
// その後、姉妹プロジェクト「大喜利SNS」の簡易版（お題投稿・回答投稿・いいね）をSNSとして追加し5→6に。
// ライブ体験画面（/live-demo）はフルスクリーンの舞台演出のため、このヘッダーは出さない。
export default function AppHeader() {
  const pathname = usePathname();
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);

  return (
    <header className="sticky top-0 z-40 border-b border-dojo-dark-brown/20 bg-dojo-tatami-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-brush text-lg text-dojo-dark-brown sm:text-xl"
          >
            大喜利道場
          </Link>
          <div className="flex items-center gap-2 rounded-full border border-dojo-dark-brown/30 bg-dojo-light-brown px-3 py-1.5 text-right">
            <span className="font-sans text-[10px] text-dojo-dark-brown sm:text-xs">
              {rank.label}・{user.displayName}
            </span>
            <span className="font-sans text-xs font-bold tabular-nums text-dojo-ink sm:text-sm">
              {user.points.toLocaleString()}pt
            </span>
          </div>
        </div>
        {/*
          スマホ幅では8項目が折り返して崩れないよう、折り返し（flex-wrap）ではなく
          横スクロール（overflow-x-auto + whitespace-nowrap）に統一する（第5ラウンドフィードバック）。
        */}
        <nav className="-mx-1 flex gap-1 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV_LINKS.map((link) => {
            // ホームは完全一致のみ、それ以外はサブページ（例: /sns/u/me）にいる間も
            // 該当タブが濃く表示され続けるようprefix一致で判定する（見た目で現在地が分かりやすいように）。
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`shrink-0 rounded-full px-2.5 py-1.5 font-sans text-[11px] font-bold transition sm:px-3 sm:text-sm ${
                  active
                    ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_10px_rgba(192,38,63,0.45)]"
                    : "text-dojo-dark-brown hover:bg-dojo-light-brown hover:text-dojo-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
