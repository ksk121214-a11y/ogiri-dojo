"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import ReportButton from "@/components/app/ReportButton";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import { useSnsStore } from "@/store/useSnsStore";

type Tab = "answers" | "topics";

// ダミー投稿者の簡易プロフィールページ。大喜利SNS本家のProfileDetail相当を道場流に作り直したもの。
// 自分自身のプロフィールは寄合帳トップ（/sns）に直接埋め込まれているため、ここでは扱わない。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からauthorIdを受け取る。
// なお、ここに表示するお題/回答はダミー投稿者(authorId)のものに限られ、ブラウザ上で
// ローカル作成されるお題/回答は必ずauthorId==="me"になるため、このページには現れない
// （isLocallyCreatedによるリンク無効化は不要）。
// 2026-08-30: 寄合帳全体を新デザイン（StadiumPageShell）に統一した。
export default function SnsAuthorProfile({ authorId }: { authorId: string }) {
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);

  const [tab, setTab] = useState<Tab>("answers");

  const author = getDummySnsAuthor(authorId);

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
        <span className="flex h-16 w-16 shrink-0 items-center justify-center text-5xl">
          {author.emoji}
        </span>
        <div>
          <p className="font-sans text-2xl font-black text-[var(--ink)]">{author.displayName}</p>
          <p className="mt-1 font-sans text-xs font-bold text-[var(--ink)]">
            段位：{author.rankLabel}
          </p>
        </div>

        <div className="flex gap-6 font-sans text-sm">
          <Link href={`/sns/u/${authorId}/following`} className="flex flex-col items-center">
            <span className="font-bold text-[var(--ink)]">{author.followingCount}</span>
            <span className="text-[11px] text-[var(--ink)]/70">フォロー中</span>
          </Link>
          <Link href={`/sns/u/${authorId}/followers`} className="flex flex-col items-center">
            <span className="font-bold text-[var(--ink)]">{author.followerCount}</span>
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

        <div className="flex flex-wrap items-center justify-center gap-2">
          <SnsFollowButton authorId={authorId} />
          <Link
            href={`/sns/u/${authorId}/backstage`}
            className="flex items-center gap-1.5 rounded-full border border-[var(--ink)]/25 bg-[var(--ink)]/5 px-4 py-2 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/10"
          >
            <span aria-hidden>🙇</span>
            楽屋に挨拶
          </Link>
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
                <p className="font-sans text-[11px] text-[var(--ink)]/70">
                  ❤ {answer.likes.toLocaleString()}・ツッコミ{" "}
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
