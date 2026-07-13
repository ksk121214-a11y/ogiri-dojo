"use client";

import { useSnsStore } from "@/store/useSnsStore";

// 大喜利SNS本家のFollowButton相当。自分自身（authorId === "me"）には表示しない。
export default function SnsFollowButton({
  authorId,
  size = "default",
}: {
  authorId: string;
  size?: "default" | "compact";
}) {
  const following = useSnsStore((s) => s.followingAuthorIds.includes(authorId));
  const toggleFollow = useSnsStore((s) => s.toggleFollow);

  if (authorId === "me") return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // リンクやカードのクリック領域内に置かれた場合に伝播しないようにする。
        e.stopPropagation();
        e.preventDefault();
        toggleFollow(authorId);
      }}
      className={`shrink-0 rounded-full font-sans font-bold transition active:scale-95 ${
        size === "compact" ? "px-3 py-1 text-[11px]" : "px-5 py-2 text-xs"
      } ${
        following
          ? "border border-dojo-dark-brown/30 text-dojo-dark-brown hover:border-dojo-curtain-red hover:text-dojo-curtain-red"
          : "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.35)] hover:bg-dojo-deep-crimson"
      }`}
    >
      {following ? "フォロー中" : size === "compact" ? "フォロー" : "フォローする"}
    </button>
  );
}
