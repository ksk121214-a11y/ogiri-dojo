"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import { isLocallyCreated } from "@/lib/staticContent";
import { useSnsStore } from "@/store/useSnsStore";
import type { SnsAnswer, SnsTopic } from "@/types/sns";

type FeedKind = "topics" | "answers";
type AudienceKind = "forYou" | "following";
type SortKind = "new" | "popular";

const FEED_TABS: { key: FeedKind; label: string }[] = [
  { key: "topics", label: "お題" },
  { key: "answers", label: "回答" },
];

const AUDIENCE_TABS: { key: AudienceKind; label: string }[] = [
  { key: "forYou", label: "おすすめ" },
  { key: "following", label: "フォロー中" },
];

const SORT_TABS: { key: SortKind; label: string }[] = [
  { key: "new", label: "新着" },
  { key: "popular", label: "人気" },
];

// 寄合帳（/sns、/mypage内）のフィード本体（投稿ボタン＋タブ＋一覧）だけを切り出したもの。
// 2026-08-28: マイページの地下ライブハウス風トンマナに合わせた見せ方を追加した際は
// variant="dojo"|"stadium"の二重実装にしていたが、2026-08-30に寄合帳全体を新デザインへ
// 統一したことで旧デザイン（variant="dojo"）を使う画面が無くなったため、分岐ごと削除し
// 常にこのトンマナ（ホームのチケット意匠＝.grainPaper等）で表示する。
export default function SnsFeedSection() {
  const topics = useSnsStore((s) => s.topics);
  const answers = useSnsStore((s) => s.answers);
  const comments = useSnsStore((s) => s.comments);
  const followingAuthorIds = useSnsStore((s) => s.followingAuthorIds);

  const [feed, setFeed] = useState<FeedKind>("topics");
  const [audience, setAudience] = useState<AudienceKind>("forYou");
  const [sort, setSort] = useState<SortKind>("new");

  const answerCountByTopic = useMemo(() => {
    const map = new Map<string, number>();
    for (const answer of answers) {
      map.set(answer.topicId, (map.get(answer.topicId) ?? 0) + 1);
    }
    return map;
  }, [answers]);

  const commentCountByAnswer = useMemo(() => {
    const map = new Map<string, number>();
    for (const comment of comments) {
      map.set(comment.answerId, (map.get(comment.answerId) ?? 0) + 1);
    }
    return map;
  }, [comments]);

  const visibleTopics = useMemo(() => {
    // topicsは新規投稿がaddTopicで先頭に追加される配列のため、そのままの並びが新着順になる。
    const base =
      audience === "forYou"
        ? topics
        : topics.filter((t) => t.authorId === "me" || followingAuthorIds.includes(t.authorId));
    if (sort !== "popular") return base;
    return [...base].sort(
      (a, b) => (answerCountByTopic.get(b.id) ?? 0) - (answerCountByTopic.get(a.id) ?? 0),
    );
  }, [topics, audience, sort, answerCountByTopic, followingAuthorIds]);

  const visibleAnswers = useMemo(() => {
    // answersはaddAnswerで末尾に追加される配列のため、新着順にするには逆順にする必要がある。
    const newestFirst = [...answers].reverse();
    const base =
      audience === "forYou"
        ? newestFirst
        : newestFirst.filter((a) => a.authorId === "me" || followingAuthorIds.includes(a.authorId));
    if (sort !== "popular") return base;
    return [...base].sort((a, b) => b.likes - a.likes);
  }, [answers, audience, sort, followingAuthorIds]);

  const currentCount = feed === "topics" ? visibleTopics.length : visibleAnswers.length;
  const showFollowingEmpty = audience === "following" && currentCount === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <Link
          href="/sns/new"
          className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} ${stadiumStyles.tornBanner} flex w-full items-center justify-center gap-2.5 px-6 py-5 font-sans text-xl font-black text-[var(--paper)] transition hover:opacity-95`}
        >
          <span aria-hidden>✎</span>
          お題を投稿する
        </Link>
      </div>

      <div className={`${stadiumStyles.grainPaper} flex flex-col gap-3 rounded-2xl p-3 text-[var(--ink)] sm:p-4`}>
        <div className="flex justify-center gap-6 border-b border-[var(--ink)]/15 pb-2.5">
          {FEED_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFeed(tab.key)}
              className={`border-b-2 pb-1 font-sans text-sm font-bold transition ${
                feed === tab.key
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--ink)]/55 hover:text-[var(--ink)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-xs gap-2 border-b border-[var(--ink)]/10 pb-2">
          {AUDIENCE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setAudience(tab.key)}
              className={`flex-1 border-b-2 px-3 py-1.5 font-sans text-xs font-bold transition ${
                audience === tab.key
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--ink)]/55 hover:text-[var(--ink)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex justify-center gap-2">
          {SORT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSort(tab.key)}
              className={`rounded-full px-3 py-1 font-sans text-[11px] font-bold transition ${
                sort === tab.key
                  ? "border border-[var(--accent)] text-[var(--accent)]"
                  : "border border-transparent text-[var(--ink)]/50 hover:text-[var(--ink)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {showFollowingEmpty ? (
        <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center text-[var(--ink)]`}>
          <span className="text-3xl">🥋</span>
          <p className="font-sans text-sm font-bold text-[var(--ink)]">
            フォロー中の演者の投稿はまだありません
          </p>
          <p className="font-sans text-xs text-[var(--ink)]/70">
            気になる演者をフォローすると、ここに投稿が表示されます
          </p>
          <button
            type="button"
            onClick={() => setAudience("forYou")}
            className={`${stadiumStyles.grainAccent} mt-2 rounded-full px-5 py-2 font-sans text-xs font-bold text-[var(--paper)] transition active:scale-95`}
          >
            おすすめを見る
          </button>
        </div>
      ) : feed === "topics" ? (
        <TopicFeedList topics={visibleTopics} answerCountByTopic={answerCountByTopic} />
      ) : (
        <AnswerFeedList
          answers={visibleAnswers}
          topics={topics}
          commentCountByAnswer={commentCountByAnswer}
        />
      )}
    </div>
  );
}

function TopicFeedList({
  topics,
  answerCountByTopic,
}: {
  topics: SnsTopic[];
  answerCountByTopic: Map<string, number>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {topics.map((topic) => {
        const linkDisabled = isLocallyCreated(topic.id);
        const body = (
          <>
            <p className="font-sans text-base font-bold leading-snug text-[var(--ink)] sm:text-lg">
              {topic.body}
            </p>
            <p className="font-sans text-xs text-[var(--ink)]/70">
              回答 {answerCountByTopic.get(topic.id) ?? 0}件
            </p>
          </>
        );
        return (
          <div
            key={topic.id}
            className={`${stadiumStyles.grainPaper} flex flex-col gap-2 rounded-2xl p-4 text-[var(--ink)] transition sm:p-5`}
          >
            <div className="flex items-center justify-between gap-2">
              <SnsAuthorBadge
                authorId={topic.authorId}
                reportTarget={{ type: "sns_topic", id: topic.id, body: topic.body }}
              />
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`${stadiumStyles.grainAccent} rounded-full px-2.5 py-1 font-sans text-[10px] font-bold text-[var(--paper)]`}>
                  お題
                </span>
                <span className="font-sans text-[10px] text-[var(--ink)]/60">
                  {topic.createdAtLabel}
                </span>
              </div>
            </div>
            {linkDisabled ? (
              <div className="flex flex-col gap-2">{body}</div>
            ) : (
              <Link href={`/sns/${topic.id}`} className="flex flex-col gap-2">
                {body}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AnswerFeedList({
  answers,
  topics,
  commentCountByAnswer,
}: {
  answers: SnsAnswer[];
  topics: SnsTopic[];
  commentCountByAnswer: Map<string, number>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {answers.map((answer) => {
        const topic = topics.find((t) => t.id === answer.topicId);
        const topicLinkDisabled = topic ? isLocallyCreated(topic.id) : false;
        const answerLinkDisabled = isLocallyCreated(answer.id);
        const answerBody = (
          <>
            <p className="font-sans text-sm font-bold text-[var(--ink)] sm:text-base">
              {answer.body}
            </p>
            <p className="font-sans text-[11px] text-[var(--ink)]/70">
              ❤ {answer.likes.toLocaleString()}・ツッコミ {commentCountByAnswer.get(answer.id) ?? 0}件
            </p>
          </>
        );
        return (
          <div
            key={answer.id}
            className={`${stadiumStyles.grainPaper} flex flex-col gap-2 rounded-2xl p-4 text-[var(--ink)] transition sm:p-5`}
          >
            <div className="flex items-center justify-between gap-2">
              <SnsAuthorBadge
                authorId={answer.authorId}
                reportTarget={{ type: "sns_answer", id: answer.id, body: answer.body }}
              />
              <span className="shrink-0 font-sans text-[10px] text-[var(--ink)]/60">
                {answer.createdAtLabel}
              </span>
            </div>
            {topic && (
              topicLinkDisabled ? (
                <div className="w-fit rounded-full bg-[var(--ink)]/10 px-2.5 py-1 font-sans text-[10px] font-bold text-[var(--ink)]">
                  お題：{topic.body}
                </div>
              ) : (
                <Link
                  href={`/sns/${topic.id}`}
                  className="w-fit rounded-full bg-[var(--ink)]/10 px-2.5 py-1 font-sans text-[10px] font-bold text-[var(--ink)] hover:bg-[var(--ink)]/15"
                >
                  お題：{topic.body}
                </Link>
              )
            )}
            {answerLinkDisabled ? (
              <div className="flex flex-col gap-1">{answerBody}</div>
            ) : (
              <Link href={`/sns/answers/${answer.id}`} className="flex flex-col gap-1">
                {answerBody}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
