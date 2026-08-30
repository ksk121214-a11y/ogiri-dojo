"use client";

import Link from "next/link";
import { useEffect } from "react";

import { HeartGlyph } from "@/components/home/icons";
import stadiumStyles from "@/components/home/StadiumHome.module.css";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";

// 寄合帳「ライブ結果」タブの一覧。終了済み・SNS公開済みのライブ結果を新しい順に
// カード表示する。詳細はすべて展開せず、概要（1位最高得点回答・満点件数・
// いいね数・コメント数）のみ表示し、「結果を見る」で詳細ページへ。
export default function SnsLiveResultsFeedList() {
  const summaries = useSnsLiveResultsStore((s) => s.summaries);
  const loading = useSnsLiveResultsStore((s) => s.loading);
  const hasMore = useSnsLiveResultsStore((s) => s.hasMore);
  const loadingMore = useSnsLiveResultsStore((s) => s.loadingMore);
  const init = useSnsLiveResultsStore((s) => s.init);
  const loadMore = useSnsLiveResultsStore((s) => s.loadMore);

  useEffect(() => {
    init();
  }, [init]);

  if (loading) {
    return <p className="py-10 text-center font-sans text-xs text-[var(--ink)]/60">読み込み中…</p>;
  }

  if (summaries.length === 0) {
    return (
      <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center text-[var(--ink)]`}>
        <p className="font-sans text-sm font-bold text-[var(--ink)]">まだ公開されたライブ結果はありません</p>
        <p className="font-sans text-xs text-[var(--ink)]/70">
          ライブが終了し、運営が結果を公開するとここに表示されます
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {summaries.map((summary) => (
        <Link
          key={summary.id}
          href={`/sns/results/${summary.id}`}
          className={`${stadiumStyles.grainPaper} flex flex-col gap-2 rounded-2xl p-4 text-[var(--ink)] transition sm:p-5`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`${stadiumStyles.grainAccent} rounded-full px-2.5 py-1 font-sans text-[10px] font-bold text-[var(--paper)]`}>
              公式ライブ結果
            </span>
            <span className="font-sans text-[10px] text-[var(--ink)]/60">{summary.endedAtLabel}</span>
          </div>
          <p className="font-sans text-base font-black text-[var(--ink)]">
            {formatLiveTicketNo(summary.sequenceNumber)}
            {summary.title ? `　${summary.title}` : ""}
          </p>
          {summary.podiumNames.length > 0 && (
            <p className="flex flex-wrap gap-x-3 font-sans text-sm text-[var(--ink)]/85">
              {summary.podiumNames.map(({ rank, name }) => (
                <span key={rank}>
                  {rank}位：{name}
                </span>
              ))}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-3 font-sans text-[11px] text-[var(--ink)]/70">
            {summary.perfectCount > 0 && <span>満点 {summary.perfectCount}件</span>}
            <span className="flex items-center gap-1">
              <HeartGlyph filled />
              {summary.likeCount.toLocaleString()}
            </span>
            <span>コメント {summary.commentCount}件</span>
          </p>
          <span className="w-fit rounded-full border border-[var(--ink)]/25 px-4 py-1.5 font-sans text-xs font-bold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
            結果を見る →
          </span>
        </Link>
      ))}
      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMore}
            onClick={loadMore}
            className="rounded-full border border-[var(--ink)]/25 bg-[var(--ink)]/5 px-6 py-2 font-sans text-xs font-bold text-[var(--ink)] transition hover:bg-[var(--ink)]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "読み込み中…" : "もっと見る"}
          </button>
        </div>
      )}
    </div>
  );
}
