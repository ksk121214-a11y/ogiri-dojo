"use client";

import Link from "next/link";

import styles from "./StadiumHome.module.css";

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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
  const color = active ? "var(--accent)" : "var(--text-on-dark)";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect x="4" y="5.5" width="16" height="14" rx="1.5" stroke={color} strokeWidth={active ? 2.2 : 1.8} />
      <path d="M4 9.5h16M8 4v3M16 4v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {/* 日付を表す点。丸カレンダーの中身が空だと「単なる四角」に見えるため追加。 */}
      <circle cx="8" cy="13.3" r="1" fill={color} />
      <circle cx="12" cy="13.3" r="1" fill={color} />
      <circle cx="16" cy="13.3" r="1" fill={color} />
      <circle cx="8" cy="16.8" r="1" fill={color} />
      <circle cx="12" cy="16.8" r="1" fill={color} />
    </svg>
  );
}

function BookIcon({ active }: { active: boolean }) {
  const color = active ? "var(--accent)" : "var(--text-on-dark)";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      {/* 見開きで開いた本のシルエット（中央の背から左右のページが弧を描いて広がる形）。
          以前は縦長の長方形2枚に見え「本」と分かりづらかったため、弧のあるページ形状にした。 */}
      <path
        d="M12 7c-1.8-1.4-4.7-1.9-7.2-1.5v12.7c2.5-.4 5.4.1 7.2 1.5V7Z"
        stroke={color}
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinejoin="round"
      />
      <path
        d="M12 7c1.8-1.4 4.7-1.9 7.2-1.5v12.7c-2.5-.4-5.4.1-7.2 1.5V7Z"
        stroke={color}
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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
    "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]";

  return (
    <nav
      className={`${styles.pressable} ${styles.grainDark} fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-dark)]`}
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
