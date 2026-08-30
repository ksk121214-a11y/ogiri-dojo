"use client";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { useSnsStore } from "@/store/useSnsStore";

// 自分（マイページ）のフォロー中一覧。useSnsStoreのfollowingAuthorIds（2026-08-30以降は
// sns_followsの実データ）をそのまま表示する。
// 2026-08-30（デザイン統一）：他の寄合帳サブページ（SnsAuthorFollowing等）と同じ
// StadiumPageShell（地下ライブハウス風トンマナ）に合わせた。
export default function MyFollowingPage() {
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton fallbackHref="/sns" />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">FOLLOWING</p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)]">
          あなたのフォロー中
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {followingAuthorIds.length === 0 && (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">
            まだ誰もフォローしていません。寄合帳で気になる演者を探してみましょう。
          </p>
        )}
        {followingAuthorIds.map((id) => (
          <SnsFollowListRow key={id} authorId={id} />
        ))}
      </div>
    </StadiumPageShell>
  );
}
