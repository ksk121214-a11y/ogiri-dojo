"use client";

import Link from "next/link";
import { useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { MY_FOLLOWER_DISPLAY_COUNT } from "@/data/snsAuthors";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

const BIO_MAX_LENGTH = 80;

// 寄合帳トップ（/sns）に直接埋め込む、アイコン・演者名・段位・一言コメント（bio）の表示/編集カード。
// 「寄合帳を開いたら別ページに飛ばずその場でプロフィールが見える」という要望のため、
// 独立したプロフィールページ（旧 /sns/u/me）は廃止し、このカードのみで完結させている。
export default function SnsMyProfileCard() {
  const user = useUserStore((s) => s.user);
  const updateBio = useUserStore((s) => s.updateBio);
  const answers = useSnsStore((s) => s.answers);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  const [editing, setEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState(user.bio);

  const rank = getRankByMeter(user.masteryMeter);

  const ownAnswers = answers.filter((a) => a.authorId === "me");
  const totalLikes = ownAnswers.reduce((sum, a) => sum + a.likes, 0);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-6 text-center">
      <MyIconAvatar size={64} />
      <div>
        <p className="font-brush text-2xl text-dojo-ink">{user.displayName}</p>
        <p className="mt-1 font-sans text-xs font-bold text-dojo-ink">
          段位：{rank.label}
        </p>
      </div>

      {editing ? (
        <div className="flex w-full flex-col gap-2">
          <textarea
            value={bioDraft}
            onChange={(e) => setBioDraft(e.target.value)}
            rows={3}
            maxLength={BIO_MAX_LENGTH}
            placeholder="一言コメントを入力..."
            className="w-full rounded-lg border border-dojo-dark-brown/25 bg-dojo-washi-white p-2 text-left font-sans text-sm text-dojo-ink outline-none focus:border-dojo-curtain-gold"
          />
          <span className="self-end font-sans text-[11px] text-dojo-dark-brown">
            {bioDraft.length} / {BIO_MAX_LENGTH}
          </span>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full bg-dojo-tatami-cream px-5 py-2 font-sans text-sm font-bold text-dojo-dark-brown"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                updateBio(bioDraft.trim());
                setEditing(false);
              }}
              className="rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
            >
              保存する
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="max-w-sm font-sans text-sm text-dojo-ink">{user.bio}</p>
          <button
            type="button"
            onClick={() => {
              setBioDraft(user.bio);
              setEditing(true);
            }}
            className="flex items-center gap-1.5 rounded-full bg-dojo-tatami-cream px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown"
          >
            <span aria-hidden>✎</span>
            プロフィールを編集
          </button>
        </>
      )}

      <Link
        href="/backstage-room"
        className="font-sans text-xs font-bold text-dojo-ink hover:underline"
      >
        楽屋で着せ替える →
      </Link>

      <div className="flex gap-6 font-sans text-sm">
        <Link href="/sns/u/me/following" className="flex flex-col items-center">
          <span className="font-bold text-dojo-ink">{followingAuthorIds.length}</span>
          <span className="text-[11px] text-dojo-dark-brown">フォロー中</span>
        </Link>
        <Link href="/sns/u/me/followers" className="flex flex-col items-center">
          <span className="font-bold text-dojo-ink">{MY_FOLLOWER_DISPLAY_COUNT}</span>
          <span className="text-[11px] text-dojo-dark-brown">フォロワー</span>
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-bold text-dojo-ink">{ownAnswers.length}</span>
          <span className="text-[11px] text-dojo-dark-brown">回答</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-bold text-dojo-ink">❤ {totalLikes}</span>
          <span className="text-[11px] text-dojo-dark-brown">獲得いいね</span>
        </div>
      </div>
    </div>
  );
}
