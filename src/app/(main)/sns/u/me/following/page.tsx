"use client";

import Link from "next/link";

import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { DUMMY_SNS_AUTHORS } from "@/data/snsAuthors";
import { useSnsStore } from "@/store/useSnsStore";

// 自分（マイページ）のフォロー中一覧。useSnsStoreのfollowingAuthorIdsをそのまま表示する。
export default function MyFollowingPage() {
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);
  const list = DUMMY_SNS_AUTHORS.filter((a) => followingAuthorIds.includes(a.id));

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Link
        href="/"
        className="w-fit font-sans text-xs font-bold text-dojo-dark-brown hover:underline"
      >
        ← ホームへ戻る
      </Link>

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">FOLLOWING</p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown">
          あなたのフォロー中
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {list.length === 0 && (
          <p className="text-center font-sans text-xs text-dojo-dark-brown">
            まだ誰もフォローしていません。寄合帳で気になる演者を探してみましょう。
          </p>
        )}
        {list.map((a) => (
          <SnsFollowListRow key={a.id} author={a} />
        ))}
      </div>
    </div>
  );
}
