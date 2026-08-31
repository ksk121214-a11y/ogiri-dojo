"use client";

import ComingSoonScreen from "@/components/app/ComingSoonScreen";

// 楽屋（着せ替え）画面。中身はuseUserStoreのローカルダミー経済(所持品・装備)のままのため、
// 初回のライブ実開催に向けて画面だけ「近日公開」にしている（2026-09-01、部署横断会議の結論）。
export default function BackstageRoomPage() {
  return (
    <ComingSoonScreen
      emoji="🛋️"
      title="楽屋"
      description="ガチャ・ショップで手に入れた衣装やアイコンパーツを着せ替えられる機能です。近日、実データに対応してから解禁予定です。"
    />
  );
}
