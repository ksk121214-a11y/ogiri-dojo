"use client";

import type { CSSProperties } from "react";

import Link from "next/link";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

import { EditGlyph } from "./icons";
import styles from "./StadiumHome.module.css";

// マイページの演者名カード。NextLiveTicket（次回ライブ）と同じ「本券／半券＋丸い切り欠き」の
// チケット言語を流用し、半券側にOGIRI LIVEのスタンプ風グラフィックを置く
// （半券の幅は92pxのため、切り欠きの位置も.notchTop/.notchBottom共通の--notch-rightで
// 84px＝92-8に合わせている。計算根拠はNextLiveTicket側の104px幅・right:96pxと同じ考え方）。
const NOTCH_STYLE = { "--notch-right": "84px" } as CSSProperties;

export default function MyProfileTicket({
  onOpenStats,
  onOpenEdit,
}: {
  onOpenStats: () => void;
  onOpenEdit: () => void;
}) {
  const user = useUserStore((s) => s.user);
  const rank = getRankByMeter(user.masteryMeter);
  const profile = useProfileStore((s) => s.profile);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);
  const displayName = profile?.displayName ?? user.displayName;

  return (
    <div className={`${styles.profileCard} ${styles.grainPaper}`}>
      <div className={`${styles.notchTop} ${styles.notchKraft}`} style={NOTCH_STYLE} aria-hidden />
      <div className={`${styles.notchBottom} ${styles.notchKraft}`} style={NOTCH_STYLE} aria-hidden />

      <div className="flex flex-col gap-3 px-5 py-5">
        <div className="flex items-start gap-3.5">
          <span className="flex shrink-0 items-center justify-center rounded-full border-4 border-[var(--accent)] p-1.5">
            <MyIconAvatar size={56} bare />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5 pt-1">
            <p className="truncate font-sans text-2xl font-black text-[var(--ink)]">{displayName}</p>
            <span
              className={`${styles.grainAccent} w-fit rounded-full px-3 py-1 font-sans text-xs font-bold text-[var(--paper)]`}
            >
              段位：{rank.label}
            </span>
          </div>
        </div>

        <p className="text-sm leading-snug text-[var(--ink)]/85">{user.bio}</p>

        <div className="border-t-2 border-dashed border-[var(--ink)]/25" aria-hidden />

        <div className="flex items-center justify-center gap-4">
          <Link href="/sns/u/me/following" className="flex items-center gap-1.5">
            <span className="font-sans text-base font-bold tabular-nums text-[var(--ink)]">
              {followingAuthorIds.length}
            </span>
            <span className="font-sans text-xs text-[var(--ink)]/70 hover:underline">フォロー中</span>
          </Link>
          <span className="text-[var(--ink)]/25" aria-hidden>
            |
          </span>
          <Link href="/sns/u/me/followers" className="flex items-center gap-1.5">
            <span className="font-sans text-base font-bold tabular-nums text-[var(--ink)]">
              {MY_FOLLOWER_DISPLAY_COUNT}
            </span>
            <span className="font-sans text-xs text-[var(--ink)]/70 hover:underline">フォロワー</span>
          </Link>
        </div>

        {/* 「段位・実績を見る」が参考画像では1行に収まっているのに対し、text-smだと
            この列幅では折り返ってしまっていたため、text-xs・px-2に詰めてnowrapにしている。 */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onOpenStats}
            className={`${styles.pressable} flex-1 whitespace-nowrap rounded-xl bg-[var(--ink)] px-2 py-2.5 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
          >
            段位・実績を見る
          </button>
          <button
            type="button"
            onClick={onOpenEdit}
            className={`${styles.pressable} flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-[var(--ink)]/70 px-2 py-2.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/5`}
          >
            <EditGlyph />
            編集する
          </button>
        </div>
      </div>

      <div className={`${styles.stubDivider} flex items-center justify-center px-1`}>
        <OgiriStamp />
      </div>
    </div>
  );
}

// 半券に押された「OGIRI LIVE」の判子（スタンプ）風グラフィック。
// 実在しない印影素材をでっち上げず、SVGのtextPathで円弧に沿った文字を描く。
function OgiriStamp() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="76"
      height="76"
      className="text-[var(--accent)] opacity-60"
      style={{ transform: "rotate(-8deg)" }}
      aria-hidden
    >
      <defs>
        <path id="ogiriStampArc" d="M 10,53 A 40,40 0 1 1 90,53" fill="none" />
      </defs>
      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="50" cy="50" r="32" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text fill="currentColor" fontSize="10.5" fontWeight={700} letterSpacing="1.5">
        <textPath href="#ogiriStampArc" xlinkHref="#ogiriStampArc" startOffset="50%" textAnchor="middle">
          OGIRI LIVE
        </textPath>
      </text>
      <text x="50" y="65" textAnchor="middle" fontSize="13" fontWeight={700} fill="currentColor">
        ★ ★ ★
      </text>
    </svg>
  );
}
