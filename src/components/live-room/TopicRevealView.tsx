"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import ScoringPhysicsBoard from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";
import { playSfx } from "@/lib/sfx";
import { serverClock } from "@/lib/serverClockInstance";
import { createTopicRevealSfxScheduler } from "@/lib/topicRevealSfxScheduler";
import { useServerClockState } from "@/lib/useServerNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// public/sounds/topic-reveal.mp3（歓声と拍手）の実測尺（afinfoで確認、約4.1秒）。
const TOPIC_REVEAL_SE_MS = 4100;
// ライブ画面に切り替わった後、この効果音をどれだけ被らせて鳴り終わらせたいか。
// 2026-08-27：「もう少し遅れて鳴って、次のライブ画面が始まってから鳴り終わる感じ」に
// という要望を受けて800ms→2000msに拡大。
const OVERLAP_MS = 2_000;

// お題発表フェーズの実バックエンド版。src/components/live-demo/TopicRevealScreen.tsxと
// 同じ見た目の考え方だが、useLiveDemoStoreではなくuseLiveFollowerStoreの実データを見る。
export default function TopicRevealView() {
  const live = useLiveFollowerStore((s) => s.live);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const groups = useLiveFollowerStore((s) => s.groups);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);

  // 出囃子(BGM)が鳴っている途中で客席がわっと沸く演出にしたいので、画面表示と同時ではなく
  // お題発表フェーズの終盤で鳴らし、ライブ画面への切り替わり後も少しだけ被って鳴り終わる
  // ようにする（src/components/live-demo/TopicRevealScreen.tsxと同じ理由・同じ計算式）。
  // 2026-09-06:「最初のお題発表だけ0秒になっても進まない」不具合の修正に合わせ、
  // 拍手の開始時刻も「マウント時刻からの固定delay」ではなく「live.phase_deadline
  // （サーバー時刻ベースの正しいフェーズ終了時刻）からの逆算」に変更した。
  // 従来のマウント基準だと、そのブラウザが実際にこの画面を表示できた時刻が
  // フェーズ開始時刻と一致している前提が崩れる（今回の不具合のように進行が
  // 遅れて始まった場合や、遅れて画面を開いた参加者)ではズレが生じていた。
  // phase_deadlineが無い（マイグレーション未適用等）場合のみ、従来の固定delayに
  // フォールバックする。
  // 2026-09-06（再レビュー対応）：上記の「phase_deadline基準」だけでは、予定開始時刻を
  // 過ぎてからこの画面を開いた場合（0秒直前のリロード・途中復帰）に、setTimeoutの
  // delayが0にクランプされて「今すぐ・先頭から」再生されてしまい、本来の終了時刻
  // （phase_deadline + OVERLAP_MS）より音源の尺(TOPIC_REVEAL_SE_MS)ぶん遅くまで
  // 鳴り続ける＝終了時刻がずれる不具合が残っていた。
  // 「本来再生を開始すべき絶対時刻」からの遅れ(overdueMs)を求め、
  // - 遅れていなければ（初回・2回目以降の通常ケース）従来どおりその時刻まで待って
  //   先頭から再生する（タイミングは変えない）。
  // - 多少遅れている場合は、経過分(overdueMs)だけ音源の途中から今すぐ再生することで、
  //   終了時刻を本来の時刻に揃える（重なり時間が約2秒のまま保たれる）。
  // - 音源の尺をまるごと過ぎているほど遅れている場合は、不自然な音になるため再生を省略する。
  // 5回目レビュー対応：開始時刻・途中再生位置はサーバー同期時計で計算し、予約は
  // サーバー時計のfresh化・revision変化（初回・再同期・オンライン復帰・タブ再表示後の
  // 再同期）のたびに作り直す。タイマー発火時も再判定する（詳細は
  // topicRevealSfxScheduler.ts）。同期前は予約しない。最初のお題でも2回目以降でも同じ経路。
  const clock = useServerClockState();
  const deadline = live?.phase_deadline ?? null;
  const schedulerRef = useRef<ReturnType<typeof createTopicRevealSfxScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createTopicRevealSfxScheduler({
      nowIfFresh: () => serverClock.nowIfFresh(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      play: (offsetSec) => playSfx("topicReveal", offsetSec > 0 ? { offsetSec } : undefined),
      seMs: TOPIC_REVEAL_SE_MS,
      overlapMs: OVERLAP_MS,
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);
  useEffect(() => {
    schedulerRef.current?.update(deadline);
  }, [deadline, clock.fresh, clock.revision]);
  // 6回目レビュー対応：visibilitychange等での直接の再評価はしない。復帰時は時計側が先に
  // stale化して再同期し、fresh化・revision変化の通知(上のeffect)を受けてから予約し直す
  // （復帰直後の古いアンカーで再生・skipを確定させないため）。

  if (!currentTurn || !currentTopic) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants.filter(
    (p) => p.role === "player" && p.group_id === currentTurn.group_id,
  );
  const onStage = !!myParticipant && myParticipant.group_id === currentTurn.group_id;
  // 回答画面の採点ボードと同じ「審査員数×3」の満杯基準にして、右上の数字表示を揃える。
  // 2026-09-03: participants一覧から毎回計算するのをやめ、ゲーム開始時にサーバー側で
  // 1回だけ確定させたturns.eligible_judge_count（全クライアント共通）を使う（0049）。
  const maxBalls = Math.max(3, currentTurn.eligible_judge_count * 3);

  return (
    <ScreenShell>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: [0, 1, 1, 0] }}
        transition={{ duration: 1.1, times: [0, 0.3, 0.75, 1] }}
        style={{ transformOrigin: "left" }}
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-24 -translate-y-1/2 bg-[#ff3b5b]"
      />
      <p className="font-sans text-xs tracking-widest text-white/60">
        第{currentTurn.round}周 ・ {groupOrder}組目登場
        {onStage ? "（あなたの組です）" : ""}
      </p>
      <motion.h2
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-3 w-full max-w-full break-words px-2 font-sans font-bold text-xl text-[#ffcf4a] sm:text-2xl"
      >
        {stageMembers
          .map((p) => participantNames[p.id] ?? "（名前未設定）")
          .join(" / ")}
      </motion.h2>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-10 aspect-video w-full max-w-2xl"
      >
        <ScoringPhysicsBoard
          variant="neon2"
          topicBody={currentTopic.body}
          roundLabel="お題"
          maxBalls={maxBalls}
          scoreEvents={[]}
        />
      </motion.div>
    </ScreenShell>
  );
}
