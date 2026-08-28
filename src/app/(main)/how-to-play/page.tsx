"use client";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";

// 遊び方ページ。従来はモーダル（TutorialModal）で表示していたが、下部ナビ・ヒーローの
// 「遊び方を見る」から専用ページへ遷移する形に変更した。中身は今後追加予定のため、
// 現時点ではプレースホルダーのみ。
export default function HowToPlayPage() {
  return (
    <StadiumPageShell contentTheme="kraft">
      <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-2 rounded-2xl p-8 text-center text-[var(--ink)]`}>
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">
          HOW TO PLAY
        </p>
        <h1 className="font-sans text-2xl font-black text-[var(--ink)]">遊び方</h1>
        <p className="mt-2 font-sans text-sm text-[var(--ink)]/70">準備中です。もうしばらくお待ちください。</p>
      </div>
    </StadiumPageShell>
  );
}
