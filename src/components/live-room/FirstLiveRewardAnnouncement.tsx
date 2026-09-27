"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

// 2026-09-27（レビュー対応）：初回ライブ限定特典の案内文言・表示条件をここに一本化し、
// 「未ログインの参加入口」（src/app/live/page.tsx）と「Xログイン済みの参加受付画面
// （OpeningView）」の両方から同じ文言・同じ条件で呼べるようにする（重複実装を避ける）。
// 表示名(titles.display_name)は運営が管理画面(/admin/titles)から後から変更できるため、
// ここでハードコードせず毎回取得する。取得に失敗した場合は一般的な文言へフォールバックする。
const FALLBACK_TITLE_NAME = "初回ライブ限定称号";

function useFirstWitnessTitleName(shouldFetch: boolean): string {
  const [name, setName] = useState<string>(FALLBACK_TITLE_NAME);
  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    supabase
      .from("titles")
      .select("display_name")
      .eq("slug", "first-witness")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.display_name) setName(data.display_name);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);
  return name;
}

export function isFirstLiveRewardAnnounceable(
  liveMode: string | null | undefined,
  officialSequenceNumber: number | null | undefined,
  emergencyClosed: boolean | null | undefined,
): boolean {
  return liveMode === "official" && officialSequenceNumber === 1 && !emergencyClosed;
}

export default function FirstLiveRewardAnnouncement({
  liveMode,
  officialSequenceNumber,
  emergencyClosed = false,
  className,
}: {
  liveMode: string | null | undefined;
  officialSequenceNumber: number | null | undefined;
  emergencyClosed?: boolean | null;
  className?: string;
}) {
  const announceable = isFirstLiveRewardAnnounceable(liveMode, officialSequenceNumber, emergencyClosed);
  const titleName = useFirstWitnessTitleName(announceable);

  if (!announceable) return null;

  return (
    <p className={className}>
      最終結果まで参加したXログイン会員に、限定称号「{titleName}」と限定アイコンをプレゼントします。ゲスト参加は対象外です。
    </p>
  );
}
