"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import NavTile from "@/components/app/NavTile";
import TutorialModal from "@/components/app/TutorialModal";
import { getRankByMeter } from "@/data/collectionData";
import { useUserStore } from "@/store/useUserStore";

// ダミーの次回ライブ開催予定（L0 相当）
const NEXT_LIVE = {
  dateLabel: "2026年7月20日（月）",
  timeLabel: "21:00 開演",
  note: "受付は20:55〜（定刻+5分まで）",
};

// ホーム画面：くじ引き・楽屋・番付表・寄合帳は今後のアプデで追加予定のため、
// 導線をいったん外し「大喜利ライブ」のみをMENUに残している（マイページは上部ナビの/mypageへ移動済み）。
// 2026-08-27：大喜利ライブの導線をロゴより上に、全体のトンマナをよりフラット・現代風に調整。
export default function Home() {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NavTile
            href="/live"
            title="大喜利ライブ"
            description="開演時間になったら道場に集まり、舞台と客席に分かれて競う本編"
            flavorText="決まった時間に道場に集まり、舞台に立って大喜利で腕を競う本編です。開幕演出のあと、自分の組の出番が来たら持ち時間の中でお題への回答を送信します（最大5回まで）。1件送信するごとに、客席が0〜3点で採点する審査サイクルが挟まり、点数が高いと「笑いエフェクト」が舞台に発生します。誰かの回答が表示・審査されている間は送信できませんが、入力は自由にできます。全周が終わると個人1〜3位が表彰され、ポイントと熟練度メーターがもらえます。"
          />
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center gap-3 rounded-3xl bg-white px-6 py-10 text-center shadow-sm"
      >
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown/60">
          ONLINE OGIRI LIVE
        </p>
        <button
          type="button"
          onClick={() => setTutorialOpen(true)}
          className="whitespace-nowrap font-brush text-4xl leading-relaxed text-dojo-ink transition hover:text-dojo-curtain-red sm:text-7xl"
        >
          爆笑スタジアム
        </button>
        <p className="font-sans text-sm text-dojo-ink/80">
          決まった時間に、みんなで集まる大喜利ライブ。
        </p>
        <p className="font-sans text-[11px] text-dojo-dark-brown/60">
          ↑タップで遊び方を見る
        </p>
      </motion.section>

      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <p className="font-sans text-[11px] font-bold tracking-widest text-dojo-curtain-red">
          次回ライブ開催予定
        </p>
        <p className="mt-2 font-brush text-2xl text-dojo-ink sm:text-3xl">
          {NEXT_LIVE.dateLabel} {NEXT_LIVE.timeLabel}
        </p>
        <p className="mt-1 font-sans text-xs text-dojo-dark-brown/70">
          {NEXT_LIVE.note}
        </p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-6">
        <p className="font-sans text-[11px] tracking-widest text-dojo-dark-brown/60">
          ログイン中
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-sans text-lg font-bold text-dojo-ink">
              {user.displayName}
            </p>
            <p className="mt-1 font-sans text-sm font-bold text-dojo-ink/80">
              段位：{rank.label}
            </p>
          </div>
          <div className="text-right">
            <p className="font-sans text-[11px] text-dojo-dark-brown/60">
              ポイント残高
            </p>
            <p className="font-sans text-2xl font-bold tabular-nums text-dojo-ink">
              {user.points.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-dojo-dark-brown/60">
                pt
              </span>
            </p>
          </div>
        </div>
      </section>

      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  );
}
