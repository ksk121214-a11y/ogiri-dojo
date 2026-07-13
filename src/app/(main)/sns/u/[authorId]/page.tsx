"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import { useSnsStore } from "@/store/useSnsStore";

type Tab = "answers" | "topics";

// ダミー投稿者の簡易プロフィールページ。大喜利SNS本家のProfileDetail相当を道場流に作り直したもの。
// 自分自身のプロフィールは寄合帳トップ（/sns）に直接埋め込まれているため、ここでは扱わない。
export default function SnsAuthorProfilePage() {
  const params = useParams<{ authorId: string }>();
  const authorId = params.authorId;

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
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-dojo-dark-brown">
          演者が見つかりませんでした。
        </p>
        <Link href="/sns" className="font-sans text-xs font-bold text-dojo-ink hover:underline">
          ← 寄合帳へ戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <Link
        href="/sns"
        className="w-fit font-sans text-xs font-bold text-dojo-dark-brown hover:underline"
      >
        ← 寄合帳へ戻る
      </Link>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-6 text-center">
        <span
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-3xl text-dojo-washi-white ${author.bgColorClass}`}
        >
          {author.emoji}
        </span>
        <div>
          <p className="font-brush text-2xl text-dojo-ink">{author.displayName}</p>
          <p className="mt-1 font-sans text-xs font-bold text-dojo-ink">
            段位：{author.rankLabel}
          </p>
        </div>

        <div className="flex gap-6 font-sans text-sm">
          <Link
            href={`/sns/u/${authorId}/following`}
            className="flex flex-col items-center"
          >
            <span className="font-bold text-dojo-ink">{author.followingCount}</span>
            <span className="text-[11px] text-dojo-dark-brown">フォロー中</span>
          </Link>
          <Link
            href={`/sns/u/${authorId}/followers`}
            className="flex flex-col items-center"
          >
            <span className="font-bold text-dojo-ink">{author.followerCount}</span>
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

        <SnsFollowButton authorId={authorId} />
      </div>

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={() => setTab("answers")}
          className={`rounded-full px-4 py-1.5 font-sans text-xs font-bold transition ${
            tab === "answers"
              ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
              : "bg-dojo-tatami-cream text-dojo-dark-brown hover:bg-dojo-light-brown"
          }`}
        >
          過去の回答（{ownAnswers.length}）
        </button>
        <button
          type="button"
          onClick={() => setTab("topics")}
          className={`rounded-full px-4 py-1.5 font-sans text-xs font-bold transition ${
            tab === "topics"
              ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
              : "bg-dojo-tatami-cream text-dojo-dark-brown hover:bg-dojo-light-brown"
          }`}
        >
          出題したお題（{ownTopics.length}）
        </button>
      </div>

      {tab === "answers" && (
        <div className="flex flex-col gap-2">
          {ownAnswers.length === 0 && (
            <p className="text-center font-sans text-xs text-dojo-dark-brown">
              まだ回答がありません。
            </p>
          )}
          {ownAnswers.map((answer) => {
            const topic = topics.find((t) => t.id === answer.topicId);
            return (
              <div
                key={answer.id}
                className="flex flex-col gap-1.5 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 p-3"
              >
                {topic && (
                  <Link
                    href={`/sns/${topic.id}`}
                    className="font-sans text-[11px] text-dojo-dark-brown hover:underline"
                  >
                    お題：{topic.body}
                  </Link>
                )}
                <Link href={`/sns/answers/${answer.id}`}>
                  <p className="font-sans text-sm font-bold text-dojo-ink">{answer.body}</p>
                </Link>
                <p className="font-sans text-[11px] text-dojo-dark-brown">
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
            <p className="text-center font-sans text-xs text-dojo-dark-brown">
              まだお題を出題していません。
            </p>
          )}
          {ownTopics.map((topic) => (
            <Link
              key={topic.id}
              href={`/sns/${topic.id}`}
              className="flex flex-col gap-1 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 p-3"
            >
              <p className="font-sans text-sm font-bold text-dojo-ink">{topic.body}</p>
              <p className="font-sans text-[11px] text-dojo-dark-brown">
                回答 {answers.filter((a) => a.topicId === topic.id).length}件
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
