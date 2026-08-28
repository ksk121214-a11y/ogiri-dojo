"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { playSfx } from "@/lib/sfx";
import { isStadiumRoute } from "@/lib/stadiumRoutes";

// Stadium系画面（ホーム・次回ライブ・遊び方・マイページ・寄合帳）内のボタン／リンク
// クリックに、効果音を自動で振り分ける。個々のボタンに毎回onClickでplaySfxを仕込むと
// 数が多く・仕込み漏れも起きやすいため、documentレベルのクリック委譲で一括対応している。
// - data-sfx="home" を付けた要素（下部ナビ4項目・ヘッダーロゴ・「遊び方を見る」）→ homeClick
// - それ以外の<button>・href付き<a>（Linkが描画するもの含む）→ pageTurn（既定音）
// - モーダル（段位・実績／プロフィール編集／ポイント履歴）はDOM上.shellの外にいるが、
//   document全体を監視しているため問題なく対象に含まれる。
// - disabledなボタンはブラウザ側でそもそもclickイベントが発火しないため自然に無音、
//   「結果を見る」「詳細を見る」のような<span>のプレースホルダーもbutton/aでないため無音。
export default function StadiumSfxController() {
  const pathname = usePathname();
  const isStadium = isStadiumRoute(pathname);

  useEffect(() => {
    if (!isStadium) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const control = target?.closest<HTMLElement>("button, a[href]");
      if (!control) return;
      if (control.getAttribute("data-sfx") === "home") {
        playSfx("homeClick");
      } else {
        playSfx("pageTurn");
      }
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isStadium]);

  return null;
}
