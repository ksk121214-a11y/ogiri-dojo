"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

// ホーム画面の導線タイル（ライブ体験・ガチャ・楽屋・ランキング・SNS）で共通利用。
// タップしてもすぐには遷移せず、まずそのメニューの詳しい説明（世界観＋やり方）を
// ポップアップで見せるチュートリアル的な導線にする。実際に使う場合はポップアップ内の
// 「◯◯へ行く」から遷移する。
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
  flavorText: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex flex-col gap-2 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/60 p-5 text-left transition hover:border-dojo-curtain-gold hover:bg-dojo-light-brown"
      >
        <span className="text-3xl">{emoji}</span>
        <span className="font-sans text-base font-bold text-dojo-ink group-hover:text-dojo-dark-brown">
          {title}
        </span>
        <span className="font-sans text-xs text-dojo-dark-brown">
          {description}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-dojo-curtain-gold/50 bg-dojo-tatami-cream p-6 text-center"
            >
              <span className="text-4xl">{emoji}</span>
              <p className="mt-2 font-brush text-xl text-dojo-ink">{title}</p>
              <p className="mt-3 max-h-72 overflow-y-auto font-sans text-sm leading-relaxed text-dojo-dark-brown">
                {flavorText}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-dojo-dark-brown/30 px-5 py-2 font-sans text-sm font-bold text-dojo-dark-brown transition hover:border-dojo-curtain-gold hover:text-dojo-ink"
                >
                  閉じる
                </button>
                <Link
                  href={href}
                  className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson"
                >
                  {title}へ行く
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
