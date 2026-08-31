"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import PointHistoryModal from "@/components/app/PointHistoryModal";
import { getRankByMeter } from "@/data/collectionData";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

const NAV_LINKS = [
  { href: "/", label: "ホーム" },
  { href: "/mypage", label: "マイページ" },
] as const;

// ホーム/マイページで共通利用する簡易ナビゲーション。
// 2026-08-27：くじ引き・楽屋・番付表は今後のアプデで追加予定のため導線をいったん撤去、
// 寄合帳（SNS）はマイページ（/mypage）に統合し、大喜利ライブはホームのMENUタイルへ移動した。
// ライブ画面（/live、旧ダミー版/live-demo）はフルスクリーンの舞台演出のため、このヘッダーは出さない。
export default function AppHeader() {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  // 2026-08-31: 段位はライブ終了時に加算される実データ（profiles.mastery_meter）を優先する。
  const rank = getRankByMeter(profile?.masteryMeter ?? user.masteryMeter);
  const displayName = profile?.displayName ?? user.displayName;
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const signOut = useAuthStore((s) => s.signOut);
  const xScreenName =
    (authUser?.user_metadata?.user_name as string | undefined) ??
    (authUser?.user_metadata?.full_name as string | undefined);

  return (
    <header className="sticky top-0 z-40 border-b border-dojo-dark-brown/20 bg-dojo-tatami-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="shrink-0 whitespace-nowrap font-brush text-base text-dojo-dark-brown sm:text-xl"
          >
            爆笑スタジアム
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="flex min-w-0 shrink items-center gap-1.5 rounded-2xl bg-dojo-light-brown px-2.5 py-1.5 text-right transition hover:bg-dojo-curtain-gold/30 sm:gap-2 sm:px-3"
            >
              <span className="min-w-[4ch] truncate font-sans text-[10px] text-dojo-dark-brown sm:text-xs">
                <span className="hidden sm:inline">{rank.label}・</span>
                {displayName}
              </span>
              <span className="shrink-0 font-sans text-xs font-bold tabular-nums text-dojo-ink sm:text-sm">
                {(profile?.pointsBalance ?? user.points).toLocaleString()}pt
              </span>
            </button>
            {!authLoading && (
              authUser ? (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="shrink-0 rounded-full border border-dojo-dark-brown/30 px-2.5 py-1.5 font-sans text-[10px] font-bold text-dojo-dark-brown hover:bg-dojo-light-brown sm:text-xs"
                  title={xScreenName ? `@${xScreenName}` : undefined}
                >
                  ログアウト
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => signInWithX()}
                  className="shrink-0 rounded-full bg-dojo-ink px-2.5 py-1.5 font-sans text-[10px] font-bold text-dojo-washi-white hover:opacity-90 sm:text-xs"
                >
                  Xでログイン
                </button>
              )
            )}
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
      {historyOpen && <PointHistoryModal onClose={() => setHistoryOpen(false)} />}
    </header>
  );
}
