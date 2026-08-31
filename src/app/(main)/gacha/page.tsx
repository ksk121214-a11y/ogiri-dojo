"use client";

import ComingSoonScreen from "@/components/app/ComingSoonScreen";

// ガチャ・衣装蔵（ショップ）画面。中身（GachaTab/ShopTab、ローカルのダミー経済）は
// src/store/useUserStore.ts・src/data/collectionData.ts等に残したまま、初回のライブ実開催に
// 向けて画面だけ「近日公開」にしている（2026-09-01、部署横断会議の結論。詳しくは
// ComingSoonScreen.tsxのコメント参照）。
export default function GachaPage() {
  return (
    <ComingSoonScreen
      emoji="🎰"
      title="ガチャ・衣装蔵"
      description="ライブで貯めたポイントの使い道になる機能です。近日、実データに対応してから解禁予定です。"
    />
  );
}
