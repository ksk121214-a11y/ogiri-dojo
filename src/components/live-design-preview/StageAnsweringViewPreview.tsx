"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import ScreenShell from "@/components/live-demo/ScreenShell";
import StageHeaderBanner from "@/components/live-demo/StageHeaderBanner";
import TimerRing from "@/components/live-demo/TimerRing";
import AnswerRevealCard from "@/components/live-room/AnswerRevealCard";
import { LIVE_ROOM_TIMING, MAX_ANSWERS_PER_PLAYER } from "@/data/liveRoomTiming";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { useTickingNow } from "@/lib/useTickingNow";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { DESIGN_PREVIEW_POP_GRACE_MS, useLiveDesignPreviewStore } from "@/store/useLiveDesignPreviewStore";
import LiveStageBackdropPreview from "./LiveStageBackdropPreview";
import ScoringPhysicsBoardPreview, { type ScoreEvent } from "./ScoringPhysicsBoardPreview";
import StageCharactersViewPreview from "./StageCharactersViewPreview";
import TsukkomiFloatOverlayPreview from "./TsukkomiFloatOverlayPreview";

// src/components/live-room/StageAnsweringView.tsx（本番/liveの回答入力＝舞台画面）を
// デザイン確認用にそのまま複製したもの。見た目・JSX構造は本番と完全に同一にし、
// データの出処だけを実Supabase接続のuseLiveFollowerStoreから、ローカル完結の
// useLiveDesignPreviewStoreに差し替えている。本番側のファイルは一切参照・変更しない
// （デザインが固まったら、この見た目の差分を手動でStageAnsweringView.tsxへ反映する運用）。
export default function StageAnsweringViewPreview() {
  const live = useLiveDesignPreviewStore((s) => s.live);
  const myParticipant = useLiveDesignPreviewStore((s) => s.myParticipant);
  const participants = useLiveDesignPreviewStore((s) => s.participants);
  const participantNames = useLiveDesignPreviewStore((s) => s.participantNames);
  const groups = useLiveDesignPreviewStore((s) => s.groups);
  const currentTurn = useLiveDesignPreviewStore((s) => s.currentTurn);
  const currentTopic = useLiveDesignPreviewStore((s) => s.currentTopic);
  const activeAnswer = useLiveDesignPreviewStore((s) => s.activeAnswer);
  const turnAnswers = useLiveDesignPreviewStore((s) => s.turnAnswers);
  const activeAnswerScores = useLiveDesignPreviewStore((s) => s.activeAnswerScores);
  const myAnswerCount = useLiveDesignPreviewStore((s) => s.myAnswerCount);
  const submitMyAnswer = useLiveDesignPreviewStore((s) => s.submitMyAnswer);
  const glowingParticipantId = useLiveDesignPreviewStore((s) => s.glowingParticipantId);
  const ballTrigger = useLiveDesignPreviewStore((s) => s.ballTrigger);

  const now = useTickingNow(150);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const displayedAnswer = useJudgingDisplay(activeAnswer, turnAnswers, DESIGN_PREVIEW_POP_GRACE_MS);

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      activeAnswerScores.map((s) => ({
        id: `${s.answer_id}-${s.judge_participant_id}`,
        points: s.points,
      })),
    [activeAnswerScores],
  );

  if (!live || !currentTurn || !currentTopic || !myParticipant) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants
    .filter((p) => p.role === "player" && p.group_id === currentTurn.group_id)
    .map((p) => ({ id: p.id, name: participantNames[p.id] ?? "（名前未設定）" }));

  const activeParticipantId = activeAnswer?.participant_id ?? null;
  const isMyAnswerJudging = displayedAnswer?.participant_id === myParticipant.id;
  const eligibleJudgeCount = participants.filter(
    (p) => p.role === "player" && p.group_id !== currentTurn.group_id,
  ).length;
  const maxBalls = Math.max(3, eligibleJudgeCount * 3);
  const busyWithOthers = live.answering_paused;

  const answeringRemainingMs =
    live.answering_paused && live.answering_remaining_ms != null
      ? live.answering_remaining_ms
      : live.phase_deadline
        ? Math.max(0, new Date(live.phase_deadline).getTime() - now)
        : 0;
  const judgingRemainingMs = displayedAnswer?.judging_ends_at
    ? Math.max(0, new Date(displayedAnswer.judging_ends_at).getTime() - now)
    : 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    const result = await submitMyAnswer(draft);
    setSubmitting(false);
    if (result.ok) {
      setDraft("");
      setError(null);
    } else {
      setError(result.reason ?? "送信できませんでした");
    }
  };

  const overLimit = myAnswerCount >= MAX_ANSWERS_PER_PLAYER;
  const submitDisabled = overLimit || busyWithOthers || submitting || !draft.trim();

  return (
    <ScreenShell className="!items-stretch !justify-center !overflow-visible !px-3 !pt-1 !pb-1">
      <LiveStageBackdropPreview />
      {/* 3行目はminmax(140px,1fr)にして、どれだけ画面が低くても
          フリップ(お題ボードと入力欄の間を埋める演出)が0になって消えないよう
          最低限の高さを確保する。 */}
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_auto_minmax(140px,1fr)_auto] gap-1 overflow-visible">
        <StageHeaderBanner showDecoration={false} scaleUp={false} showCrown={false} />
        <div className="flex min-h-0 flex-col items-center gap-2 overflow-hidden">
          {/*
            grid-rows-[auto_1fr_auto]の1行目(お題ゾーン)がaspect-videoのコンテンツ量に
            引きずられて肥大化すると、2行目(舞台キャラ列)の実効スペースを圧迫し、
            低いPC画面（高さ850px前後）でアイコンが行の外にはみ出て消える不具合が出ていた。
            高さをvh基準で頭打ちにし、幅はaspect-videoから逆算させることで肥大化を防ぐ。
            画面がある程度広い(md以上)場合は、持ち時間・残り回答数をお題ボードの下ではなく
            横に並べることで、縦方向の圧迫（キャラ列のスペース不足）を避けている。
          */}
          <div
            ref={boardBoxRef}
            className="relative flex w-full justify-center"
            style={{ height: boardFitted ? boardFitted.height : "46vh" }}
          >
            {/* aspect-video + w-full + max-hのCSS任せだと、実機Safariで幅と高さの
                解決順序がChromeと食い違い、ボードが中央からズレたりタイマーの位置が
                合わなくなる不具合があった。この外枠は最初は40vhで実測用の高さを確保し、
                実測してfitted(実際に16:9で収まるサイズ)が求まったら、その高さぶんまで
                自分自身を縮める。40vhのまま固定してしまうと、幅基準で収まりきる場合に
                下へ余白が残って「残り回数」行が離れて見えてしまっていた。
                タイマーはこのラッパーと同じサイズになるボード自身を基準に重ねる。 */}
            <div
              className="relative"
              style={boardFitted ? { width: boardFitted.width, height: boardFitted.height } : undefined}
            >
              <ScoringPhysicsBoardPreview
                topicBody={currentTopic.body}
                roundLabel={`第${currentTurn.round}周 ・ ${groupOrder}組目`}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={ballTrigger?.resolved ?? false}
                roundKey={ballTrigger?.answerId ?? null}
              />
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  totalMs={LIVE_ROOM_TIMING.answerMs}
                  paused={busyWithOthers}
                  size={40}
                  darkText
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {Array.from({ length: MAX_ANSWERS_PER_PLAYER }).map((_, i) => (
              <span
                key={i}
                className={`h-4 w-4 rounded-full border border-dojo-curtain-gold ${
                  i < myAnswerCount ? "bg-dojo-curtain-gold" : "bg-transparent"
                }`}
              />
            ))}
            <span className="ml-1 font-sans text-xs text-dojo-gray-purple">
              残り{Math.max(0, MAX_ANSWERS_PER_PLAYER - myAnswerCount)}回
            </span>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          {/*
            舞台・アイコンは審査中でも消さず常時表示する。回答カードはその手前に
            absoluteで重ねる「ドカンと出る」演出にし、スペースを奪い合って
            どちらかが消える・縮む構成を避ける。
          */}
          <StageCharactersViewPreview
            members={stageMembers}
            myParticipantId={myParticipant.id}
            activeParticipantId={activeParticipantId}
            glowingParticipantId={glowingParticipantId}
          />
          <AnimatePresence>
            {displayedAnswer && (
              <motion.div
                key="judging"
                initial={{ opacity: 0, scale: 0.9, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -16 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 px-2 py-0"
              >
                {/* fillHeight: お題ボード(2行目)〜入力欄(4行目)の間はgrid上3行目が
                    1frで確保しているため、このoverlay自体の高さ=その間の余白そのもの。
                    フリップをその高さいっぱいに合わせることで、画面サイズが変わっても
                    ボード・入力欄のどちらにも被らずに収まる。 */}
                <AnswerRevealCard
                  authorName={
                    (participantNames[displayedAnswer.participant_id] ?? "（名前未設定）") +
                    (isMyAnswerJudging ? "（あなた）" : "")
                  }
                  answerBody={displayedAnswer.body}
                  fillHeight
                  scaleUp={false}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <AudienceLayer fixedBottomPx={-22} zIndex={5} />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative z-10 mx-auto w-full max-w-xl"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={overLimit}
            placeholder={
              overLimit
                ? "回答できる回数の上限に達しました"
                : busyWithOthers
                  ? "他の回答を審査中です。書きためておけます（送信は少し待ってね）"
                  : "回答を入力……"
            }
            rows={2}
            className="w-full resize-none rounded-xl border-2 border-dojo-gray-purple/30 bg-dojo-washi-white px-4 py-2.5 font-sans text-lg text-dojo-ink placeholder:text-dojo-gray-purple focus:border-dojo-curtain-gold focus:outline-none disabled:bg-dojo-light-brown disabled:text-dojo-gray-purple [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-base"
          />
          {error && <p className="mt-1 font-sans text-xs text-dojo-curtain-red">{error}</p>}
          <div className="mt-2 flex items-center justify-center gap-3">
            {/* タイマー表示時にボタンが右にずれないよう、反対側に同じ幅の
                透明スペーサーを置いてボタンを常に中央固定にする。 */}
            {busyWithOthers && <div className="w-10 shrink-0" aria-hidden />}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="w-1/2 max-w-[11rem] rounded-xl border-2 border-dojo-curtain-gold bg-dojo-curtain-gold px-4 py-2 font-sans text-base font-bold text-dojo-stage-dark transition hover:bg-dojo-gold-foil disabled:cursor-not-allowed disabled:border-dojo-gold-foil disabled:bg-dojo-gold-foil disabled:text-dojo-stage-dark/60 [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-sm"
            >
              {busyWithOthers ? "審査中…" : "送信する"}
            </button>
            {busyWithOthers && (
              <TimerRing remainingMs={judgingRemainingMs} totalMs={LIVE_ROOM_TIMING.judgeMs} size={40} />
            )}
          </div>
        </motion.div>
      </div>

      <TsukkomiFloatOverlayPreview />
    </ScreenShell>
  );
}
