"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { playBgm } from "@/lib/bgm";

// ライブ体験（/live・/live-demo）を除く全画面（ホーム・次回ライブ・遊び方・マイページ・
// 寄合帳・ランキング・ガチャ・楽屋など）共通のBGM。
// ライブ画面自身は自分でplayBgm("waiting"/"entrance"/"live")を呼んで場面ごとに
// 切り替えるため、ここでは「ライブ画面にいない間はホームBGMを流す」ことだけ担当する。
// ライブ画面へ遷移した瞬間は、ライブ側のuseEffectが即座に別の曲へ上書きし、
// bgm.ts側のクロスフェードで自然に切り替わる（このコンポーネント側で明示的な
// 停止処理は不要）。
export default function AmbientBgmController() {
  const pathname = usePathname();

  useEffect(() => {
    if (isLiveExperiencePath(pathname)) return;
    playBgm("home");
  }, [pathname]);

  return null;
}

// "/live-schedule"は"/live"で始まるが別ページ（ライブ予定一覧）なので、
// 前方一致だけで判定せずセグメント単位で厳密に判定する。
function isLiveExperiencePath(pathname: string): boolean {
  return (
    pathname === "/live" ||
    pathname.startsWith("/live/") ||
    pathname === "/live-demo" ||
    pathname.startsWith("/live-demo/")
  );
}
