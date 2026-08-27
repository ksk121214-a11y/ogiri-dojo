import type { ReactNode } from "react";

import StadiumHeader from "@/components/home/StadiumHeader";
import styles from "@/components/home/StadiumHome.module.css";

// ホーム画面全体の外枠。暗いチャコール背景＋紙のノイズ質感（StadiumHome.module.cssの.shell）を持たせ、
// ヘッダーと下部ナビの間に本文（children）をスマホファーストの幅（最大480px）で中央寄せする。
// 下部ナビの高さぶん本文末尾に余白を確保し、本文がナビの裏に隠れないようにする。
export default function StadiumAppShell({
  children,
  bottomNav,
}: {
  children: ReactNode;
  bottomNav: ReactNode;
}) {
  return (
    <div className={`${styles.shell} flex min-h-screen flex-col`}>
      <StadiumHeader />
      <main className={`${styles.content} mx-auto w-full max-w-[480px] flex-1 px-4 pt-5 pb-24 sm:px-5`}>
        <div className="flex flex-col gap-4">{children}</div>
      </main>
      {bottomNav}
    </div>
  );
}
