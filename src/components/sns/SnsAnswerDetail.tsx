"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

import DeleteButton from "@/components/app/DeleteButton";
import ReportButton from "@/components/app/ReportButton";
import { HeartGlyph } from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsAuthorBadge, { reportTargetAuthorId } from "@/components/sns/SnsAuthorBadge";
import SnsBackButton from "@/components/sns/SnsBackButton";
import SnsFollowButton from "@/components/sns/SnsFollowButton";
import { computeDisplayedTickets } from "@/lib/ticketRecovery";
import { formatMinutesUntil } from "@/lib/ticketFormat";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// 回答詳細＋ツッコミ（コメント）一覧。大喜利SNS本家のAnswerDetail相当を道場流に作り直したもの。
// static export対応のため、useParamsではなくpage.tsx（generateStaticParams）からanswerIdを受け取る。
// 2026-08-28: マイページの寄合帳から来ることがほとんどのため、見た目もマイページと同じ
// 地下ライブハウス風（StadiumPageShell）に統一した。
// 2026-09-06: ツッコミ（コメント）もお題・回答と同じく寄合券を1枚消費するようにした（0058）。
// 2026-09-07: 押すと寄合券を使うことがボタンを見ただけで分かるよう、お題投稿・回答投稿と
// 同じ表示パターン（残り0枚なら送信不可＋案内文、ボタンに「（寄合券を1枚使う）」を明記）を追加。
export default function SnsAnswerDetail({ answerId }: { answerId: string }) {
  const router = useRouter();
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const likedAnswerIds = useSnsStore((s) => s.likedAnswerIds);
  const toggleLike = useSnsStore((s) => s.toggleLike);
  const addComment = useSnsStore((s) => s.addComment);
  const fetchAnswerById = useSnsStore((s) => s.fetchAnswerById);
  const profile = useProfileStore((s) => s.profile);

  const [body, setBody] = useState("");
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 2026-09-07:「ツッコむボタンでも寄合券を使うことがボタンを見ただけで分かるように」
  // の要望対応。お題投稿(sns/new/page.tsx)・回答投稿(SnsTopicDetail.tsx)と同じ
  // 表示パターン（残り枚数0なら送信不可＋案内文、ボタンに「（寄合券を1枚使う）」を明記）
  // に揃える。ツッコミが実際に寄合券を消費するようになったのは0058から。
  const displayedTickets = profile
    ? computeDisplayedTickets(profile.ticketsCount, profile.ticketsNextRecoveryAt)
    : { count: 0, nextRecoveryAt: null };
  const ticketCount = displayedTickets.count;
  const nextTicketRecoveryAt = displayedTickets.nextRecoveryAt;
  const noTicket = ticketCount <= 0;
  // 取得を試みて完了したか（true になるまでは「読み込み中」、完了してもanswerが
  // 無ければ「見つかりませんでした」を出す）。
  const [loadAttempted, setLoadAttempted] = useState(false);

  const answer = answers.find((a) => a.id === answerId);
  const topic = answer ? topics.find((t) => t.id === answer.topicId) : undefined;

  // ページネーション導入により、1ページ目のロード範囲に無い回答（直リンク・共有URL等）
  // へのアクセス時は、その場で個別に取得を試みる（対応するお題・ツッコミもまとめて取得）。
  useEffect(() => {
    if (answer) return;
    let cancelled = false;
    fetchAnswerById(answerId).finally(() => {
      if (!cancelled) setLoadAttempted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [answer, answerId, fetchAnswerById]);

  const answerComments = useMemo(
    () => comments.filter((c) => c.answerId === answerId).slice().reverse(),
    [comments, answerId],
  );

  if (!answer) {
    return (
      <StadiumPageShell contentTheme="kraft">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-sans text-sm text-[var(--ink)]/70">
            {loadAttempted ? "回答が見つかりませんでした。" : "読み込み中…"}
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await addComment(answer.id, trimmed);
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.reason);
      return;
    }
    setBody("");
  };

  // 回答自体を削除した場合、この回答の詳細ページはもう存在できないため、
  // 直前のページ（お題詳細・寄合帳等）またはマイページへ安全に戻る
  // （SnsBackButton・SnsTopicDetailのhandleTopicDeletedと同じ方針）。
  const handleAnswerDeleted = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/mypage");
    }
  };

  const handleToggleLike = async (e: MouseEvent) => {
    e.preventDefault();
    if (likePending) return;
    setLikePending(true);
    setLikeError(null);
    const result = await toggleLike(answer.id);
    setLikePending(false);
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

      {topic && (
        <Link
          href={`/sns/${topic.id}`}
          className="w-fit rounded-full bg-[var(--ink)]/10 px-3 py-1.5 font-sans text-xs font-bold text-[var(--ink)] hover:bg-[var(--ink)]/15"
        >
          お題：{topic.body}
        </Link>
      )}

      <div className={`${stadiumStyles.grainPaper} relative flex flex-col gap-3 p-5 text-[var(--ink)] shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SnsAuthorBadge authorId={answer.authorId} hideReportButton />
            <SnsFollowButton authorId={answer.authorId} size="compact" />
          </div>
          <span className="shrink-0 pr-5 font-sans text-[10px] text-[var(--ink)]/60">
            {answer.createdAtLabel}
          </span>
        </div>
        <p className="font-sans text-lg font-bold leading-snug text-[var(--ink)] sm:text-xl">
          {answer.body}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={likePending}
            onClick={handleToggleLike}
            className={`flex w-fit items-center gap-1 rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
              liked
                ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
                : "border-[var(--ink)]/25 text-[var(--ink)]/70 hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
            }`}
          >
            <HeartGlyph filled={liked} />
            <span className="tabular-nums">{answer.likes.toLocaleString()}</span>
          </button>
          {likeError && (
            <span className="font-sans text-[11px] font-bold text-[var(--accent)]">{likeError}</span>
          )}
        </div>
        {answer.authorId === "me" ? (
          <DeleteButton
            className="absolute right-4 top-1/2 -translate-y-1/2"
            targetType="sns_answer"
            targetId={answer.id}
            onDeleted={handleAnswerDeleted}
          />
        ) : (
          <ReportButton
            className="absolute right-4 top-1/2 -translate-y-1/2"
            targetType="sns_answer"
            targetId={answer.id}
            targetAuthorId={reportTargetAuthorId(answer.authorId)}
            snapshotBody={answer.body}
          />
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-2 p-4 text-[var(--ink)]`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="ツッコミを入力..."
          rows={2}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-base text-[var(--ink)] outline-none ${
            overLimit
              ? "border-[var(--accent)] focus:border-[var(--accent)]"
              : "border-[var(--ink)]/20 focus:border-[var(--accent)]"
          }`}
        />
        {noTicket && (
          <p className="font-sans text-[11px] font-bold text-[var(--accent)]">
            寄合券が0枚のためツッコめません。
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
            {submitting ? "送信中…" : "ツッコむ（寄合券を1枚使う）"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-sm font-bold text-[var(--ink)]">
          ツッコミ {answerComments.length}件
        </h2>
        {answerComments.length === 0 && (
          <p className={`${stadiumStyles.grainPaper} p-6 text-center font-sans text-xs text-[var(--ink)]/70`}>
            まだツッコミがありません。最初のツッコミを入れてみましょう。
          </p>
        )}
        {answerComments.map((comment) => (
          <div
            key={comment.id}
            className={`${stadiumStyles.grainPaper} relative flex flex-col gap-1.5 py-3 pl-4 pr-9 text-[var(--ink)]`}
          >
            <div className="flex items-center justify-between gap-2">
              <SnsAuthorBadge authorId={comment.authorId} size={24} hideReportButton />
              <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
                {comment.createdAtLabel}
              </span>
            </div>
            <p className="font-sans text-sm text-[var(--ink)]">{comment.body}</p>
            {comment.authorId === "me" ? (
              <DeleteButton
                className="absolute right-2 top-1/2 -translate-y-1/2"
                targetType="sns_comment"
                targetId={comment.id}
              />
            ) : (
              <ReportButton
                className="absolute right-2 top-1/2 -translate-y-1/2"
                targetType="sns_comment"
                targetId={comment.id}
                targetAuthorId={reportTargetAuthorId(comment.authorId)}
                snapshotBody={comment.body}
              />
            )}
          </div>
        ))}
      </div>
    </StadiumPageShell>
  );
}
