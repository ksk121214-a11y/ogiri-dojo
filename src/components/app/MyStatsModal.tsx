"use client";

import { getNextRank, getRankByMeter } from "@/data/collectionData";
import { useProfileStore } from "@/store/useProfileStore";

import styles from "@/components/home/StadiumHome.module.css";

// マイページの演者名カードから開く、段位・ポイント・表彰実績の詳細モーダル。
// 常時表示だと情報過多になるため、普段は隠しておき見たい人だけがここを開く構成にした。
// 2026-08-28: マイページ本体（Stadiumテーマ）に合わせ、旧dojoテーマの見た目から
// チケット言語（.grainPaper・--ink／--accent等）を使ったデザインに刷新。
// 2026-08-31（段位・ポイント・実績の実データ化）：段位進捗・ポイント・参加回数・
// 表彰回数・ベストアンサーはすべてuseUserStore（ローカルダミー）ではなく
// useProfileStore（Supabaseのprofiles、ライブ終了時にapply_live_rank_rewards()が
// 加算する実データ）を参照するようにした。未ログイン時は実績が無いため0/見習いを表示する。
// 「ポイント残高」という表記は、消費されうるポイントの印象を与えるため
// 「累計ポイント」（ライブで稼いだ分がそのまま積み上がっていく値）に変更した。
// 角丸→角ばった見た目への変更：外側モーダル・内側カードの角丸を無くし、
// ライブハウスの壁に貼られたポスター/カードのような雰囲気にしている
// （仕様・表示項目は変更していない）。
export default function MyStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const profile = useProfileStore((s) => s.profile);
  const masteryMeter = profile?.masteryMeter ?? 0;
  const rank = getRankByMeter(masteryMeter);
  const nextRank = getNextRank(masteryMeter);
  const progressRatio = nextRank
    ? Math.min(1, (masteryMeter - rank.threshold) / (nextRank.threshold - rank.threshold))
    : 1;

  if (!open) return null;

  const awardFirst = profile?.awardCountFirst ?? 0;
  const awardSecond = profile?.awardCountSecond ?? 0;
  const awardThird = profile?.awardCountThird ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.grainPaper} flex max-h-[90vh] w-full max-w-sm flex-col gap-5 overflow-y-auto rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-lg font-black">段位・実績</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className={`${styles.pressable} rounded-full px-2 py-1 font-sans text-sm text-[var(--ink)]/70 hover:bg-[var(--ink)]/5`}
          >
            ✕
          </button>
        </div>

        {!profile && (
          <p className="font-sans text-[11px] text-[var(--ink)]/60">
            ログインするとライブの実績がここに記録されます。
          </p>
        )}

        <div className="rounded-none border border-[var(--ink)]/10 bg-white p-5 text-center">
          <p className="font-sans text-[11px] text-[var(--ink)]/60">段位</p>
          <p className="mt-1 font-sans text-3xl font-black text-[var(--ink)]">{rank.label}</p>
          <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--ink)]/10">
            <div
              className={`${styles.grainAccent} h-full rounded-full transition-all`}
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
          <p className="mt-2 font-sans text-[11px] text-[var(--ink)]/60">
            {nextRank ? `次は「${nextRank.label}」` : "最高位「達人」に到達しています"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="累計ポイント" value={`${(profile?.totalPoints ?? 0).toLocaleString()}pt`} />
          <StatCard label="ポイント残高" value={`${(profile?.pointsBalance ?? 0).toLocaleString()}pt`} />
          <StatCard label="参加回数" value={`${profile?.liveCount ?? 0}回`} />
          <StatCard label="表彰回数" value={`${awardFirst + awardSecond + awardThird}回`} />
          <StatCard label="ベストアンサー" value={`${profile?.bestAnswerCount ?? 0}回`} />
        </div>

        <div>
          <h3 className="mb-2 font-sans text-sm font-bold">表彰実績</h3>
          <div className="flex gap-2 font-sans text-xs">
            <span className={`${styles.grainAccent} rounded-full px-3 py-1.5 font-bold text-[var(--paper)]`}>
              1位 × {awardFirst}
            </span>
            <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 font-bold text-[var(--paper)]">
              2位 × {awardSecond}
            </span>
            <span className="rounded-full bg-[var(--ink)]/60 px-3 py-1.5 font-bold text-[var(--paper)]">
              3位 × {awardThird}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-none border border-[var(--ink)]/10 bg-white p-3 text-center">
      <p className="font-sans text-[10px] text-[var(--ink)]/60">{label}</p>
      <p className="mt-1 font-sans text-sm font-bold tabular-nums text-[var(--ink)]">{value}</p>
    </div>
  );
}
