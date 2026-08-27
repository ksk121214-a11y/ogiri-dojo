"use client";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

import styles from "./StadiumHome.module.css";

// 生成り色の横長カード：アイコン＋ログイン状態／名前／段位＋ポイント残高。
// アイコンは大喜利ライブと同じ線画（MyIconAvatar、マイページで変更した色がそのまま反映される）。
export default function AccountSummary() {
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const displayName = profile?.displayName ?? user.displayName;
  const rank = getRankByMeter(user.masteryMeter);

  return (
    <section className={`${styles.grainPaper} flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[var(--ink)]`}>
      {/*
        「アイコンは丸で囲わずそのままの感じで」の要望のため、円形の縁取り・背景は付けず、
        bareモード（縁取りなし）のMyIconAvatarをそのまま置く
        （MyIconAvatar自体は他画面共通のコンポーネントなので変更しない）。
      */}
      <MyIconAvatar size={44} bare />
      <div className="min-w-0 flex-1">
        <span className="inline-block rounded-sm bg-[var(--ink)]/10 px-1.5 py-0.5 text-xs font-bold tracking-widest text-[var(--ink)]/70">
          ログイン中
        </span>
        <p className="mt-1 truncate text-lg font-bold">{displayName}</p>
        <p className="text-base font-bold text-[var(--ink)]/70">段位：{rank.label}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm text-[var(--ink)]/60">ポイント残高</p>
        <p className="text-3xl font-black tabular-nums text-[var(--accent)]">
          {user.points.toLocaleString()}
          <span className="ml-0.5 text-base font-normal text-[var(--ink)]/60">pt</span>
        </p>
      </div>
    </section>
  );
}
