import type { ReactNode } from "react";

import StadiumHeader from "@/components/home/StadiumHeader";
import styles from "@/components/home/StadiumHome.module.css";

// ホーム画面全体の外枠。暗いチャコール背景＋紙のノイズ質感（StadiumHome.module.cssの.shell）を持たせ、
// ヘッダーと下部ナビの間に本文（children）をスマホファーストの幅（最大480px）で中央寄せする。
// 下部ナビの高さぶん本文末尾に余白を確保し、本文がナビの裏に隠れないようにする。
//
// 2026-08-28: マイページも「ヘッダー・下部ナビはホームと共通、本文の背景だけ茶色いクラフト紙」に
// したいという要望のため、本文の背景面をcontentThemeで切り替えられるようにした
// （ヘッダー・下部ナビ自身はそれぞれ.grainDarkを個別に持っているため、ここでの切り替えの影響を受けない）。
// 2026-08-28（追記）：遊び方ページ用に、明るいコンクリートの背景（"concrete"）を追加。
export default function StadiumAppShell({
  children,
  bottomNav,
  contentTheme = "dark",
}: {
  children: ReactNode;
  bottomNav: ReactNode;
  contentTheme?: "dark" | "kraft" | "concrete";
}) {
  const surfaceClass =
    contentTheme === "kraft"
      ? styles.grainKraft
      : contentTheme === "concrete"
        ? styles.grainConcrete
        : styles.grainDark;
  return (
    <div className={`${styles.shell} ${surfaceClass} flex min-h-screen flex-col`}>
      <StadiumHeader />
      <main className={`${styles.content} mx-auto w-full max-w-[480px] flex-1 px-4 pt-3 pb-20`}>
        <div className="flex flex-col gap-3">{children}</div>
      </main>
      {bottomNav}
    </div>
  );
}
