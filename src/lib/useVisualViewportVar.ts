"use client";

import { useEffect } from "react";

// iOS Safari等でソフトウェアキーボードが開くと、レイアウトビューポート基準の
// 100dvh（h-dvh）はキーボードの高さぶんに追従しないことがあり、「回答入力欄が
// キーボードの下に隠れる」「キーボードを閉じても画面が元の高さ・位置に戻らない」
// 不具合の原因になる。
// window.visualViewportのresize/scrollイベントを監視し、実際に見えている高さを
// documentElementのCSS変数に反映する。呼び出し側はh-dvhの代わりに
// h-[var(--live-vvh,100dvh)]のようにこの変数を使うことで、対応ブラウザでは
// キーボードの開閉に追従し、visualViewport未対応ブラウザ・SSR時は100dvh相当に
// フォールバックする。
export function useVisualViewportVar(varName = "--live-vvh") {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const update = () => {
      root.style.setProperty(varName, `${vv.height}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty(varName);
    };
  }, [varName]);
}
