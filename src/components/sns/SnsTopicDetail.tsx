"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { formatMinutesUntil } from "@/lib/ticketFormat";
import { isLocallyCreated } from "@/lib/staticContent";
import { useSnsStore } from "@/store/useSnsStore";
import { useTicketStore } from "@/store/useTicketStore";

const MAX_LENGTH = 80;

// お題詳細＋回答一覧。回答投稿・いいねはuseSnsStoreのダミー状態に即時反映する。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からtopicIdを受け取る。
// 2026-08-28: マイページの寄合帳から来ることがほとんどのため、見た目もマイページと同じ
// 地下ライブハウス風（StadiumPageShell）に統一した。
// 2026-08-29: 回答にも寄合券を1枚消費するようにした（§useTicketStore）。
export default function SnsTopicDetail({ topicId }: { topicId: string }) {
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const likedAnswerIds = useSnsStore((s) => s.likedAnswerIds);
  const likePending = useSnsStore((s) => s.likePending);
  const addAnswer = useSnsStore((s) => s.addAnswer);
  const toggleLike = useSnsStore((s) => s.toggleLike);
  const fetchTopicById = useSnsStore((s) => s.fetchTopicById);

  const [body, setBody] = useState("");
  const [likeError, setLikeError] = useState<string | null>(null);
  // 取得を試みて完了したか（true になるまでは「読み込み中」、完了してもtopicが
  // 無ければ「見つかりませんでした」を出す）。
  const [loadAttempted, setLoadAttempted] = useState(false);

  const ticketCount = useTicketStore((s) => s.count);
  const nextTicketRecoveryAt = useTicketStore((s) => s.nextRecoveryAt);
  const recalculateTickets = useTicketStore((s) => s.recalculate);
  const consumeTicket = useTicketStore((s) => s.consume);

  useEffect(() => {
    recalculateTickets();
  }, [recalculateTickets]);

  const topic = topics.find((t) => t.id === topicId);

  // ページネーション導入により、1ページ目のロード範囲に無いお題（直リンク・共有URL経由等）
  // へのアクセス時は、その場で個別に取得を試みる。
  useEffect(() => {
    if (topic) return;
    let cancelled = false;
    fetchTopicById(topicId).finally(() => {
      if (!cancelled) setLoadAttempted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, topicId, fetchTopicById]);

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
      <StadiumPageShell contentTheme="kraft">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-sans text-sm text-[var(--ink)]/70">
            {loadAttempted ? "お題が見つかりませんでした。" : "読み込み中…"}
          </p>
          <SnsBackButton
            fallbackHref="/mypage"
            className="font-sans text-xs font-bold text-[var(--ink)] hover:underline"
          />
        </div>
      </StadiumPageShell>
    );
  }

  const overLimit = body.length > MAX_LENGTH;
  const noTicket = ticketCount <= 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit) return;
    if (!consumeTicket()) return;
    addAnswer(topic.id, trimmed);
    setBody("");
  };

  const handleToggleLike = async (answerId: string) => {
    if (likePending[answerId]) return;
    const result = await toggleLike(answerId);
    if (!result.ok && result.message) {
      setLikeError(result.message);
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton
        fallbackHref="/mypage"
        className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
      />

      <div className={`${stadiumStyles.grainPaper} rounded-2xl p-5 text-[var(--ink)] shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}>
        <div className="flex items-center justify-between gap-2">
          <SnsAuthorBadge
            authorId={topic.authorId}
            reportTarget={{ type: "sns_topic", id: topic.id, body: topic.body }}
          />
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`${stadiumStyles.grainAccent} rounded-full px-3 py-1 font-sans text-[10px] font-bold text-[var(--paper)]`}>
              お題
            </span>
            <span className="font-sans text-[10px] text-[var(--ink)]/60">
              {topic.createdAtLabel}
            </span>
          </div>
        </div>
        <p className="mt-3 font-sans text-lg font-bold leading-snug text-[var(--ink)] sm:text-xl">
          {topic.body}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-2 rounded-2xl p-4 text-[var(--ink)]`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="あなたの回答を入力..."
          rows={3}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-sm text-[var(--ink)] outline-none ${
            overLimit
              ? "border-[var(--accent)] focus:border-[var(--accent)]"
              : "border-[var(--ink)]/20 focus:border-[var(--accent)]"
          }`}
        />
        {noTicket && (
          <p className="font-sans text-[11px] font-bold text-[var(--accent)]">
            寄合券が0枚のため回答できません。
            {nextTicketRecoveryAt && `あと${formatMinutesUntil(nextTicketRecoveryAt)}分で1枚回復します。`}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-sans text-[11px] ${overLimit ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!body.trim() || overLimit || noTicket}
            className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} shrink-0 rounded-full px-5 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            回答する
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-sm font-bold text-[var(--ink)]">
          回答 {topicAnswers.length}件
        </h2>
        {likeError && (
          <p className="font-sans text-[11px] font-bold text-[var(--accent)]">{likeError}</p>
        )}
        {topicAnswers.length === 0 && (
          <p className={`${stadiumStyles.grainPaper} rounded-xl p-6 text-center font-sans text-xs text-[var(--ink)]/70`}>
            まだ回答がありません。最初の回答を投稿してみましょう。
          </p>
        )}
        {topicAnswers.map((answer) => {
          const liked = likedAnswerIds.includes(answer.id);
          const answerLinkDisabled = isLocallyCreated(answer.id);
          return (
            <div
              key={answer.id}
              className={`${stadiumStyles.grainPaper} flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-[var(--ink)]`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <SnsAuthorBadge
                    authorId={answer.authorId}
                    reportTarget={{ type: "sns_answer", id: answer.id, body: answer.body }}
                  />
                  <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
                    {answer.createdAtLabel}
                  </span>
                </div>
                {answerLinkDisabled ? (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="font-sans text-sm text-[var(--ink)]">
                      {answer.body}
                    </p>
                    <p className="font-sans text-[11px] text-[var(--ink)]/70">
                      ツッコミ {commentCountByAnswer.get(answer.id) ?? 0}件
                    </p>
                  </div>
                ) : (
                  <Link href={`/sns/answers/${answer.id}`} className="mt-2 flex flex-col gap-1">
                    <p className="font-sans text-sm text-[var(--ink)]">
                      {answer.body}
                    </p>
                    <p className="font-sans text-[11px] text-[var(--ink)]/70 hover:underline">
                      ツッコミ {commentCountByAnswer.get(answer.id) ?? 0}件 →
                    </p>
                  </Link>
                )}
              </div>
              <button
                type="button"
                disabled={likePending[answer.id]}
                onClick={() => handleToggleLike(answer.id)}
                className={`mt-1 flex shrink-0 items-center gap-1 self-start rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                  liked
                    ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
                    : "border-[var(--ink)]/25 text-[var(--ink)]/70 hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
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
    </StadiumPageShell>
  );
}
