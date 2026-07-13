"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// 回答詳細＋ツッコミ（コメント）一覧。大喜利SNS本家のAnswerDetail相当を道場流に作り直したもの。
export default function SnsAnswerPage() {
  const params = useParams<{ answerId: string }>();
  const answerId = params.answerId;

  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const likedAnswerIds = useSnsStore((s) => s.likedAnswerIds);
  const toggleLike = useSnsStore((s) => s.toggleLike);
  const addComment = useSnsStore((s) => s.addComment);

  const [body, setBody] = useState("");

  const answer = answers.find((a) => a.id === answerId);
  const topic = answer ? topics.find((t) => t.id === answer.topicId) : undefined;

  const answerComments = useMemo(
    () => comments.filter((c) => c.answerId === answerId).slice().reverse(),
    [comments, answerId],
  );

  if (!answer) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-dojo-dark-brown">
          回答が見つかりませんでした。
        </p>
        <Link
          href="/sns"
          className="font-sans text-xs font-bold text-dojo-ink hover:underline"
        >
          ← 寄合帳へ戻る
        </Link>
      </div>
    );
  }

  const liked = likedAnswerIds.includes(answer.id);
  const overLimit = body.length > MAX_LENGTH;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit) return;
    addComment(answer.id, trimmed);
    setBody("");
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/sns"
        className="w-fit font-sans text-xs font-bold text-dojo-dark-brown hover:underline"
      >
        ← 寄合帳へ戻る
      </Link>

      {topic && (
        <Link
          href={`/sns/${topic.id}`}
          className="w-fit rounded-full bg-dojo-curtain-gold/20 px-3 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown hover:bg-dojo-curtain-gold/30"
        >
          お題：{topic.body}
        </Link>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SnsAuthorBadge authorId={answer.authorId} />
            <SnsFollowButton authorId={answer.authorId} size="compact" />
          </div>
          <span className="shrink-0 font-sans text-[10px] text-dojo-dark-brown">
            {answer.createdAtLabel}
          </span>
        </div>
        <p className="font-sans text-lg font-bold leading-snug text-dojo-ink sm:text-xl">
          {answer.body}
        </p>
        <button
          type="button"
          onClick={() => toggleLike(answer.id)}
          className={`flex w-fit items-center gap-1 rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 ${
            liked
              ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
              : "border-dojo-dark-brown/30 text-dojo-dark-brown hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
          }`}
        >
          {liked ? "❤" : "🤍"}
          <span className="tabular-nums">{answer.likes.toLocaleString()}</span>
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/40 p-4"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="ツッコミを入力..."
          rows={2}
          className={`w-full rounded-lg border bg-dojo-tatami-cream p-3 font-sans text-sm text-dojo-ink outline-none ${
            overLimit
              ? "border-dojo-curtain-red focus:border-dojo-curtain-red"
              : "border-dojo-dark-brown/25 focus:border-dojo-curtain-gold"
          }`}
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-sans text-[11px] ${overLimit ? "font-bold text-dojo-curtain-red" : "text-dojo-dark-brown"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!body.trim() || overLimit}
            className="shrink-0 rounded-full bg-dojo-curtain-red px-5 py-2 font-sans text-xs font-bold text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.35)] transition hover:bg-dojo-deep-crimson active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ツッコむ
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-sm font-bold text-dojo-ink">
          ツッコミ {answerComments.length}件
        </h2>
        {answerComments.length === 0 && (
          <p className="rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/40 p-6 text-center font-sans text-xs text-dojo-dark-brown">
            まだツッコミがありません。最初のツッコミを入れてみましょう。
          </p>
        )}
        {answerComments.map((comment) => (
          <div
            key={comment.id}
            className="flex flex-col gap-1.5 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <SnsAuthorBadge authorId={comment.authorId} size={24} />
              <span className="shrink-0 font-sans text-[10px] text-dojo-dark-brown">
                {comment.createdAtLabel}
              </span>
            </div>
            <p className="font-sans text-sm text-dojo-ink">{comment.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
