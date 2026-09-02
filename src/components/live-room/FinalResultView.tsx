"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import MyIconAvatar from "@/components/app/MyIconAvatar";
import ParticipantIconAvatar from "@/components/app/ParticipantIconAvatar";
import ReportButton from "@/components/app/ReportButton";
import XShareButton from "@/components/app/XShareButton";
import MasteryGauge from "@/components/live-demo/MasteryGauge";
import { MASTERY_GAIN } from "@/data/collectionData";
import { APP_NAME } from "@/lib/appInfo";
import { truncateLiveDisplayName, type RoomRankingEntry } from "@/lib/liveRoomSelectors";
import { playSfx } from "@/lib/sfx";
import type { FinalResultData, ParticipantAvatarInfo } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

const EMPTY_AVATARS: Record<string, ParticipantAvatarInfo> = {};

// 実バックエンド版ライブの最終結果発表。src/components/live-demo/FinalResultScreen.tsxと
// 同じアクセントカラー（1〜3位＝青枠）を使うが、この画面自体は（live-demoのような
// 常時ダーク背景の没入演出ではなく）明るい背景のページに埋め込まれるため、
// GroupResultViewと同じ白カードにして馴染ませる。
// 2026-08-31：
// - 「本日のベストアンサー」の表示はやめた（順位発表のみに絞る。ベストアンサー自体は
//   引き続きgetBestAnswer()で正しく＝最高得点で決まっており、ランダムではない。
//   ここでは表彰ボーナス／熟練度メーターの加算計算にだけ内部的に使う）。
// - 1〜3位の発表カードに表彰ボーナス(+pt)を明記し、末尾に熟練度メーター（段位の
//   進捗）が今回の得点に応じてどれだけ増えたかを、live-demoと同じ円形ゲージ演出
//   （MasteryGauge、TimerRingの大きい版）で見せる。実際の加算はライブ終了
//   （closeLive→apply_live_rank_rewards）時にDB側で確定するため、ここでの表示は
//   同じ計算式で見込み値を先出しするプレビューという位置づけ（現在のprofiles.mastery_meter
//   を起点に、今回の得点ぶんだけゲージが伸びる）。
// 2026-09-01：段位（熟練度メーター）用の順位ボーナスと、累計ポイント用の順位ボーナスが
// 別の数字（100/60/30 と 300/200/100）だったため紛らわしいという指摘を受け、
// 段位・ポイントとも同じ1つの式（MASTERY_GAIN、1位+100/2位+60/3位+30、参加+10、
// ベストアンサー+50）に統一した。カード上の「表彰ボーナス」は順位ぶんだけ、末尾の
// 「獲得ポイント」は参加基礎点＋得点＋順位ボーナスの合計、と役割が違うため
// 同じ数字が二重に見える心配もなくなる。
// 2026-09-03:「同点なのに1位・2位・3位のように別々の順位が付く」表示バグの修正。
// 以前は配列の位置(3-step)でラベル・色・ボーナスを決めていたため、同点で
// 複数人が同じ順位になっている場合でも、単に見せる順番が3位→2位→1位に
// なっているだけなのに「2位」「3位」と表示されてしまっていた。各エントリが
// 既に持っているrank（同点は同じ順位、liveRoomSelectors.tsのwithRanks参照）を
// キーにして引く方式に変え、見せる順番（配列位置）と実際の順位表示を分離する。
const RANK_COLOR_BY_RANK: Record<number, string> = {
  1: "text-[#ffcf4a]",
  2: "text-[#8a93c7]",
  3: "text-[#ff8f4a]",
};
const RANK_BONUS_POINTS_BY_RANK: Record<number, number> = {
  1: MASTERY_GAIN.rankBonus.first,
  2: MASTERY_GAIN.rankBonus.second,
  3: MASTERY_GAIN.rankBonus.third,
};

export default function FinalResultView({
  data,
  myParticipantId,
  participantAvatars = EMPTY_AVATARS,
}: {
  data: FinalResultData;
  myParticipantId: string | null;
  participantAvatars?: Record<string, ParticipantAvatarInfo>;
}) {
  // ベストアンサーの発表ステップを廃止したため、1位分（従来のstep1〜3）から始める。
  const [step, setStep] = useState(1);
  // 2026-09-03:「上位3順位に同点で4人以上いる場合、一部が表彰演出から漏れる」
  // 不具合の修正。以前はdata.ranking.slice(0,3)で配列の先頭3件（＝配列の"位置"）を
  // 固定で3人ぶんだけ発表していたため、例えば1位が2人同点だと3人目（実際には
  // 2位の人）が表彰演出から漏れていた。rank<=3の全員を、同じ順位ごとにまとめて
  // （タイの場合は複数人まとめて）扱う。存在する順位の数だけステップが進む
  // （常に3ステップとは限らない：1位が2人・2位以降がいなければ1ステップだけ）。
  const podiumTiers = useMemo(() => {
    const byRank = new Map<number, RoomRankingEntry[]>();
    for (const entry of data.ranking) {
      if (entry.rank > 3) continue;
      const list = byRank.get(entry.rank) ?? [];
      list.push(entry);
      byRank.set(entry.rank, list);
    }
    // 3位相当→2位相当→1位相当の順に見せたいので、順位の降順に並べる
    // （存在する順位だけが入る。例：1位が2人・3位が1人なら[[3,[...]],[1,[...]]]）。
    return [...byRank.entries()].sort((a, b) => b[0] - a[0]);
  }, [data.ranking]);
  const totalSteps = podiumTiers.length;
  const profile = useProfileStore((s) => s.profile);

  useEffect(() => {
    if (step > totalSteps) return;
    const t = setTimeout(() => setStep((s) => s + 1), 2000);
    return () => clearTimeout(t);
  }, [step, totalSteps]);

  // 3位→2位→1位と切り替わるたびに発表音を鳴らす（マウント時＝最初の3位発表でも鳴る）。
  useEffect(() => {
    playSfx("rankReveal");
  }, [step]);

  // 自分がプレイヤーとしてランキングに載っている場合のみ、今回の獲得ぶんを計算する
  // （観客は対象外＝ranking自体に登場しない）。段位（熟練度メーター）と累計ポイント／
  // ポイント残高は同じ1つの式で加算されるため、gainは1つだけ計算すればよい。
  // 2026-09-01：「ベストアンサー」の自動+50付与は廃止し、運営がライブ結果（SNS掲載）
  // 画面で選ぶ「運営ベスト」を選出した時点で+50を付与する方式に変更した
  // （set_sns_live_result_manager_best()、この画面の時点ではまだ運営ベストは
  // 決まっていないため、ここでは含めずに計算する）。
  const myEntry = data.ranking.find((r) => r.participantId === myParticipantId);
  const rankBonus =
    data.myRank === 1
      ? MASTERY_GAIN.rankBonus.first
      : data.myRank === 2
        ? MASTERY_GAIN.rankBonus.second
        : data.myRank === 3
          ? MASTERY_GAIN.rankBonus.third
          : 0;
  const gain = myEntry ? MASTERY_GAIN.participation + myEntry.total + rankBonus : 0;

  // シェア文面：自分が1〜3位の場合だけ順位を明記する（他の参加者の順位は一切含めない。
  // 下位の順位を本人の意図に反してさらけ出さない、という既存の匿名性方針を踏まえた
  // デフォルト文面。送信前のX投稿画面でユーザー自身が自由に編集できる）。
  const shareText = myEntry
    ? data.myRank !== null && data.myRank <= 3
      ? `${APP_NAME}のライブで${data.myRank}位でした！獲得ポイント+${gain}pt\n#${APP_NAME}`
      : `${APP_NAME}のライブに参加しました！獲得ポイント+${gain}pt\n#${APP_NAME}`
    : `${APP_NAME}のライブを観戦しました！\n#${APP_NAME}`;

  return (
    <div className="w-full max-w-md rounded-[28px] border-[5px] border-[#3b5bff] bg-white p-5 text-[#1a1a3a] shadow-[0_0_40px_rgba(59,91,255,0.45)]">
      <p className="text-center font-sans text-xs font-bold tracking-widest text-[#3b5bff]">
        最終結果・表彰式
      </p>

      <div className="mt-4 flex min-h-[220px] w-full flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {step >= 1 && step <= totalSteps && podiumTiers[step - 1] && (() => {
            const [rank, entries] = podiumTiers[step - 1];
            return (
              <motion.div
                key={`rank-${step}`}
                initial={{ opacity: 0, y: 30, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 200, damping: 16 }}
                className="w-full rounded-xl border border-[#3b5bff]/60 bg-[#eef1ff] p-6 text-center"
              >
                <p className={`font-sans text-3xl font-black ${RANK_COLOR_BY_RANK[rank] ?? RANK_COLOR_BY_RANK[3]}`}>
                  {rank}位
                </p>
                {/* 同着（同じ順位）の人が複数いる場合、全員をまとめて表示する。 */}
                <div className="mt-3 flex flex-col items-center gap-3">
                  {entries.map((entry) => (
                    <div key={entry.participantId} className="flex flex-col items-center gap-1">
                      <div className="flex items-center justify-center gap-2">
                        {entry.participantId === myParticipantId ? (
                          <MyIconAvatar size={28} bare />
                        ) : (
                          <ParticipantIconAvatar
                            participantId={entry.participantId}
                            avatarIcon={participantAvatars[entry.participantId]?.icon}
                            avatarColor={participantAvatars[entry.participantId]?.color}
                            size={28}
                            bare
                          />
                        )}
                        <p className="font-sans text-lg font-bold">
                          {truncateLiveDisplayName(entry.name)}
                        </p>
                      </div>
                      <p className="font-sans text-sm font-bold text-[#ff8f00]">{entry.total}点</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 font-sans text-sm font-bold text-[#3b5bff]">
                  表彰ボーナス +{RANK_BONUS_POINTS_BY_RANK[rank] ?? 0}pt
                </p>
              </motion.div>
            );
          })()}

          {step > totalSteps && (
            <motion.div key="overall" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full">
              {data.myRank !== null && (
                <p className="text-center font-sans text-sm text-[#6b6b90]">
                  あなたの総合順位：
                  <span className="font-bold text-[#3b5bff]">{data.myRank}位</span>
                  （{data.ranking.length}人中）
                </p>
              )}
              <div className="mt-3 max-h-64 w-full space-y-1.5 overflow-y-auto">
                {data.ranking.map((r) => {
                  const isMe = r.participantId === myParticipantId;
                  return (
                    <div
                      key={r.participantId}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                        isMe ? "border-[#3b5bff] bg-[#eef1ff]" : "border-[#e4e6f5] bg-white"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {/* 2026-09-03: 配列の位置(idx+1)ではなく、同点を同じ順位にするr.rankを表示する。 */}
                        <span className="shrink-0 text-[#8a8ab0]">{r.rank}位</span>
                        {isMe ? (
                          <MyIconAvatar size={24} bare />
                        ) : (
                          <ParticipantIconAvatar
                            participantId={r.participantId}
                            avatarIcon={participantAvatars[r.participantId]?.icon}
                            avatarColor={participantAvatars[r.participantId]?.color}
                            size={24}
                            bare
                          />
                        )}
                        <span className="truncate">{truncateLiveDisplayName(r.name)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-[#ff8f00]">{r.total}点</span>
                        {!isMe && <ReportButton size={16} />}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <XShareButton
                  context="final_result"
                  label="結果をXでシェア"
                  text={shareText}
                  url="/live-schedule"
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#1a1a3a] bg-[#1a1a3a] px-5 py-2.5 font-sans text-sm font-bold text-white transition hover:opacity-90"
                />
                <Link
                  href="/"
                  className="rounded-full bg-[#3b5bff] px-6 py-2.5 font-sans text-sm font-bold text-white transition hover:bg-[#2947e0]"
                >
                  ホームに戻る
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {step > totalSteps && myEntry && profile && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-4 flex w-full flex-col items-center rounded-2xl bg-[#12101a] px-4 py-6"
        >
          <p className="font-sans text-xs tracking-widest text-white/60">
            熟練度メーター獲得
          </p>
          <div className="mt-3">
            <MasteryGauge baseline={profile.masteryMeter} gained={gain} />
          </div>
          <p className="mt-3 font-sans text-xs text-white/80">
            獲得ポイント：
            <span className="font-bold text-[#ffcf4a]">+{gain}pt</span>
          </p>
        </motion.div>
      )}
    </div>
  );
}
