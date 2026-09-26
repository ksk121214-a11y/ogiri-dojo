"use client";

import { useEffect, useState } from "react";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorLookupState from "@/components/sns/SnsAuthorLookupState";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { supabase } from "@/lib/supabase";
import { useAuthorLookup } from "@/lib/useAuthorLookup";
import { isUuid } from "@/lib/uuid";

// 対象authorId（ダミー投稿者 or 実ユーザーのUUID）のフォロー中一覧。
// 2026-08-30（いいね・フォローの実データ化）：それまでの「他のダミー投稿者から雰囲気で
// ランダム抽出する」簡易実装を廃止し、sns_followsテーブルの実データ（follower_id=authorId
// の行のfollowing_id一覧）を表示するようにした。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
export default function SnsAuthorFollowing({ authorId }: { authorId: string }) {
  const lookup = useAuthorLookup(authorId);
  const { dummyAuthor, realAuthor } = lookup;
  const [followingIds, setFollowingIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isUuid(authorId)) return;
    let cancelled = false;
    supabase
      .from("sns_follows")
      .select("following_id")
      .eq("follower_id", authorId)
      .then(({ data }) => {
        if (cancelled) return;
        setFollowingIds((data ?? []).map((r) => (r as { following_id: string }).following_id));
      });
    return () => {
      cancelled = true;
    };
  }, [authorId]);

  const displayName = dummyAuthor?.displayName ?? realAuthor?.displayName;

  if (lookup.status !== "found") {
    return <SnsAuthorLookupState status={lookup.status} onRetry={lookup.retry} />;
  }

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton fallbackHref={`/sns/u/${authorId}`} />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent-on-light)]">FOLLOWING</p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)]">
          {displayName ?? "演者"} のフォロー中
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followingIds === null ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">読み込み中…</p>
        ) : followingIds.length === 0 ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">
            まだ誰もフォローしていません。
          </p>
        ) : (
          followingIds.map((id) => <SnsFollowListRow key={id} authorId={id} />)
        )}
      </div>
    </StadiumPageShell>
  );
}
