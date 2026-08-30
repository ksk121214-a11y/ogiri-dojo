"use client";

import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { useSnsStore } from "@/store/useSnsStore";

// 自分（マイページ）のフォロー中一覧。useSnsStoreのfollowingAuthorIds（2026-08-30以降は
// sns_followsの実データ）をそのまま表示する。
export default function MyFollowingPage() {
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <SnsBackButton />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">FOLLOWING</p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown">
          あなたのフォロー中
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followingAuthorIds.length === 0 && (
          <p className="text-center font-sans text-xs text-dojo-dark-brown">
            まだ誰もフォローしていません。寄合帳で気になる演者を探してみましょう。
          </p>
        )}
        {followingAuthorIds.map((id) => (
          <SnsFollowListRow key={id} authorId={id} />
        ))}
      </div>
    </div>
  );
}
