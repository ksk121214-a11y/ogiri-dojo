"use client";

import Link from "next/link";
import { useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import MyProfileEditModal from "@/components/app/MyProfileEditModal";
import MyStatsModal from "@/components/app/MyStatsModal";
import SnsFeedSection from "@/components/sns/SnsFeedSection";
import { getRankByMeter } from "@/data/collectionData";
import { MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

// マイページ：自分の演者情報（アイコン・名前・一言コメント）と、
// 寄合帳（SNS）のフィードを1ページに統合したもの。
// 段位・ポイント・表彰実績は情報量が多いため演者名カード内の「段位・実績を見る」ボタンから
// モーダルで見る形にし、常時表示するのは名前まわりとフォロー数・寄合帳だけに絞っている
// （ガチャが無いため装備中・所有コレクションのセクションは廃止）。
export default function MyPage() {
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);
  const profile = useProfileStore((s) => s.profile);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  const [statsOpen, setStatsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const displayName = profile?.displayName ?? user.displayName;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-white p-6 text-center shadow-sm sm:flex-row sm:items-start sm:gap-5 sm:text-left">
        <MyIconAvatar size={80} />
        <div className="flex flex-1 flex-col items-center gap-1 sm:items-start">
          <p className="font-sans text-lg font-bold text-dojo-ink">{displayName}</p>
          <p className="font-sans text-xs font-bold text-dojo-dark-brown/80">
            段位：{rank.label}
          </p>
          <p className="mt-1 max-w-xs font-sans text-xs text-dojo-ink/80">{user.bio}</p>

          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => setStatsOpen(true)}
              className="rounded-full bg-dojo-tatami-cream px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown transition hover:bg-dojo-light-brown"
            >
              段位・実績を見る
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-1 rounded-full border border-dojo-dark-brown/15 px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown transition hover:bg-black/5"
            >
              <span aria-hidden>✎</span>
              編集する
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-around gap-3 rounded-3xl bg-white p-4 shadow-sm">
        <Link href="/sns/u/me/following" className="flex flex-col items-center gap-0.5">
          <span className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
            {followingAuthorIds.length}
          </span>
          <span className="font-sans text-[11px] text-dojo-dark-brown/70 hover:underline">
            フォロー中
          </span>
        </Link>
        <span className="h-8 w-px bg-dojo-dark-brown/10" />
        <Link href="/sns/u/me/followers" className="flex flex-col items-center gap-0.5">
          <span className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
            {MY_FOLLOWER_DISPLAY_COUNT}
          </span>
          <span className="font-sans text-[11px] text-dojo-dark-brown/70 hover:underline">
            フォロワー
          </span>
        </Link>
      </div>

      <div>
        <div className="mb-4 text-center">
          <p className="font-sans text-xs tracking-widest text-dojo-dark-brown/70">
            寄合帳
          </p>
          <p className="mt-1 font-sans text-xs text-dojo-dark-brown/70">
            道場の仲間たちが出したお題に回答して、いいねやツッコミを送り合う簡易版SNS（ダミーデータ）
          </p>
        </div>
        <SnsFeedSection />
      </div>

      <MyStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      {editOpen && <MyProfileEditModal onClose={() => setEditOpen(false)} />}
    </div>
  );
}
