"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { playBgm, stopBgm } from "@/lib/bgm";
import { isAdminRoute } from "@/lib/adminRoutes";

// ライブ体験（/live・/live-demo）を除く全画面（ホーム・次回ライブ・遊び方・マイページ・
// 寄合帳・ランキング・ガチャ・楽屋など）共通のBGM。
// ライブ画面自身は自分でplayBgm("waiting"/"entrance"/"live")を呼んで場面ごとに
// 切り替えるため、ここでは「ライブ画面にいない間はホームBGMを流す」ことだけ担当する。
// ライブ画面へ遷移した瞬間は、ライブ側のuseEffectが即座に別の曲へ上書きし、
// bgm.ts側のクロスフェードで自然に切り替わる（このコンポーネント側で明示的な
// 停止処理は不要）。
// 2026-08-30:「運営者専用管理画面(/admin, /live/host)でBGMが鳴っている」不具合対策。
// isLiveExperiencePathの判定に管理画面が含まれておらず、一般ページと同じ扱いで
// ホームBGMが流れてしまっていた。管理画面では一般ユーザー向けの演出を一切出さない
// 方針（フェーズ2の方針）に合わせ、ここでも明示的に対象外にし、鳴っていれば止める。
export default function AmbientBgmController() {
  const pathname = usePathname();

  useEffect(() => {
    if (isAdminRoute(pathname)) {
      stopBgm();
      return;
    }
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
