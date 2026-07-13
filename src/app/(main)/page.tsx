"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import NavTile from "@/components/app/NavTile";
import { getNextRank, getRankByMeter, groupOwnedItems, getCollectionItem } from "@/data/collectionData";
import { MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";
import { ITEM_TYPE_EMOJI, RARITY_TEXT_CLASS } from "@/lib/economyUi";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

// ダミーの次回ライブ開催予定（L0 相当）
const NEXT_LIVE = {
  dateLabel: "2026年7月20日（月）",
  timeLabel: "21:00 開演",
  note: "受付は20:55〜（定刻+5分まで）",
};

type MainView = "home" | "mypage";

// ホーム画面：第7ラウンドフィードバックで、マイページ相当のセクションを常時スクロール表示から
// 「マイページ」ボタン押下によるページ内ビュー切り替え（gacha/ranking画面のタブ切り替えと同じパターン）に変更した。
export default function Home() {
  const [view, setView] = useState<MainView>("home");

  return (
    <div className="flex flex-col gap-8">
      {view === "home" && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-3 rounded-3xl border border-dojo-curtain-gold/30 bg-dojo-light-brown/60 px-6 py-10 text-center"
        >
          <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
            ONLINE OGIRI LIVE
          </p>
          <h1 className="font-brush text-5xl leading-relaxed text-dojo-dark-brown sm:text-7xl">
            大喜利道場
          </h1>
          <p className="font-sans text-sm text-dojo-ink">
            決まった時間に、みんなで集まる大喜利ライブ。
          </p>
        </motion.section>
      )}

      {view === "home" ? <HomeView onOpenMyPage={() => setView("mypage")} /> : <MyPageView onBack={() => setView("home")} />}
    </div>
  );
}

function HomeView({ onOpenMyPage }: { onOpenMyPage: () => void }) {
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);

  return (
    <>
      <button
        type="button"
        onClick={onOpenMyPage}
        className="group flex items-center justify-between gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-4 text-left transition hover:border-dojo-curtain-gold hover:bg-dojo-light-brown sm:p-5"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎫</span>
          <div>
            <p className="font-sans text-base font-bold text-dojo-ink group-hover:text-dojo-dark-brown">
              マイページ
            </p>
            <p className="font-sans text-xs text-dojo-dark-brown">
              アバター・段位進捗・実績・所有コレクションを確認する
            </p>
          </div>
        </div>
        <span className="shrink-0 font-sans text-xs font-bold text-dojo-dark-brown">
          →
        </span>
      </button>

      <section className="rounded-2xl border border-dojo-curtain-red/40 bg-dojo-light-brown/70 p-5 sm:p-6">
        <p className="font-sans text-[11px] tracking-widest text-dojo-curtain-red">
          次回ライブ開催予定
        </p>
        <p className="mt-2 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
          {NEXT_LIVE.dateLabel} {NEXT_LIVE.timeLabel}
        </p>
        <p className="mt-1 font-sans text-xs text-dojo-dark-brown">
          {NEXT_LIVE.note}
        </p>
      </section>

      <section className="rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-5 sm:p-6">
        <p className="font-sans text-[11px] tracking-widest text-dojo-dark-brown">
          ログイン中
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-sans text-lg font-bold text-dojo-ink">
              {user.displayName}
            </p>
            <p className="mt-1 font-sans text-sm font-bold text-dojo-ink">
              段位：{rank.label}
            </p>
          </div>
          <div className="text-right">
            <p className="font-sans text-[11px] text-dojo-dark-brown">
              ポイント残高
            </p>
            <p className="font-sans text-2xl font-bold tabular-nums text-dojo-ink">
              {user.points.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-dojo-dark-brown">
                pt
              </span>
            </p>
          </div>
        </div>
      </section>

      <section>
        <p className="mb-3 font-sans text-xs tracking-widest text-dojo-dark-brown">
          MENU
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NavTile
            href="/live-demo"
            emoji="🎤"
            title="ライブ体験"
            description="開演から表彰までのライブ進行をモックで体験する"
          />
          <NavTile
            href="/gacha"
            emoji="🎰"
            title="ガチャ"
            description="ポイントで衣装・パーツ・背景柄を引く／衣装蔵で個別購入する"
          />
          <NavTile
            href="/backstage-room"
            emoji="🚪"
            title="楽屋"
            description="所持アイテムでその場で着せ替え・模様替えする"
          />
          <NavTile
            href="/ranking"
            emoji="🏆"
            title="ランキング"
            description="段位・スコアの一覧や過去のライブを振り返る"
          />
        </div>
      </section>
    </>
  );
}

function MyPageView({ onBack }: { onBack: () => void }) {
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
    <section className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="w-fit font-sans text-xs font-bold text-dojo-dark-brown hover:underline"
      >
        ← ホームに戻る
      </button>

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          MY PAGE
        </p>
        <h2 className="mt-1 font-brush text-2xl text-dojo-dark-brown sm:text-3xl">
          めくり札
        </h2>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-6 text-center sm:flex-row sm:items-start sm:gap-5 sm:text-left">
        <AvatarPlaceholder size={88} />
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
          <Link
            href="/sns"
            className="font-sans text-[11px] font-bold text-dojo-dark-brown hover:underline"
          >
            寄合帳で編集する →
          </Link>
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
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-sans text-sm font-bold text-dojo-ink">
            装備中
          </h3>
          <Link
            href="/backstage-room"
            className="font-sans text-xs font-bold text-dojo-ink hover:underline"
          >
            楽屋で着せ替える →
          </Link>
        </div>
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
    </section>
  );
}

// マイページと寄合帳（SNS）のフォロー中/フォロワーをつなぐセクション。
// 「マイページは大喜利道場と同じでリンクしている」の方針通り、SnsAuthorBadgeと同じ
// useUserStore由来の自分の情報と、useSnsStoreのフォロー状態を組み合わせて表示する。
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
      <span className="h-8 w-px bg-dojo-dark-brown/20" />
      <Link href="/sns" className="flex flex-col items-center gap-0.5">
        <span className="text-lg">🏮</span>
        <span className="font-sans text-[11px] text-dojo-dark-brown hover:underline">
          寄合帳へ
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
