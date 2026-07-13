"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 80;

// お題詳細＋回答一覧。回答投稿・いいねはuseSnsStoreのダミー状態に即時反映する。
export default function SnsTopicPage() {
  const params = useParams<{ topicId: string }>();
  const topicId = params.topicId;

  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const likedAnswerIds = useSnsStore((s) => s.likedAnswerIds);
  const addAnswer = useSnsStore((s) => s.addAnswer);
  const toggleLike = useSnsStore((s) => s.toggleLike);

  const [body, setBody] = useState("");

  const topic = topics.find((t) => t.id === topicId);

  const topicAnswers = useMemo(
    () =>
      answers
        .filter((a) => a.topicId === topicId)
        .sort((a, b) => b.likes - a.likes),
    [answers, topicId],
  );

  const commentCountByAnswer = useMemo(() => {
    const map = new Map<string, number>();
    for (const comment of comments) {
      map.set(comment.answerId, (map.get(comment.answerId) ?? 0) + 1);
    }
    return map;
  }, [comments]);

  if (!topic) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-dojo-dark-brown">
          お題が見つかりませんでした。
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

  const overLimit = body.length > MAX_LENGTH;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit) return;
    addAnswer(topic.id, trimmed);
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

      <div className="rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/70 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <SnsAuthorBadge authorId={topic.authorId} />
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-dojo-curtain-red px-3 py-1 font-sans text-[10px] font-bold text-dojo-washi-white">
              お題
            </span>
            <span className="font-sans text-[10px] text-dojo-dark-brown">
              {topic.createdAtLabel}
            </span>
          </div>
        </div>
        <p className="mt-3 font-sans text-lg font-bold leading-snug text-dojo-ink sm:text-xl">
          {topic.body}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-dojo-dark-brown/20 bg-dojo-light-brown/40 p-4"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="あなたの回答を入力..."
          rows={3}
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
            回答する
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-sm font-bold text-dojo-ink">
          回答 {topicAnswers.length}件
        </h2>
        {topicAnswers.length === 0 && (
          <p className="rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/40 p-6 text-center font-sans text-xs text-dojo-dark-brown">
            まだ回答がありません。最初の回答を投稿してみましょう。
          </p>
        )}
        {topicAnswers.map((answer) => {
          const liked = likedAnswerIds.includes(answer.id);
          return (
            <div
              key={answer.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-dojo-dark-brown/15 bg-dojo-light-brown/60 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <SnsAuthorBadge authorId={answer.authorId} />
                  <span className="shrink-0 font-sans text-[10px] text-dojo-dark-brown">
                    {answer.createdAtLabel}
                  </span>
                </div>
                <Link href={`/sns/answers/${answer.id}`} className="mt-2 flex flex-col gap-1">
                  <p className="font-sans text-sm text-dojo-ink">
                    {answer.body}
                  </p>
                  <p className="font-sans text-[11px] text-dojo-dark-brown hover:underline">
                    ツッコミ {commentCountByAnswer.get(answer.id) ?? 0}件 →
                  </p>
                </Link>
              </div>
              <button
                type="button"
                onClick={() => toggleLike(answer.id)}
                className={`mt-1 flex shrink-0 items-center gap-1 self-start rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 ${
                  liked
                    ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
                    : "border-dojo-dark-brown/30 text-dojo-dark-brown hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
                }`}
              >
                {liked ? "❤" : "🤍"}
                <span className="tabular-nums">
                  {answer.likes.toLocaleString()}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
