"use client";

import Image from "next/image";

import { BASE_PATH } from "@/lib/basePath";

import { PlayGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// 地下ライブハウスのステージをイメージしたヒーロー。マイクは提供素材
// （sanpachi-c38b-halftone-transparent.png、ハーフトーン調のヴィンテージマイク）を使用し、
// 白黒ハーフトーン風のドット柄（CSSモジュール側の.halftone）を背景に重ねている。
// マイク側に視線が集まるよう左側にタイトル用の余白を確保。
export default function DarkIndieHero({ onHowToPlay }: { onHowToPlay: () => void }) {
  return (
    <section className={`${styles.heroPanel} ${styles.grainDark} relative px-5 py-4`}>
      <div className={styles.halftone} aria-hidden />
      <div className={styles.heroOverlay} aria-hidden />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-[40%]">
        <Image
          src={`${BASE_PATH}/images/mic-halftone.webp`}
          alt="ハーフトーン調のヴィンテージマイクのイラスト"
          fill
          sizes="200px"
          className="object-contain object-bottom opacity-95"
        />
      </div>

      <div className="relative z-10 flex flex-col items-start gap-2">
        <span className={`${styles.grainAccent} rounded-sm px-2 py-0.5 text-sm font-bold tracking-widest text-[var(--paper)]`}>
          ONLINE OGIRI LIVE
        </span>
        {/*
          タイトルだけは他要素と違い、幅を絞ると「スタジアム」が「スタジア／ム」のように
          単語の途中で折り返ってしまうため、max-widthを掛けずwhitespace-nowrapで
          1行ずつ（爆笑／スタジアム）を強制する。パネルはoverflow:hiddenなので、
          仮にマイク側と少し重なっても画面外にはみ出すことはない。
          styles.titleTextureで文字の塗りをtitle-ivory-ink-texture-512.pngにしている
          （background-clip:textのため、ここでは通常のcolorユーティリティは付けない）。
        */}
        <h1 className={`${styles.titleTexture} whitespace-nowrap font-sans text-[2.7rem] leading-[0.95] font-black tracking-tight`}>
          爆笑
          <br />
          スタジアム
        </h1>
        <div className="flex max-w-[62%] flex-col items-start gap-2">
          <p className="whitespace-nowrap text-2xl font-bold text-[var(--accent)]">— 大喜利ライブ —</p>
          <p className="text-base leading-snug text-[var(--text-on-dark)]">
            決まった時間に、みんなで集まる大喜利ライブ。
          </p>
          <button
            type="button"
            onClick={onHowToPlay}
            className={`${styles.pressable} mt-1 flex items-center gap-1.5 rounded-md border border-[var(--text-on-dark)]/70 px-4 py-2 text-base font-bold text-[var(--text-on-dark)] transition hover:bg-[var(--text-on-dark)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
          >
            <PlayGlyph />
            遊び方を見る
          </button>
        </div>
      </div>
    </section>
  );
}
