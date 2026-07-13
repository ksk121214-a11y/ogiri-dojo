"use client";

import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowListRow from "@/components/sns/SnsFollowListRow";
import { getDummySnsAuthor, getRandomOtherAuthors } from "@/data/snsAuthors";

// ダミー投稿者のフォロワー一覧（簡易版）。SnsAuthorFollowing.tsxと同様、厳密な関係管理はせず、
// 他のダミー投稿者から人数分だけ雰囲気として抽出して表示する。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
export default function SnsAuthorFollowers({ authorId }: { authorId: string }) {
  const author = getDummySnsAuthor(authorId);

  if (!author) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-dojo-dark-brown">
          演者が見つかりませんでした。
        </p>
        <SnsBackButton className="font-sans text-xs font-bold text-dojo-ink hover:underline" />
      </div>
    );
  }

  const list = getRandomOtherAuthors(
    authorId,
    Math.min(author.followerCount, 10),
    `${authorId}-followers`,
  );

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <SnsBackButton fallbackHref={`/sns/u/${authorId}`} />

      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">FOLLOWERS</p>
        <h1 className="mt-1 font-brush text-2xl text-dojo-dark-brown">
          {author.displayName} のフォロワー
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {list.length === 0 && (
          <p className="text-center font-sans text-xs text-dojo-dark-brown">
            まだ誰もフォローしていません。
          </p>
        )}
        {list.map((a) => (
          <SnsFollowListRow key={a.id} author={a} />
        ))}
      </div>
    </div>
  );
}
