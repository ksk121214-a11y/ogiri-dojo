"use client";

import ComingSoonScreen from "@/components/app/ComingSoonScreen";

// 番付表（総合ランキング）・過去のライブ（アーカイブ）画面。中身はDUMMY_RANKING/ARCHIVE_LIVES
// （src/data/rankingData.ts・archiveData.ts）のダミーデータのままのため、初回のライブ実開催に
// 向けて画面だけ「近日公開」にしている（2026-09-01、部署横断会議の結論）。
// マイページの段位・実績は本物のデータで別途表示済みなので、この画面を隠しても
// 「自分の段位が見えない」ことにはならない。
export default function RankingPage() {
  return (
    <ComingSoonScreen
      emoji="🏆"
      title="番付表・過去のライブ"
      description="道場に集う演者たちの番付や、過去のライブの振り返りができる機能です。近日、実データに対応してから解禁予定です。"
    />
  );
}
