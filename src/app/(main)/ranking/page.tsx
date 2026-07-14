"use client";

import { useMemo, useState } from "react";

import InitialAvatar from "@/components/app/InitialAvatar";
import MyIconAvatar from "@/components/app/MyIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import { ARCHIVE_LIVES, getAllArchiveAnswers } from "@/data/archiveData";
import { getRankByMeter, RANK_DEFINITIONS } from "@/data/collectionData";
import { DUMMY_RANKING } from "@/data/rankingData";
import { useUserStore } from "@/store/useUserStore";

type MainTab = "ranking" | "archive";

const MAIN_TABS: { key: MainTab; label: string; emoji: string }[] = [
  { key: "ranking", label: "総合ランキング", emoji: "🏆" },
  { key: "archive", label: "過去のライブ", emoji: "📜" },
];

// ランキング・過去のライブ画面：第6ラウンドフィードバックでナビ項目を減らすため、
// 番付表（総合ランキング）と過去のライブアーカイブをページ内タブで統合した。
export default function RankingPage() {
  const [mainTab, setMainTab] = useState<MainTab>("ranking");

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
          {mainTab === "ranking" ? "RANKING" : "ARCHIVE"}
        </p>
        <h1 className="mt-1 font-brush text-3xl text-dojo-dark-brown sm:text-4xl">
          {mainTab === "ranking" ? "番付表" : "過去のライブ"}
        </h1>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          {mainTab === "ranking"
            ? "道場に集う演者たちの段位一覧（ダミーデータ）"
            : "過去に開催されたライブのお題・回答をいいね数順に振り返る（ダミーデータ）"}
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-sm gap-2 rounded-full border border-dojo-dark-brown/20 bg-dojo-light-brown/50 p-1">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMainTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 font-sans text-xs font-bold transition sm:text-sm ${
              mainTab === tab.key
                ? "bg-dojo-curtain-red text-dojo-washi-white shadow-[0_0_14px_rgba(192,38,63,0.4)]"
                : "text-dojo-dark-brown hover:bg-dojo-light-brown"
            }`}
          >
            <span>{tab.emoji}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {mainTab === "ranking" ? <RankingTab /> : <ArchiveTab />}
    </div>
  );
}

function RankingTab() {
  const user = useUserStore((s) => s.user);

  const entries = useMemo(() => {
    const myRank = getRankByMeter(user.masteryMeter);
    const merged = [
      ...DUMMY_RANKING,
      { id: "me", name: user.displayName, rank: myRank.key, score: user.masteryMeter, isMe: true },
    ];
    return merged
      .map((e) => ({
        ...e,
        rankOrder: RANK_DEFINITIONS.find((d) => d.key === e.rank)?.order ?? 0,
        rankLabel: RANK_DEFINITIONS.find((d) => d.key === e.rank)?.label ?? "",
      }))
      .sort((a, b) => b.rankOrder - a.rankOrder || b.score - a.score);
  }, [user]);

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, idx) => {
        const isMe = "isMe" in entry && entry.isMe;
        return (
          <div
            key={entry.id}
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
              isMe
                ? "border-dojo-curtain-gold bg-dojo-light-brown"
                : "border-dojo-dark-brown/15 bg-dojo-light-brown/50"
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-5 shrink-0 text-center font-sans text-xs text-dojo-dark-brown">
                {idx + 1}
              </span>
              {isMe ? (
                <MyIconAvatar size={36} />
              ) : (
                <InitialAvatar name={entry.name} seed={idx} size={36} />
              )}
              <div className="min-w-0">
                <p className="truncate font-sans text-sm font-bold text-dojo-ink">
                  {entry.name}
                  {isMe ? "（あなた）" : ""}
                </p>
                <p className="font-sans text-[11px] font-bold text-dojo-ink">
                  {entry.rankLabel}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-sans text-xs tabular-nums text-dojo-dark-brown">
                {entry.score.toLocaleString()}
              </span>
              {!isMe && <ReportButton size={18} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArchiveTab() {
  const [likes, setLikes] = useState<Record<string, number>>(() =>
    Object.fromEntries(getAllArchiveAnswers().map((a) => [a.id, a.likes])),
  );
  const [liked, setLiked] = useState<Record<string, boolean>>({});

  const handleLike = (id: string) => {
    if (liked[id]) return;
    setLiked((prev) => ({ ...prev, [id]: true }));
    setLikes((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };

  return (
    <div className="flex flex-col gap-8">
      {ARCHIVE_LIVES.map((live) => (
        <section
          key={live.id}
          className="rounded-2xl border border-dojo-curtain-gold/25 bg-dojo-light-brown/50 p-5 sm:p-6"
        >
          <div className="mb-4">
            <h2 className="font-brush text-xl text-dojo-dark-brown sm:text-2xl">
              {live.title}
            </h2>
            <p className="mt-1 font-sans text-xs text-dojo-dark-brown">
              {live.dateLabel}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {live.topics.map((topic) => {
              const sorted = [...topic.answers].sort(
                (a, b) => (likes[b.id] ?? b.likes) - (likes[a.id] ?? a.likes),
              );
              return (
                <div
                  key={topic.id}
                  className="rounded-xl border border-dojo-dark-brown/20 bg-dojo-tatami-cream/60 p-4"
                >
                  <p className="font-sans text-sm font-bold text-dojo-ink">
                    お題：{topic.body}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {sorted.map((answer, idx) => (
                      <div
                        key={answer.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-dojo-dark-brown/15 bg-dojo-light-brown/60 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="font-sans text-[11px] font-bold text-dojo-ink">
                            {idx + 1}位・{answer.author}
                          </p>
                          <p className="mt-0.5 font-sans text-sm text-dojo-ink">
                            {answer.body}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleLike(answer.id)}
                          className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 font-sans text-xs font-bold transition active:scale-95 ${
                            liked[answer.id]
                              ? "border-dojo-cheer-pink bg-dojo-cheer-pink/20 text-dojo-cheer-pink"
                              : "border-dojo-dark-brown/30 text-dojo-dark-brown hover:border-dojo-cheer-pink hover:text-dojo-cheer-pink"
                          }`}
                        >
                          {liked[answer.id] ? "❤" : "🤍"}
                          <span className="tabular-nums">
                            {(likes[answer.id] ?? answer.likes).toLocaleString()}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
