"use client";

import { useState } from "react";

import { useSnsStore } from "@/store/useSnsStore";

// 大喜利SNS本家のFollowButton相当。自分自身（authorId === "me"）には表示しない。
// 2026-08-30（いいね・フォローの実データ化）：toggleFollowが非同期（Supabaseへの
// insert/delete）になったため、処理中は連打できないようにし、失敗時は小さく理由を表示する。
export default function SnsFollowButton({
  authorId,
  size = "default",
}: {
  authorId: string;
  size?: "default" | "compact";
}) {
  const following = useSnsStore((s) => s.followingAuthorIds.includes(authorId));
  const toggleFollow = useSnsStore((s) => s.toggleFollow);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authorId === "me") return null;

  const handleClick = async (e: React.MouseEvent) => {
    // リンクやカードのクリック領域内に置かれた場合に伝播しないようにする。
    e.stopPropagation();
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await toggleFollow(authorId);
    setPending(false);
    if (!result.ok && result.message) {
      setError(result.message);
      setTimeout(() => setError(null), 3000);
    }
  };

  return (
    <span className="relative inline-flex shrink-0 flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className={`shrink-0 rounded-full font-sans font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
          size === "compact" ? "px-3 py-1 text-[11px]" : "px-5 py-2 text-xs"
        } ${
          following
            ? "border border-[var(--ink)]/30 text-[var(--ink)]/70 hover:border-[var(--accent)] hover:text-[var(--accent)]"
            : "bg-[var(--accent)] text-[var(--paper)] shadow-[0_0_14px_rgba(192,38,63,0.35)] hover:opacity-90"
        }`}
      >
        {following ? "フォロー中" : size === "compact" ? "フォロー" : "フォローする"}
      </button>
      {error && (
        <span className="absolute top-full z-10 mt-1 whitespace-nowrap rounded bg-[var(--ink)] px-2 py-1 font-sans text-[10px] font-bold text-[var(--paper)]">
          {error}
        </span>
      )}
    </span>
  );
}
