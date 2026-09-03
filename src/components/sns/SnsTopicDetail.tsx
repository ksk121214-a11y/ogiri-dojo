"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import ReportButton from "@/components/app/ReportButton";
import { HeartGlyph } from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorBadge, { reportTargetAuthorId } from "@/components/sns/SnsAuthorBadge";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { computeDisplayedTickets } from "@/lib/ticketRecovery";
import { formatMinutesUntil } from "@/lib/ticketFormat";
import { isLocallyCreated } from "@/lib/staticContent";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 80;

// お題詳細＋回答一覧。回答投稿・いいねはuseSnsStore経由でSupabaseへ実際に保存する。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からtopicIdを受け取る。
// 2026-08-28: マイページの寄合帳から来ることがほとんどのため、見た目もマイページと同じ
// 地下ライブハウス風（StadiumPageShell）に統一した。
// 2026-08-29: 回答にも寄合券を1枚消費するようにした。
// 2026-09-02: 寄合券をサーバー管理に一本化し、投稿保存に成功した場合だけ券が減る
// ようにした（submit_sns_answer RPC内で原子的に処理）。失敗時は入力内容を残す。
export default function SnsTopicDetail({ topicId }: { topicId: string }) {
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const likedAnswerIds = useSnsStore((s) => s.likedAnswerIds);
  const likePending = useSnsStore((s) => s.likePending);
  const addAnswer = useSnsStore((s) => s.addAnswer);
  const toggleLike = useSnsStore((s) => s.toggleLike);
  const fetchTopicById = useSnsStore((s) => s.fetchTopicById);
  const profile = useProfileStore((s) => s.profile);

  const [body, setBody] = useState("");
  const [likeError, setLikeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 取得を試みて完了したか（true になるまでは「読み込み中」、完了してもtopicが
  // 無ければ「見つかりませんでした」を出す）。
  const [loadAttempted, setLoadAttempted] = useState(false);

  const displayedTickets = profile
    ? computeDisplayedTickets(profile.ticketsCount, profile.ticketsNextRecoveryAt)
    : { count: 0, nextRecoveryAt: null };
  const ticketCount = displayedTickets.count;
  const nextTicketRecoveryAt = displayedTickets.nextRecoveryAt;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await addAnswer(topic.id, trimmed);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.reason);
      return;
    }
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

      <div className={`${stadiumStyles.grainPaper} relative p-5 text-[var(--ink)] shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}>
        <div className="flex items-center justify-between gap-2">
          <SnsAuthorBadge authorId={topic.authorId} hideReportButton />
          <div className="flex shrink-0 flex-col items-end gap-1 pr-5">
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
        <ReportButton
          className="absolute right-4 top-1/2 -translate-y-1/2"
          targetType="sns_topic"
          targetId={topic.id}
          targetAuthorId={reportTargetAuthorId(topic.authorId)}
          snapshotBody={topic.body}
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-2 p-4 text-[var(--ink)]`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="あなたの回答を入力..."
          rows={3}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-base text-[var(--ink)] outline-none ${
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
        {submitError && (
          <p className="font-sans text-[11px] font-bold text-[var(--accent)]">{submitError}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-sans text-[11px] ${overLimit ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!body.trim() || overLimit || noTicket || submitting}
            className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} shrink-0 rounded-full px-5 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {submitting ? "送信中…" : "回答する"}
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
          <p className={`${stadiumStyles.grainPaper} p-6 text-center font-sans text-xs text-[var(--ink)]/70`}>
            まだ回答がありません。最初の回答を投稿してみましょう。
          </p>
        )}
        {topicAnswers.map((answer) => {
          const liked = likedAnswerIds.includes(answer.id);
          const answerLinkDisabled = isLocallyCreated(answer.id);
          return (
            <div
              key={answer.id}
              className={`${stadiumStyles.grainPaper} relative flex items-start justify-between gap-3 py-3 pl-4 pr-9 text-[var(--ink)]`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <SnsAuthorBadge authorId={answer.authorId} hideReportButton />
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
                <HeartGlyph filled={liked} />
                <span className="tabular-nums">
                  {answer.likes.toLocaleString()}
                </span>
              </button>
              <ReportButton
                className="absolute right-2 top-1/2 -translate-y-1/2"
                targetType="sns_answer"
                targetId={answer.id}
                targetAuthorId={reportTargetAuthorId(answer.authorId)}
                snapshotBody={answer.body}
              />
            </div>
          );
        })}
      </div>
    </StadiumPageShell>
  );
}
