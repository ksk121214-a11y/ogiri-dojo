"use client";

import Link from "next/link";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import SnsFeedSection from "@/components/sns/SnsFeedSection";
import { getNextRank, getRankByMeter, groupOwnedItems, getCollectionItem } from "@/data/collectionData";
import { MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";
import { ITEM_TYPE_EMOJI, RARITY_TEXT_CLASS } from "@/lib/economyUi";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

// マイページ：自分の演者情報（段位・実績・装備・所有コレクション）と、
// 寄合帳（SNS）のフィードを1ページに統合したもの。
// 元はホーム画面内のビュー切り替え（"home"/"mypage"）だったが、上部ナビの独立項目に格上げした。
export default function MyPage() {
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);
  const nextRank = getNextRank(user.masteryMeter);
  const progressRatio = nextRank
    ? Math.min(
        1,
        (user.masteryMeter - rank.threshold) /
          (nextRank.threshold - rank.threshold),
      )
    : 1;

  const equippedItems = [
    user.inventory.equipped.costumeId,
    user.inventory.equipped.iconPartId,
    user.inventory.equipped.bgPatternId,
  ]
    .filter((id): id is string => !!id)
    .map((id) => getCollectionItem(id))
    .filter((item): item is NonNullable<typeof item> => !!item);

  const ownedItems = groupOwnedItems(user.inventory.ownedItemIds);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          MY PAGE
        </p>
        <h2 className="mt-1 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
          めくり札
        </h2>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-6 text-center sm:flex-row sm:items-start sm:gap-5 sm:text-left">
        <MyIconAvatar size={88} />
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <p className="font-sans text-[11px] text-dojo-dark-brown">
            演者名
          </p>
          <p className="font-brush text-2xl text-dojo-ink">
            {user.displayName}
          </p>
          <p className="font-sans text-xs font-bold text-dojo-ink">
            段位：{rank.label}
          </p>
          <p className="mt-1 max-w-xs font-sans text-xs text-dojo-ink">
            {user.bio}
          </p>
        </div>
      </div>

      <SnsFollowSummary />

      <div className="rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-6 text-center">
        <p className="font-sans text-[11px] text-dojo-dark-brown">段位</p>
        <p className="mt-1 font-brush text-3xl text-dojo-dark-brown">
          {rank.label}
        </p>
        <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-dojo-dark-brown/20">
          <div
            className="h-full rounded-full bg-gradient-to-r from-dojo-spotlight-orange to-dojo-curtain-gold transition-all"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>
        <p className="mt-2 font-sans text-[11px] text-dojo-dark-brown">
          {nextRank
            ? `次は「${nextRank.label}」`
            : "最高位「達人」に到達しています"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="ポイント残高" value={`${user.points.toLocaleString()}pt`} />
        <StatCard label="参加回数" value={`${user.liveCount}回`} />
        <StatCard
          label="表彰回数"
          value={`${user.awardCounts.first + user.awardCounts.second + user.awardCounts.third}回`}
        />
        <StatCard label="ベストアンサー" value={`${user.bestAnswerCount}回`} />
      </div>

      <div>
        <h3 className="mb-2 font-sans text-sm font-bold text-dojo-ink">
          表彰実績
        </h3>
        <div className="flex gap-3 font-sans text-xs">
          <span className="rounded-full bg-dojo-dark-brown px-3 py-1.5 text-dojo-curtain-gold">
            1位 × {user.awardCounts.first}
          </span>
          <span className="rounded-full bg-dojo-dark-brown px-3 py-1.5 text-dojo-gold-foil">
            2位 × {user.awardCounts.second}
          </span>
          <span className="rounded-full bg-dojo-dark-brown px-3 py-1.5 text-dojo-spotlight-orange-light">
            3位 × {user.awardCounts.third}
          </span>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-sans text-sm font-bold text-dojo-ink">
          装備中
        </h3>
        <div className="flex flex-wrap gap-3">
          {equippedItems.length === 0 && (
            <p className="font-sans text-xs text-dojo-dark-brown">
              まだ何も装備していません
            </p>
          )}
          {equippedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 px-3 py-2"
            >
              <span className="text-xl">{ITEM_TYPE_EMOJI[item.type]}</span>
              <div>
                <p className="font-sans text-xs font-bold text-dojo-ink">
                  {item.name}
                </p>
                <p
                  className={`font-sans text-[10px] ${RARITY_TEXT_CLASS[item.rarity]}`}
                >
                  {item.rarity}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-sans text-sm font-bold text-dojo-ink">
          所有コレクション（{ownedItems.length}種 / 計{user.inventory.ownedItemIds.length}個）
        </h3>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {ownedItems.map(({ item, count }) => (
            <div
              key={item.id}
              className="relative flex flex-col items-center gap-0.5 rounded-lg border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-1.5 text-center"
            >
              {count > 1 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-dojo-curtain-red px-1.5 py-0.5 font-sans text-[9px] font-bold leading-none text-dojo-washi-white shadow">
                  ×{count}
                </span>
              )}
              <span className="text-base">{ITEM_TYPE_EMOJI[item.type]}</span>
              <p className="w-full truncate font-sans text-[9px] text-dojo-ink">
                {item.name}
              </p>
              <p className={`font-sans text-[8px] ${RARITY_TEXT_CLASS[item.rarity]}`}>
                {item.rarity}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-dojo-dark-brown/15 pt-6">
        <div className="mb-4 text-center">
          <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
            寄合帳
          </p>
          <p className="mt-1 font-sans text-xs text-dojo-dark-brown">
            道場の仲間たちが出したお題に回答して、いいねやツッコミを送り合う簡易版SNS（ダミーデータ）
          </p>
        </div>
        <SnsFeedSection />
      </div>
    </div>
  );
}

// マイページと寄合帳（SNS）のフォロー中/フォロワーをつなぐセクション。
function SnsFollowSummary() {
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  return (
    <div className="flex items-center justify-around gap-3 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-4">
      <Link href="/sns/u/me/following" className="flex flex-col items-center gap-0.5">
        <span className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
          {followingAuthorIds.length}
        </span>
        <span className="font-sans text-[11px] text-dojo-dark-brown hover:underline">
          フォロー中
        </span>
      </Link>
      <span className="h-8 w-px bg-dojo-dark-brown/20" />
      <Link href="/sns/u/me/followers" className="flex flex-col items-center gap-0.5">
        <span className="font-sans text-lg font-bold tabular-nums text-dojo-ink">
          {MY_FOLLOWER_DISPLAY_COUNT}
        </span>
        <span className="font-sans text-[11px] text-dojo-dark-brown hover:underline">
          フォロワー
        </span>
      </Link>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-3 text-center">
      <p className="font-sans text-[10px] text-dojo-dark-brown">{label}</p>
      <p className="mt-1 font-sans text-sm font-bold tabular-nums text-dojo-ink">
        {value}
      </p>
    </div>
  );
}
