"use client";

import Link from "next/link";

import styles from "./StadiumHome.module.css";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9h4v-5h4v5h4v-9"
        stroke={active ? "var(--accent)" : "var(--text-on-dark)"}
        strokeWidth={active ? 2.4 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect
        x="4"
        y="5.5"
        width="16"
        height="14"
        rx="1.5"
        stroke={active ? "var(--accent)" : "var(--text-on-dark)"}
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path d="M4 9.5h16M8 4v3M16 4v3" stroke={active ? "var(--accent)" : "var(--text-on-dark)"} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BookIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"
        stroke={active ? "var(--accent)" : "var(--text-on-dark)"}
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
      <path
        d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z"
        stroke={active ? "var(--accent)" : "var(--text-on-dark)"}
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke={active ? "var(--accent)" : "var(--text-on-dark)"} strokeWidth={active ? 2.2 : 1.8} />
      <path
        d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5"
        stroke={active ? "var(--accent)" : "var(--text-on-dark)"}
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

// 下部固定ナビゲーション。ホーム／次回ライブ／遊び方／マイページの4つ。
// 「次回ライブ」はチケットカードへのページ内スクロール、「遊び方」は既存のTutorialModalを開く
// （どちらも新しいルートを増やさず、既存のホーム内動線を再利用する）。
// 選択中(ホーム)は色だけでなくaria-current="page"と線幅の太さでも区別する。
export default function BottomNavigation({ onHowToPlay }: { onHowToPlay: () => void }) {
  const itemClass =
    "flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]";

  return (
    <nav
      className={`${styles.pressable} fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-dark)] bg-[var(--bg)]`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="下部ナビゲーション"
    >
      <div className="mx-auto flex w-full max-w-[480px]">
        <Link href="/" aria-current="page" className={`${itemClass} text-[var(--accent)]`}>
          <HomeIcon active />
          ホーム
        </Link>
        <a
          href="#next-live"
          className={`${itemClass} text-[var(--text-on-dark)]`}
        >
          <CalendarIcon active={false} />
          次回ライブ
        </a>
        <button type="button" onClick={onHowToPlay} className={`${itemClass} text-[var(--text-on-dark)]`}>
          <BookIcon active={false} />
          遊び方
        </button>
        <Link href="/mypage" className={`${itemClass} text-[var(--text-on-dark)]`}>
          <PersonIcon active={false} />
          マイページ
        </Link>
      </div>
    </nav>
  );
}
