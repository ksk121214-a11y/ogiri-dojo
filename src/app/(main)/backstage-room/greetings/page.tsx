"use client";

import ComingSoonScreen from "@/components/app/ComingSoonScreen";

// 楽屋挨拶一覧（ダミー投稿者の楽屋を見学する導線）。親の楽屋（backstage-room）と合わせて
// 初回のライブ実開催に向けて「近日公開」にしている（2026-09-01、部署横断会議の結論）。
export default function BackstageGreetingsPage() {
  return (
    <ComingSoonScreen
      emoji="🙇"
      title="楽屋挨拶"
      description="演者たちの楽屋に挨拶に行ける機能です。近日、実データに対応してから解禁予定です。"
    />
  );
}
