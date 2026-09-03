"use client";

import { useState } from "react";
import type { MouseEvent } from "react";

import ReportButton from "@/components/app/ReportButton";
import XShareButton from "@/components/app/XShareButton";
import { HeartGlyph } from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import SnsAuthorBadge, { reportTargetAuthorId } from "@/components/sns/SnsAuthorBadge";
import { APP_NAME } from "@/lib/appInfo";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";
import type { SnsLiveResultAnswerCard, SnsLiveResultDetail, SnsLiveResultLabel } from "@/types/snsLiveResults";

const MAX_COMMENT_LENGTH = 60;

// 金・銀・銅・運営ベスト（赤）・満点（星）のラベル見た目。
const LABEL_STYLE: Record<SnsLiveResultLabel, { text: string; className: string }> = {
  rank1: { text: "1位代表", className: "bg-dojo-curtain-gold text-[#3a2a05]" },
  rank2: { text: "2位代表", className: "bg-[#c7c7cf] text-[#2c2c31]" },
  rank3: { text: "3位代表", className: "bg-[#b08d57] text-[#2c2013]" },
  managerBest: { text: "運営ベスト", className: "bg-dojo-curtain-red text-[var(--paper)]" },
  perfect: { text: "満点", className: "bg-[#2e2a24] text-dojo-curtain-gold" },
};

// 順位ごとのカード縁取り（金/銀/銅を控えめに）。ラベル無し（運営ベスト単体等）は縁取りしない。
const RANK_BORDER: Record<1 | 2 | 3, string> = {
  1: "border-2 border-dojo-curtain-gold",
  2: "border-2 border-[#c7c7cf]",
  3: "border-2 border-[#b08d57]",
};

// 寄合帳「ライブ結果」の本体表示。公開ページ・運営プレビューの両方から使う共通コンポーネント。
// readOnly=trueの場合はいいね・コメントの投稿UIを出さず、件数のみの静的表示にする
// （運営プレビューは「実際の表示と同じ並び・ラベル」を見るためのものであり、
// ここから操作させる必要は無いため）。
export default function SnsLiveResultBody({
  detail,
  readOnly = false,
}: {
  detail: SnsLiveResultDetail;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <span className={`${stadiumStyles.grainAccent} inline-block rounded-full px-3 py-1 font-sans text-[11px] font-bold text-[var(--paper)]`}>
          公式ライブ結果
        </span>
        <h1 className="mt-2 font-sans text-xl font-black text-[var(--ink)]">
          {formatLiveTicketNo(detail.sequenceNumber)}
          {detail.title ? `　${detail.title}` : ""}
        </h1>
        <p className="mt-1 font-sans text-xs text-[var(--ink)]/60">{detail.endedAtLabel}</p>
        {!readOnly && (
          <div className="mt-3 flex justify-center">
            <XShareButton
              context="live_result"
              label="結果をXでシェア"
              text={`${formatLiveTicketNo(detail.sequenceNumber)}${detail.title ? `　${detail.title}` : ""}の結果発表！\n#${APP_NAME}`}
            />
          </div>
        )}
      </div>

      {detail.podium.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-sans text-sm font-bold text-[var(--ink)]">1〜3位 最高得点回答</h2>
          {detail.podium.map((group) => (
            <div key={group.rank} className="flex flex-col gap-2">
              {group.cards.map((card) => (
                <LiveResultCard key={card.resultAnswerId} card={card} rank={group.rank} readOnly={readOnly} />
              ))}
            </div>
          ))}
        </section>
      )}

      {detail.managerBest && (
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-bold text-[var(--ink)]">運営ベスト</h2>
          <LiveResultCard card={detail.managerBest} readOnly={readOnly} />
          {detail.managerComment && (
            <p className={`${stadiumStyles.grainPaper} p-3 font-sans text-xs text-[var(--ink)]/80`}>
              運営コメント：{detail.managerComment}
            </p>
          )}
        </section>
      )}

      {detail.perfect.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-sm font-bold text-[var(--ink)]">満点回答</h2>
          {detail.perfect.map((card) => (
            <LiveResultCard key={card.resultAnswerId} card={card} readOnly={readOnly} />
          ))}
        </section>
      )}
    </div>
  );
}

function LiveResultCard({
  card,
  rank,
  readOnly,
}: {
  card: SnsLiveResultAnswerCard;
  rank?: 1 | 2 | 3;
  readOnly: boolean;
}) {
  const toggleLike = useSnsLiveResultsStore((s) => s.toggleLike);
  const addComment = useSnsLiveResultsStore((s) => s.addComment);
  // このカードのresultAnswerIdに紐づくコメントを、いま開いている詳細キャッシュ全体
  // （複数のライブ結果を見た場合はその全部）から拾う。
  const allDetails = useSnsLiveResultsStore((s) => s.details);
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);

  const handleToggleLike = async (e: MouseEvent) => {
    e.preventDefault();
    if (readOnly || likePending) return;
    setLikePending(true);
    setLikeError(null);
    const result = await toggleLike(card.resultAnswerId);
    setLikePending(false);
    if (!result.ok && result.message) {
      setLikeError(result.message);
      setTimeout(() => setLikeError(null), 3000);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentBody.trim();
    if (!trimmed || trimmed.length > MAX_COMMENT_LENGTH) return;
    const result = await addComment(card.resultAnswerId, trimmed);
    if (result.ok) setCommentBody("");
  };

  const cardComments = Object.values(allDetails)
    .flatMap((d) => d.comments[card.resultAnswerId] ?? [])
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);

  return (
    <div
      className={`${stadiumStyles.grainPaper} relative flex flex-col gap-2 p-4 text-[var(--ink)] sm:p-5 ${
        rank ? RANK_BORDER[rank] : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {card.labels.map((label) => (
          <span
            key={label}
            className={`rounded-full px-2.5 py-1 font-sans text-[10px] font-bold ${LABEL_STYLE[label].className}`}
          >
            {LABEL_STYLE[label].text}
          </span>
        ))}
        <span className="ml-auto font-sans text-xs font-bold text-[var(--ink)]/70">{card.score}点</span>
      </div>
      <SnsAuthorBadge authorId={card.authorId} hideReportButton />
      {card.topicBody && (
        <p className="w-fit rounded-full bg-[var(--ink)]/10 px-2.5 py-1 font-sans text-[10px] font-bold text-[var(--ink)]">
          お題：{card.topicBody}
        </p>
      )}
      <p className="font-sans text-base font-bold leading-snug text-[var(--ink)] sm:text-lg">{card.body}</p>

      {readOnly ? (
        <p className="flex items-center gap-3 font-sans text-[11px] text-[var(--ink)]/60">
          <span className="flex items-center gap-1">
            <HeartGlyph filled />
            {card.likes.toLocaleString()}
          </span>
          <span>コメント {card.commentCount}件</span>
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={likePending}
              onClick={handleToggleLike}
              className={`flex items-center gap-1 rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                card.liked
                  ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
                  : "border-[var(--ink)]/25 text-[var(--ink)]/70 hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
              }`}
            >
              <HeartGlyph filled={card.liked} />
              <span className="tabular-nums">{card.likes.toLocaleString()}</span>
            </button>
            <button
              type="button"
              onClick={() => setCommentsOpen((v) => !v)}
              className="font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
            >
              コメント {card.commentCount}件
            </button>
            {likeError && <span className="font-sans text-[11px] font-bold text-[var(--accent)]">{likeError}</span>}
          </div>

          {commentsOpen && (
            <div className="flex flex-col gap-2 border-t border-[var(--ink)]/10 pt-2">
              {cardComments.length === 0 && (
                <p className="font-sans text-[11px] text-[var(--ink)]/60">まだコメントがありません。</p>
              )}
              {cardComments.map((comment) => (
                <div
                  key={comment.id}
                  className="relative flex flex-col gap-1 bg-[var(--ink)]/5 py-2 pl-3 pr-9"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SnsAuthorBadge authorId={comment.authorId} size={22} hideReportButton />
                    <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
                      {comment.createdAtLabel}
                    </span>
                  </div>
                  <p className="font-sans text-sm text-[var(--ink)]">{comment.body}</p>
                  <ReportButton
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    targetType="live_result_comment"
                    targetId={comment.id}
                    targetAuthorId={reportTargetAuthorId(comment.authorId)}
                    snapshotBody={comment.body}
                  />
                </div>
              ))}
              <form onSubmit={handleSubmitComment} className="flex flex-col gap-1.5">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="コメントを入力..."
                  rows={2}
                  className="w-full rounded-lg border border-[var(--ink)]/20 bg-[var(--paper-muted)] p-2.5 font-sans text-base text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[11px] text-[var(--ink)]/60">
                    {commentBody.length} / {MAX_COMMENT_LENGTH}
                  </span>
                  <button
                    type="submit"
                    disabled={!commentBody.trim() || commentBody.length > MAX_COMMENT_LENGTH}
                    className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} shrink-0 rounded-full px-4 py-1.5 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    コメントする
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
