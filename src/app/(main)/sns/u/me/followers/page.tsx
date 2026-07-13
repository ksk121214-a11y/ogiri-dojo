"use client";

import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { DUMMY_SNS_AUTHORS, MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";

// 自分（マイページ）のフォロワー一覧。厳密なフォロワー管理はしていないため、
// フォロワー数の多いダミー投稿者を「あなたをフォローしています」として仮表示する簡易実装。
const MY_FOLLOWERS = [...DUMMY_SNS_AUTHORS]
  .sort((a, b) => b.followerCount - a.followerCount)
  .slice(0, MY_FOLLOWER_DISPLAY_COUNT);

export default function MyFollowersPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <SnsBackButton />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">FOLLOWERS</p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown">
          あなたのフォロワー
        </h1>
        <p className="mt-2 font-sans text-[11px] text-dojo-dark-brown">
          ※ダミーデータのため、道場で人気の演者を仮に表示しています
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {MY_FOLLOWERS.map((a) => (
          <SnsFollowListRow key={a.id} author={a} />
        ))}
      </div>
    </div>
  );
}
