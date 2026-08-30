"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// 回答詳細＋ツッコミ（コメント）一覧。大喜利SNS本家のAnswerDetail相当を道場流に作り直したもの。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からanswerIdを受け取る。
// 2026-08-28: マイページの寄合帳から来ることがほとんどのため、見た目もマイページと同じ
// 地下ライブハウス風（StadiumPageShell）に統一した。
export default function SnsAnswerDetail({ answerId }: { answerId: string }) {
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
      <StadiumPageShell contentTheme="kraft">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-sans text-sm text-[var(--ink)]/70">
            回答が見つかりませんでした。
          </p>
          <SnsBackButton
            fallbackHref="/mypage"
            className="font-sans text-xs font-bold text-[var(--ink)] hover:underline"
          />
        </div>
      </StadiumPageShell>
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
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton
        fallbackHref="/mypage"
        className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
      />

      {topic && (
        <Link
          href={`/sns/${topic.id}`}
          className="w-fit rounded-full bg-[var(--ink)]/10 px-3 py-1.5 font-sans text-xs font-bold text-[var(--ink)] hover:bg-[var(--ink)]/15"
        >
          お題：{topic.body}
        </Link>
      )}

      <div className={`${stadiumStyles.grainPaper} flex flex-col gap-3 rounded-2xl p-5 text-[var(--ink)] shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SnsAuthorBadge
              authorId={answer.authorId}
              reportTarget={{ type: "sns_answer", id: answer.id, body: answer.body }}
            />
            <SnsFollowButton authorId={answer.authorId} size="compact" />
          </div>
          <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
            {answer.createdAtLabel}
          </span>
        </div>
        <p className="font-sans text-lg font-bold leading-snug text-[var(--ink)] sm:text-xl">
          {answer.body}
        </p>
        <button
          type="button"
          onClick={() => toggleLike(answer.id)}
          className={`flex w-fit items-center gap-1 rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 ${
            liked
              ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
              : "border-[var(--ink)]/25 text-[var(--ink)]/70 hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
          }`}
        >
          {liked ? "❤" : "🤍"}
          <span className="tabular-nums">{answer.likes.toLocaleString()}</span>
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-2 rounded-2xl p-4 text-[var(--ink)]`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="ツッコミを入力..."
          rows={2}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-sm text-[var(--ink)] outline-none ${
            overLimit
              ? "border-[var(--accent)] focus:border-[var(--accent)]"
              : "border-[var(--ink)]/20 focus:border-[var(--accent)]"
          }`}
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-sans text-[11px] ${overLimit ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!body.trim() || overLimit}
            className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} shrink-0 rounded-full px-5 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            ツッコむ
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-sm font-bold text-[var(--ink)]">
          ツッコミ {answerComments.length}件
        </h2>
        {answerComments.length === 0 && (
          <p className={`${stadiumStyles.grainPaper} rounded-xl p-6 text-center font-sans text-xs text-[var(--ink)]/70`}>
            まだツッコミがありません。最初のツッコミを入れてみましょう。
          </p>
        )}
        {answerComments.map((comment) => (
          <div
            key={comment.id}
            className={`${stadiumStyles.grainPaper} flex flex-col gap-1.5 rounded-xl px-4 py-3 text-[var(--ink)]`}
          >
            <div className="flex items-center justify-between gap-2">
              <SnsAuthorBadge
                authorId={comment.authorId}
                size={24}
                reportTarget={{ type: "sns_comment", id: comment.id, body: comment.body }}
              />
              <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
                {comment.createdAtLabel}
              </span>
            </div>
            <p className="font-sans text-sm text-[var(--ink)]">{comment.body}</p>
          </div>
        ))}
      </div>
    </StadiumPageShell>
  );
}
