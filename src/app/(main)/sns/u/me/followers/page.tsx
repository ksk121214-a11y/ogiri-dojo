"use client";

import { useEffect, useState } from "react";

import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// 自分（マイページ）のフォロワー一覧。
// 2026-08-30（いいね・フォローの実データ化）：以前はダミー投稿者から「あなたをフォロー
// しています」として仮表示していたが、sns_followsテーブルの実データ（following_id=自分
// のuserIdの行のfollower_id一覧）に置き換えた。
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
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <SnsBackButton />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">FOLLOWERS</p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown">
          あなたのフォロワー
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followerIds === null ? (
          <p className="text-center font-sans text-xs text-dojo-dark-brown">読み込み中…</p>
        ) : followerIds.length === 0 ? (
          <p className="text-center font-sans text-xs text-dojo-dark-brown">
            まだ誰にもフォローされていません。
          </p>
        ) : (
          followerIds.map((id) => <SnsFollowListRow key={id} authorId={id} />)
        )}
      </div>
    </div>
  );
}
