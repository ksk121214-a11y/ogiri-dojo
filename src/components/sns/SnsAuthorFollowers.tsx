"use client";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { getDummySnsAuthor, getRandomOtherAuthors } from "@/data/snsAuthors";

// ダミー投稿者のフォロワー一覧（簡易版）。SnsAuthorFollowing.tsxと同様、厳密な関係管理はせず、
// 他のダミー投稿者から人数分だけ雰囲気として抽出して表示する。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
// 2026-08-30: 寄合帳全体を新デザイン（StadiumPageShell）に統一した。
export default function SnsAuthorFollowers({ authorId }: { authorId: string }) {
  const author = getDummySnsAuthor(authorId);

  if (!author) {
    return (
      <StadiumPageShell contentTheme="kraft">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-sans text-sm text-[var(--ink)]/70">
            演者が見つかりませんでした。
          </p>
          <SnsBackButton />
        </div>
      </StadiumPageShell>
    );
  }

  const list = getRandomOtherAuthors(
    authorId,
    Math.min(author.followerCount, 10),
    `${authorId}-followers`,
  );

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton fallbackHref={`/sns/u/${authorId}`} />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">FOLLOWERS</p>
        <h1 className="mt-1 font-sans text-2xl font-black text-[var(--ink)]">
          {author.displayName} のフォロワー
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {list.length === 0 && (
          <p className="text-center font-sans text-xs text-[var(--ink)]/70">
            まだ誰もフォローしていません。
          </p>
        )}
        {list.map((a) => (
          <SnsFollowListRow key={a.id} author={a} />
        ))}
      </div>
    </StadiumPageShell>
  );
}
