"use client";

import { getNextRank, getRankByMeter } from "@/data/collectionData";
import { useUserStore } from "@/store/useUserStore";

// マイページの演者名カードから開く、段位・ポイント・表彰実績の詳細モーダル。
// 常時表示だと情報過多になるため、普段は隠しておき見たい人だけがここを開く構成にした。
export default function MyStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-dojo-dark-brown/10 bg-dojo-tatami-cream p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-bold text-dojo-ink">段位・実績</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full px-2 py-1 font-sans text-sm text-dojo-dark-brown hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <div className="rounded-2xl bg-white p-5 text-center">
          <p className="font-sans text-[11px] text-dojo-dark-brown/70">段位</p>
          <p className="mt-1 font-brush text-3xl text-dojo-dark-brown">{rank.label}</p>
          <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-dojo-dark-brown/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-dojo-spotlight-orange to-dojo-curtain-gold transition-all"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
          <p className="mt-2 font-sans text-[11px] text-dojo-dark-brown/70">
            {nextRank ? `次は「${nextRank.label}」` : "最高位「達人」に到達しています"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="ポイント残高" value={`${user.points.toLocaleString()}pt`} />
          <StatCard label="参加回数" value={`${user.liveCount}回`} />
          <StatCard
            label="表彰回数"
            value={`${user.awardCounts.first + user.awardCounts.second + user.awardCounts.third}回`}
          />
          <StatCard label="ベストアンサー" value={`${user.bestAnswerCount}回`} />
        </div>

        <div>
          <h3 className="mb-2 font-sans text-sm font-bold text-dojo-ink">表彰実績</h3>
          <div className="flex gap-2 font-sans text-xs">
            <span className="rounded-full bg-dojo-ink px-3 py-1.5 text-dojo-curtain-gold">
              1位 × {user.awardCounts.first}
            </span>
            <span className="rounded-full bg-dojo-ink px-3 py-1.5 text-dojo-gold-foil">
              2位 × {user.awardCounts.second}
            </span>
            <span className="rounded-full bg-dojo-ink px-3 py-1.5 text-dojo-spotlight-orange-light">
              3位 × {user.awardCounts.third}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center">
      <p className="font-sans text-[10px] text-dojo-dark-brown/70">{label}</p>
      <p className="mt-1 font-sans text-sm font-bold tabular-nums text-dojo-ink">{value}</p>
    </div>
  );
}
