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
    <section className="flex items-center gap-3 rounded-2xl bg-[var(--paper)] px-4 py-3.5 text-[var(--ink)]">
      {/*
        MyIconAvatarの通常表示は寄合帳等の畳生成りテーマに合わせたdojo-curtain-gold(金色)の
        縁取りが付く。このホーム画面の配色（チャコール×生成り×赤オレンジ）から浮くため、
        bareモード（縁取りなし）で受け取り、この画面専用のパレットに沿った縁を自前で付ける
        （MyIconAvatar自体は他画面共通のコンポーネントなので変更しない）。
      */}
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border-dark)] bg-white">
        <MyIconAvatar size={38} bare />
      </span>
      <div className="min-w-0 flex-1">
        <span className="inline-block rounded-sm bg-[var(--ink)]/10 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-[var(--ink)]/70">
          ログイン中
        </span>
        <p className="mt-1 truncate text-base font-bold">{displayName}</p>
        <p className="text-sm font-bold text-[var(--ink)]/70">段位：{rank.label}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-[var(--ink)]/60">ポイント残高</p>
        <p className="text-2xl font-black tabular-nums text-[var(--accent)]">
          {user.points.toLocaleString()}
          <span className="ml-0.5 text-sm font-normal text-[var(--ink)]/60">pt</span>
        </p>
      </div>
    </section>
  );
}
