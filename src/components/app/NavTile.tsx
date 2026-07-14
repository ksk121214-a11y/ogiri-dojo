"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

// ホーム画面の導線タイル（ライブ体験・ガチャ・ショップ・ランキング・マイページ）で共通利用。
// タイトル部分だけは押しても遷移せず、そのメニューが道場の世界観でどういう位置づけかを
// 説明するポップアップを開く（それ以外の余白・絵文字・説明文をタップすると通常通り遷移する）。
export default function NavTile({
  href,
  emoji,
  title,
  description,
  flavorText,
}: {
  href: string;
  emoji: string;
  title: string;
  description: string;
  flavorText?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="group relative flex flex-col gap-2 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/60 p-5 text-left transition hover:border-dojo-curtain-gold hover:bg-dojo-light-brown">
      <Link href={href} aria-label={`${title}へ移動`} className="absolute inset-0" />
      <span className="text-3xl">{emoji}</span>
      {flavorText ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className="relative z-10 w-fit text-left font-sans text-base font-bold text-dojo-ink underline decoration-dotted underline-offset-4 group-hover:text-dojo-dark-brown"
        >
          {title}
        </button>
      ) : (
        <span className="font-sans text-base font-bold text-dojo-ink group-hover:text-dojo-dark-brown">
          {title}
        </span>
      )}
      <span className="font-sans text-xs text-dojo-dark-brown">
        {description}
      </span>

      {flavorText && (
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
              }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl border border-dojo-curtain-gold/50 bg-dojo-tatami-cream p-6 text-center"
              >
                <span className="text-4xl">{emoji}</span>
                <p className="mt-2 font-brush text-xl text-dojo-ink">{title}</p>
                <p className="mt-3 font-sans text-sm leading-relaxed text-dojo-dark-brown">
                  {flavorText}
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-5 rounded-full bg-dojo-curtain-red px-6 py-2 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
                >
                  閉じる
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
