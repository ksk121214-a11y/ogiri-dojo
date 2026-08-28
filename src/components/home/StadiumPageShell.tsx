"use client";

import type { ReactNode } from "react";

import BottomNavigation from "@/components/home/BottomNavigation";
import StadiumAppShell from "@/components/home/StadiumAppShell";

// マイページ・寄合帳の各サブページ（お題を出す／お題詳細／回答詳細）・遊び方ページで
// 共通利用する、Stadium系のヘッダー・下部ナビをまとめたラッパー。
// 2026-08-28: 「遊び方」はモーダル（TutorialModal）を開く方式から専用ページ（/how-to-play）へ
// 遷移する方式に変更したため、ここで持っていたtutorialOpenの状態管理は不要になった。
export default function StadiumPageShell({
  children,
  contentTheme = "kraft",
}: {
  children: ReactNode;
  contentTheme?: "dark" | "kraft" | "concrete";
}) {
  return (
    <StadiumAppShell contentTheme={contentTheme} bottomNav={<BottomNavigation />}>
      {children}
    </StadiumAppShell>
  );
}
