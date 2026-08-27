"use client";

import Link from "next/link";

import { TicketGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 「参加する」CTA。既存のライブ参加動線（/live への遷移）はそのまま、見た目だけを
// 横幅いっぱいの赤オレンジボタンに変更する。光沢・グラデーションは使わない。
export default function JoinLiveButton() {
  return (
    <Link
      href="/live"
      className={`${styles.pressable} ${styles.grainAccent2} flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-5 font-sans text-xl font-bold text-[var(--paper)] transition hover:bg-[var(--accent-2-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--paper)]`}
    >
      <TicketGlyph />
      参加する
      <span aria-hidden>›</span>
    </Link>
  );
}
