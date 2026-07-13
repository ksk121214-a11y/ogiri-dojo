"use client";

import { AnimatePresence, motion } from "framer-motion";

// ホームの「大喜利道場」タイトルを押すと出るチュートリアル/説明モーダル。
// 仕様書.md §0・§1の要点を、初めて触る人向けに噛み砕いて紹介する。
const STEPS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: "🎤",
    title: "決まった時間に開かれるライブ",
    body: "1日1〜2回、告知された時間になると部屋が開きます。参加者は5人ずつの組に分かれ、組ごとに舞台に立って大喜利のお題に回答します。",
  },
  {
    emoji: "📝",
    title: "舞台では持ち時間内に何度でも回答",
    body: "自分の組の番が来たら、持ち時間の間にお題への回答を送信します。送信するたびに、客席が0〜3点で採点する審査サイクルが挟まります。",
  },
  {
    emoji: "🙌",
    title: "舞台に立っていない間は客席で採点",
    body: "自分の組の番でないときは客席として他の演者の回答を採点します。ツッコミや拍手も送れます。",
  },
  {
    emoji: "🏆",
    title: "全組終わったら表彰、ポイントと段位",
    body: "全組が舞台に立ち終えると個人の1〜3位が表彰され、順位に応じたボーナスポイントがもらえます。獲得スコアや表彰実績は熟練度メーターに蓄積され、段位が上がっていきます。",
  },
  {
    emoji: "🎰",
    title: "ポイントで衣装・パーツ・背景柄を収集",
    body: "貯まったポイントは「ガチャ」で衣装・アイコンパーツ・背景柄と交換できます。「楽屋」でその場で着せ替え・模様替えができ、「寄合帳」では道場の仲間とお題・回答を投稿し合えます。",
  },
];

export default function TutorialModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-dojo-stage-dark/70 px-4 py-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl border border-dojo-curtain-gold/50 bg-dojo-tatami-cream p-6 sm:p-8"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
                  遊び方
                </p>
                <h2 className="mt-1 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
                  大喜利道場とは
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="閉じる"
                className="shrink-0 rounded-full bg-dojo-light-brown px-3 py-1.5 font-sans text-sm font-bold text-dojo-dark-brown transition hover:bg-dojo-curtain-gold/40"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {STEPS.map((step) => (
                <div
                  key={step.title}
                  className="flex items-start gap-3 rounded-2xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 p-4"
                >
                  <span className="text-2xl">{step.emoji}</span>
                  <div>
                    <p className="font-sans text-sm font-bold text-dojo-ink">
                      {step.title}
                    </p>
                    <p className="mt-1 font-sans text-xs leading-relaxed text-dojo-dark-brown">
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-2 self-center rounded-full bg-dojo-curtain-red px-8 py-3 font-sans text-sm font-bold text-dojo-washi-white shadow-[0_0_20px_rgba(192,38,63,0.35)] transition hover:bg-dojo-deep-crimson active:scale-95"
            >
              分かった、始めよう
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
