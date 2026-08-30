"use client";

import Link from "next/link";
import { useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import MyIconAvatar from "@/components/app/MyIconAvatar";
import { getRankByMeter } from "@/data/collectionData";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

const BIO_MAX_LENGTH = 80;

// 寄合帳トップ（/sns）に直接埋め込む、アイコン・演者名・段位・一言コメント（bio）の表示/編集カード。
// 「寄合帳を開いたら別ページに飛ばずその場でプロフィールが見える」という要望のため、
// 独立したプロフィールページ（旧 /sns/u/me）は廃止し、このカードのみで完結させている。
// 2026-08-30: 寄合帳全体を新デザイン（ホームのチケット意匠＝.grainPaper等）に統一した。
export default function SnsMyProfileCard() {
  const user = useUserStore((s) => s.user);
  const updateBio = useUserStore((s) => s.updateBio);
  const answers = useSnsStore((s) => s.answers);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);
  // 自分のフォロワー数（sns_followsの実カウント、init()時にstoreがまとめて取得済み）。
  const followerCount = useSnsStore((s) => s.myFollowerCount);

  const [editing, setEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState(user.bio);

  const rank = getRankByMeter(user.masteryMeter);

  const ownAnswers = answers.filter((a) => a.authorId === "me");
  const totalLikes = ownAnswers.reduce((sum, a) => sum + a.likes, 0);

  return (
    <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-[var(--ink)]`}>
      <MyIconAvatar size={64} bare />
      <div>
        <p className="font-sans text-2xl font-black text-[var(--ink)]">{user.displayName}</p>
        <span className={`${stadiumStyles.grainAccent} mt-1 inline-block w-fit rounded-full px-3 py-1 font-sans text-xs font-bold text-[var(--paper)]`}>
          段位：{rank.label}
        </span>
      </div>

      {editing ? (
        <div className="flex w-full flex-col gap-2">
          <textarea
            value={bioDraft}
            onChange={(e) => setBioDraft(e.target.value)}
            rows={3}
            maxLength={BIO_MAX_LENGTH}
            placeholder="一言コメントを入力..."
            className="w-full rounded-lg border border-[var(--ink)]/20 bg-[var(--paper-muted)] p-2 text-left font-sans text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
          />
          <span className="self-end font-sans text-[11px] text-[var(--ink)]/60">
            {bioDraft.length} / {BIO_MAX_LENGTH}
          </span>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full bg-[var(--ink)]/10 px-5 py-2 font-sans text-sm font-bold text-[var(--ink)]"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => {
                updateBio(bioDraft.trim());
                setEditing(false);
              }}
              className={`${stadiumStyles.grainAccent} rounded-full px-5 py-2 font-sans text-sm font-bold text-[var(--paper)]`}
            >
              保存する
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="max-w-sm font-sans text-sm text-[var(--ink)]">{user.bio}</p>
          <button
            type="button"
            onClick={() => {
              setBioDraft(user.bio);
              setEditing(true);
            }}
            className="flex items-center gap-1.5 rounded-full bg-[var(--ink)]/10 px-4 py-1.5 font-sans text-xs font-bold text-[var(--ink)]"
          >
            <span aria-hidden>✎</span>
            プロフィールを編集
          </button>
        </>
      )}

      <Link href="/backstage-room" className="font-sans text-xs font-bold text-[var(--ink)] hover:underline">
        楽屋で着せ替える →
      </Link>

      <div className="flex gap-6 font-sans text-sm">
        <Link href="/sns/u/me/following" className="flex flex-col items-center">
          <span className="font-bold text-[var(--ink)]">{followingAuthorIds.length}</span>
          <span className="text-[11px] text-[var(--ink)]/70">フォロー中</span>
        </Link>
        <Link href="/sns/u/me/followers" className="flex flex-col items-center">
          <span className="font-bold text-[var(--ink)]">{followerCount ?? "…"}</span>
          <span className="text-[11px] text-[var(--ink)]/70">フォロワー</span>
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-bold text-[var(--ink)]">{ownAnswers.length}</span>
          <span className="text-[11px] text-[var(--ink)]/70">回答</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-bold text-[var(--ink)]">❤ {totalLikes}</span>
          <span className="text-[11px] text-[var(--ink)]/70">獲得いいね</span>
        </div>
      </div>
    </div>
  );
}
