"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AvatarGlyph from "@/components/app/AvatarGlyph";
import { HeartGlyph } from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import ReportButton from "@/components/app/ReportButton";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { getRankByMeter } from "@/data/collectionData";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import { getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { supabase } from "@/lib/supabase";
import { useSnsStore } from "@/store/useSnsStore";

type Tab = "answers" | "topics";

// プロフィールヘッダーに出す情報をダミー投稿者/実ユーザーで共通の形に揃えたもの。
// ダミー投稿者は段位・フォロー数・楽屋（装備データ）を持つが、実ユーザーは
// プロフィール（アイコン・名前）と過去の回答・お題のみ表示できる
// （段位・フォロー関係はDBに保存していないため、実ユーザーについては出さない）。
type ProfileAuthor =
  | {
      kind: "dummy";
      displayName: string;
      emoji: string;
      rankLabel: string;
      followerCount: number;
      followingCount: number;
    }
  | {
      kind: "real";
      displayName: string;
      avatarIcon: string;
      avatarColor: string;
      rankLabel: string;
      bio: string;
    };

// ダミー投稿者・実ユーザー投稿者どちらも同じ構成（プロフィール＋過去の回答＋出題したお題）で
// 見られる簡易プロフィールページ。大喜利SNS本家のProfileDetail相当を道場流に作り直したもの。
// 自分自身のプロフィールは寄合帳トップ（/sns）に直接埋め込まれているため、ここでは扱わない。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
// なお、ここに表示するお題/回答はauthorId（ダミー投稿者 or 実ユーザーのUUID）のものに限られ、
// ブラウザ上でローカル作成されるお題/回答は必ずauthorId==="me"になるため、このページには
// 現れない（isLocallyCreatedによるリンク無効化は不要）。
// 2026-08-30: 寄合帳全体を新デザイン（StadiumPageShell）に統一した。
// 2026-08-30: 実ユーザー（DB投稿者）をタップした際に「演者が見つかりませんでした」に
// なっていたのを、ダミー投稿者と同じくプロフィール・過去の回答・お題を見られるようにした。
export default function SnsAuthorProfile({ authorId }: { authorId: string }) {
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const realAuthor = useSnsStore((s) => s.realAuthorNames[authorId]);
  const resolveAuthorName = useSnsStore((s) => s.resolveAuthorName);
  const fetchAuthorPosts = useSnsStore((s) => s.fetchAuthorPosts);

  const [tab, setTab] = useState<Tab>("answers");
  // 実ユーザーのフォロー中数・フォロワー数（sns_followsの実カウント）。ダミー投稿者は
  // 従来どおりsnsAuthors.tsの固定値をそのまま使う。
  const [realCounts, setRealCounts] = useState<{ followers: number; following: number } | null>(null);

  const dummyAuthor = getDummySnsAuthor(authorId);

  // 投稿に一度も登場していない実ユーザー（フォロー関係だけで辿り着いた場合等）でも
  // プロフィールが表示できるよう、まだ解決していなければその場で表示名を取得する。
  useEffect(() => {
    if (dummyAuthor) return;
    resolveAuthorName(authorId);
    fetchAuthorPosts(authorId);
  }, [authorId, dummyAuthor, resolveAuthorName, fetchAuthorPosts]);

  useEffect(() => {
    if (dummyAuthor) return;
    let cancelled = false;
    Promise.all([
      supabase.from("sns_follows").select("id", { count: "exact", head: true }).eq("following_id", authorId),
      supabase.from("sns_follows").select("id", { count: "exact", head: true }).eq("follower_id", authorId),
    ]).then(([followersRes, followingRes]) => {
      if (cancelled) return;
      setRealCounts({ followers: followersRes.count ?? 0, following: followingRes.count ?? 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [authorId, dummyAuthor]);

  const author: ProfileAuthor | null = dummyAuthor
    ? {
        kind: "dummy",
        displayName: dummyAuthor.displayName,
        emoji: dummyAuthor.emoji,
        rankLabel: dummyAuthor.rankLabel,
        followerCount: dummyAuthor.followerCount,
        followingCount: dummyAuthor.followingCount,
      }
    : realAuthor
      ? {
          kind: "real",
          displayName: realAuthor.displayName,
          avatarIcon: realAuthor.avatarIcon,
          avatarColor: realAuthor.avatarColor,
          rankLabel: getRankByMeter(realAuthor.masteryMeter).label,
          bio: realAuthor.bio,
        }
      : null;

  const ownAnswers = useMemo(
    () => answers.filter((a) => a.authorId === authorId),
    [answers, authorId],
  );
  const ownTopics = useMemo(
    () => topics.filter((t) => t.authorId === authorId),
    [topics, authorId],
  );
  const totalLikes = useMemo(
    () => ownAnswers.reduce((sum, a) => sum + a.likes, 0),
    [ownAnswers],
  );
  const commentCountByAnswer = useMemo(() => {
    const map = new Map<string, number>();
    for (const comment of comments) {
      map.set(comment.answerId, (map.get(comment.answerId) ?? 0) + 1);
    }
    return map;
  }, [comments]);

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

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton />

      <div className={`${stadiumStyles.grainPaper} relative flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-[var(--ink)]`}>
        <div className="absolute right-4 top-4">
          <ReportButton />
        </div>
        {author.kind === "dummy" ? (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center text-5xl">
            {author.emoji}
          </span>
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center">
            <AvatarGlyph
              iconSrc={getAvatarIconSrc(author.avatarIcon)}
              silhouetteSrc={getAvatarSilhouetteSrc(author.avatarIcon)}
              color={author.avatarColor}
              size={56}
            />
          </span>
        )}
        <div>
          <p className="font-sans text-2xl font-black text-[var(--ink)]">{author.displayName}</p>
          <p className="mt-1 font-sans text-xs font-bold text-[var(--ink)]">
            段位：{author.rankLabel}
          </p>
          {author.kind === "real" && author.bio && (
            <p className="mt-1 font-sans text-xs text-[var(--ink)]/70">{author.bio}</p>
          )}
        </div>

        <div className="flex gap-6 font-sans text-sm">
          <Link href={`/sns/u/${authorId}/following`} className="flex flex-col items-center">
            <span className="font-bold text-[var(--ink)]">
              {author.kind === "dummy" ? author.followingCount : (realCounts?.following ?? "…")}
            </span>
            <span className="text-[11px] text-[var(--ink)]/70">フォロー中</span>
          </Link>
          <Link href={`/sns/u/${authorId}/followers`} className="flex flex-col items-center">
            <span className="font-bold text-[var(--ink)]">
              {author.kind === "dummy" ? author.followerCount : (realCounts?.followers ?? "…")}
            </span>
            <span className="text-[11px] text-[var(--ink)]/70">フォロワー</span>
          </Link>
          <div className="flex flex-col items-center">
            <span className="font-bold text-[var(--ink)]">{ownAnswers.length}</span>
            <span className="text-[11px] text-[var(--ink)]/70">回答</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-1 font-bold text-[var(--ink)]">
              <HeartGlyph filled />
              {totalLikes}
            </span>
            <span className="text-[11px] text-[var(--ink)]/70">獲得いいね</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <SnsFollowButton authorId={authorId} />
          {author.kind === "dummy" && (
            <Link
              href={`/sns/u/${authorId}/backstage`}
              className="flex items-center gap-1.5 rounded-full border border-[var(--ink)]/25 bg-[var(--ink)]/5 px-4 py-2 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/10"
            >
              <span aria-hidden>🙇</span>
              楽屋に挨拶
            </Link>
          )}
        </div>
      </div>

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setTab("answers")}
          className={
            tab === "answers"
              ? `${stadiumStyles.grainAccent} rounded-full px-4 py-1.5 font-sans text-xs font-bold text-[var(--paper)] transition`
              : "rounded-full bg-[var(--ink)]/10 px-4 py-1.5 font-sans text-xs font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/15"
          }
        >
          過去の回答（{ownAnswers.length}）
        </button>
        <button
          type="button"
          onClick={() => setTab("topics")}
          className={
            tab === "topics"
              ? `${stadiumStyles.grainAccent} rounded-full px-4 py-1.5 font-sans text-xs font-bold text-[var(--paper)] transition`
              : "rounded-full bg-[var(--ink)]/10 px-4 py-1.5 font-sans text-xs font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/15"
          }
        >
          出題したお題（{ownTopics.length}）
        </button>
      </div>

      {tab === "answers" && (
        <div className="flex flex-col gap-2">
          {ownAnswers.length === 0 && (
            <p className="text-center font-sans text-xs text-[var(--ink)]/70">
              まだ回答がありません。
            </p>
          )}
          {ownAnswers.map((answer) => {
            const topic = topics.find((t) => t.id === answer.topicId);
            return (
              <div
                key={answer.id}
                className={`${stadiumStyles.grainPaper} flex flex-col gap-1.5 rounded-xl p-3 text-[var(--ink)]`}
              >
                {topic && (
                  <Link
                    href={`/sns/${topic.id}`}
                    className="font-sans text-[11px] text-[var(--ink)]/70 hover:underline"
                  >
                    お題：{topic.body}
                  </Link>
                )}
                <Link href={`/sns/answers/${answer.id}`}>
                  <p className="font-sans text-sm font-bold text-[var(--ink)]">{answer.body}</p>
                </Link>
                <p className="flex items-center gap-1 font-sans text-[11px] text-[var(--ink)]/70">
                  <HeartGlyph filled />
                  {answer.likes.toLocaleString()}・ツッコミ{" "}
                  {commentCountByAnswer.get(answer.id) ?? 0}件
                </p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "topics" && (
        <div className="flex flex-col gap-2">
          {ownTopics.length === 0 && (
            <p className="text-center font-sans text-xs text-[var(--ink)]/70">
              まだお題を出題していません。
            </p>
          )}
          {ownTopics.map((topic) => (
            <Link
              key={topic.id}
              href={`/sns/${topic.id}`}
              className={`${stadiumStyles.grainPaper} flex flex-col gap-1 rounded-xl p-3 text-[var(--ink)]`}
            >
              <p className="font-sans text-sm font-bold text-[var(--ink)]">{topic.body}</p>
              <p className="font-sans text-[11px] text-[var(--ink)]/70">
                回答 {answers.filter((a) => a.topicId === topic.id).length}件
              </p>
            </Link>
          ))}
        </div>
      )}
    </StadiumPageShell>
  );
}
