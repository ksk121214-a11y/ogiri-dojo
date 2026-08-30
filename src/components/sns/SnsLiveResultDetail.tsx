"use client";

import { useEffect, useState } from "react";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsLiveResultBody from "@/components/sns/SnsLiveResultBody";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";

// 寄合帳「ライブ結果」詳細ページ。1〜3位代表・運営ベスト・満点回答を、
// 実際のSNS公開順（SnsLiveResultBody）で表示する。新しい回答を投稿する機能は無く、
// ユーザーができる操作はいいね・コメント・プレイヤーのプロフィール閲覧のみ。
export default function SnsLiveResultDetail({ liveResultId }: { liveResultId: string }) {
  const detail = useSnsLiveResultsStore((s) => s.details[liveResultId]);
  const fetchDetail = useSnsLiveResultsStore((s) => s.fetchDetail);
  // 取得を試みて完了したか（true になるまでは「読み込み中」、完了してもdetailが
  // 無ければ「見つかりませんでした」を出す。SnsAnswerDetail.tsx等と同じパターン）。
  const [loadAttempted, setLoadAttempted] = useState(false);

  useEffect(() => {
    if (detail) return;
    let cancelled = false;
    fetchDetail(liveResultId).finally(() => {
      if (!cancelled) setLoadAttempted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [detail, liveResultId, fetchDetail]);

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton
        fallbackHref="/sns"
        className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
      />
      {!detail ? (
        <p className="py-16 text-center font-sans text-sm text-[var(--ink)]/70">
          {loadAttempted ? "ライブ結果が見つかりませんでした。" : "読み込み中…"}
        </p>
      ) : (
        <SnsLiveResultBody detail={detail} />
      )}
    </StadiumPageShell>
  );
}
