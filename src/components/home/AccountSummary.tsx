"use client";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

// 生成り色の横長カード：アイコン＋ログイン状態／名前／段位＋ポイント残高。
// アイコンは大喜利ライブと同じ線画（MyIconAvatar、マイページで変更した色がそのまま反映される）。
export default function AccountSummary() {
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const displayName = profile?.displayName ?? user.displayName;
  const rank = getRankByMeter(user.masteryMeter);

  return (
    <section className="flex items-center gap-3 rounded-2xl bg-[var(--paper)] px-4 py-3 text-[var(--ink)]">
      <MyIconAvatar size={44} />
      <div className="min-w-0 flex-1">
        <span className="inline-block rounded-sm bg-[var(--ink)]/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--ink)]/70">
          ログイン中
        </span>
        <p className="mt-1 truncate text-sm font-bold">{displayName}</p>
        <p className="text-xs font-bold text-[var(--ink)]/70">段位：{rank.label}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] text-[var(--ink)]/60">ポイント残高</p>
        <p className="text-xl font-black tabular-nums text-[var(--accent)]">
          {user.points.toLocaleString()}
          <span className="ml-0.5 text-xs font-normal text-[var(--ink)]/60">pt</span>
        </p>
      </div>
    </section>
  );
}
