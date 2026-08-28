"use client";

import { useState, type ReactNode } from "react";

import TutorialModal from "@/components/app/TutorialModal";
import BottomNavigation from "@/components/home/BottomNavigation";
import StadiumAppShell from "@/components/home/StadiumAppShell";

// マイページ・寄合帳の各サブページ（お題を出す／お題詳細／回答詳細）で共通利用する、
// Stadium系のヘッダー・下部ナビ・遊び方モーダルをまとめたラッパー。
// ホーム自身はヒーロー内に「遊び方を見る」ボタンを持つため、このラッパーは使わず
// page.tsx側で直接StadiumAppShellを使っている（tutorialOpenの持ち方が異なるため）。
export default function StadiumPageShell({
  children,
  contentTheme = "kraft",
}: {
  children: ReactNode;
  contentTheme?: "dark" | "kraft";
}) {
  const [tutorialOpen, setTutorialOpen] = useState(false);

  return (
    <>
      <StadiumAppShell
        contentTheme={contentTheme}
        bottomNav={<BottomNavigation onHowToPlay={() => setTutorialOpen(true)} />}
      >
        {children}
      </StadiumAppShell>
      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </>
  );
}
