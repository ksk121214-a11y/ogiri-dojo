"use client";

import { useEffect, useState } from "react";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorLookupState from "@/components/sns/SnsAuthorLookupState";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { supabase } from "@/lib/supabase";
import { useAuthorLookup } from "@/lib/useAuthorLookup";
import { isUuid } from "@/lib/uuid";

// 対象authorId（ダミー投稿者 or 実ユーザーのUUID）のフォロワー一覧。
// 2026-08-30（いいね・フォローの実データ化）：それまでの「他のダミー投稿者から雰囲気で
// ランダム抽出する」簡易実装を廃止し、sns_followsテーブルの実データ（following_id=authorId
// の行のfollower_id一覧）を表示するようにした。ダミー投稿者には実際のフォロー関係が
// 存在しない（本番ではダミー自体を表示しない）ため、開発環境でダミーのこのページを
// 開いた場合は基本的に0件になる。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
export default function SnsAuthorFollowers({ authorId }: { authorId: string }) {
  const lookup = useAuthorLookup(authorId);
  const { dummyAuthor, realAuthor } = lookup;
  const [followerIds, setFollowerIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isUuid(authorId)) return;
    let cancelled = false;
    supabase
      .from("sns_follows")
      .select("follower_id")
      .eq("following_id", authorId)
      .then(({ data }) => {
        if (cancelled) return;
        setFollowerIds((data ?? []).map((r) => (r as { follower_id: string }).follower_id));
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
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent-on-light)]">FOLLOWERS</p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)]">
          {displayName ?? "演者"} のフォロワー
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followerIds === null ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">読み込み中…</p>
        ) : followerIds.length === 0 ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">
            まだ誰もフォローしていません。
          </p>
        ) : (
          followerIds.map((id) => <SnsFollowListRow key={id} authorId={id} />)
        )}
      </div>
    </StadiumPageShell>
  );
}
