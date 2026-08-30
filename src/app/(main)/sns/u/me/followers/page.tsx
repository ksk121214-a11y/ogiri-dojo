"use client";

import { useEffect, useState } from "react";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// 自分（マイページ）のフォロワー一覧。
// 2026-08-30（いいね・フォローの実データ化）：以前はダミー投稿者から「あなたをフォロー
// しています」として仮表示していたが、sns_followsテーブルの実データ（following_id=自分
// のuserIdの行のfollower_id一覧）に置き換えた。
// 2026-08-30（デザイン統一）：他の寄合帳サブページ（SnsAuthorFollowers等）と同じ
// StadiumPageShell（地下ライブハウス風トンマナ）に合わせた。
export default function MyFollowersPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const [followerIds, setFollowerIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = userId
      ? supabase.from("sns_follows").select("follower_id").eq("following_id", userId)
      : Promise.resolve({ data: [] as { follower_id: string }[] });
    query.then(({ data }) => {
      if (cancelled) return;
      setFollowerIds((data ?? []).map((r) => (r as { follower_id: string }).follower_id));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton fallbackHref="/sns" />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">FOLLOWERS</p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)]">
          あなたのフォロワー
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followerIds === null ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">読み込み中…</p>
        ) : followerIds.length === 0 ? (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">
            まだ誰にもフォローされていません。
          </p>
        ) : (
          followerIds.map((id) => <SnsFollowListRow key={id} authorId={id} />)
        )}
      </div>
    </StadiumPageShell>
  );
}
