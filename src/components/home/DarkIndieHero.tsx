"use client";

import { PlayGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 地下ライブハウスのステージをイメージしたヒーロー。実写素材が無いため、写真を貼る代わりに
// マイクスタンドのシルエットをSVGで直接描き、白黒ハーフトーン風のドット柄（CSSモジュール側の
// .halftone）を右側に重ねている。マイク側に視線が集まるよう左側にタイトル用の余白を確保。
export default function DarkIndieHero({ onHowToPlay }: { onHowToPlay: () => void }) {
  return (
    <section className={`${styles.heroPanel} relative rounded-2xl px-5 py-4 sm:px-6 sm:py-6`}>
      <div className={styles.halftone} aria-hidden />
      <div className={styles.heroOverlay} aria-hidden />
      <div
        role="img"
        aria-label="スポットライトに照らされたマイクスタンドのイラスト"
        className="pointer-events-none absolute inset-y-0 right-0 z-0 flex w-[40%] items-end justify-center opacity-95 sm:w-[36%]"
      >
        <svg viewBox="0 0 100 170" className="h-full w-full" fill="none" aria-hidden>
          <line x1="50" y1="160" x2="50" y2="46" stroke="var(--muted-on-dark)" strokeWidth="4" />
          <line x1="22" y1="160" x2="78" y2="160" stroke="var(--muted-on-dark)" strokeWidth="5" strokeLinecap="round" />
          <line x1="50" y1="46" x2="72" y2="26" stroke="var(--muted-on-dark)" strokeWidth="4" />
          <g fill="var(--paper)">
            <ellipse cx="76" cy="20" rx="21" ry="26" transform="rotate(28 76 20)" />
          </g>
          <g stroke="var(--bg-raised)" strokeWidth="1.8" opacity="0.75">
            <line x1="64" y1="2" x2="88" y2="38" transform="rotate(28 76 20)" />
            <line x1="70" y1="-4" x2="94" y2="32" transform="rotate(28 76 20)" />
            <line x1="58" y1="8" x2="82" y2="44" transform="rotate(28 76 20)" />
            <line x1="52" y1="14" x2="76" y2="50" transform="rotate(28 76 20)" />
            <line x1="46" y1="20" x2="70" y2="56" transform="rotate(28 76 20)" />
          </g>
        </svg>
      </div>

      <div className="relative z-10 flex flex-col items-start gap-2">
        <span className="rounded-sm bg-[var(--accent)] px-2 py-0.5 text-xs font-bold tracking-widest text-[var(--paper)]">
          ONLINE OGIRI LIVE
        </span>
        {/*
          タイトルだけは他要素と違い、幅を絞ると「スタジアム」が「スタジア／ム」のように
          単語の途中で折り返ってしまうため、max-widthを掛けずwhitespace-nowrapで
          1行ずつ（爆笑／スタジアム）を強制する。パネルはoverflow:hiddenなので、
          仮にマイク側と少し重なっても画面外にはみ出すことはない。
        */}
        <h1 className="whitespace-nowrap font-sans text-[2.4rem] leading-[0.95] font-black tracking-tight text-[var(--text-on-dark)] sm:text-6xl">
          爆笑
          <br />
          スタジアム
        </h1>
        <div className="flex max-w-[62%] flex-col items-start gap-2 sm:max-w-[58%]">
          <p className="text-xl font-bold text-[var(--accent)] sm:text-2xl">— 大喜利ライブ —</p>
          <p className="text-sm leading-snug text-[var(--text-on-dark)]">
            決まった時間に、みんなで集まる大喜利ライブ。
          </p>
          <button
            type="button"
            onClick={onHowToPlay}
            className={`${styles.pressable} mt-1 flex items-center gap-1.5 rounded-md border border-[var(--text-on-dark)]/70 px-4 py-2 text-sm font-bold text-[var(--text-on-dark)] transition hover:bg-[var(--text-on-dark)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
          >
            <PlayGlyph />
            遊び方を見る
          </button>
        </div>
      </div>
    </section>
  );
}
