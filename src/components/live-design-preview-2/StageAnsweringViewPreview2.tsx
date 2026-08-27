"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useMemo, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import ScreenShell from "@/components/live-demo/ScreenShell";
import TimerRing from "@/components/live-demo/TimerRing";
import AnswerRevealCard from "@/components/live-room/AnswerRevealCard";
import { BASE_PATH } from "@/lib/basePath";
import { LIVE_ROOM_TIMING, MAX_ANSWERS_PER_PLAYER } from "@/data/liveRoomTiming";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { useTickingNow } from "@/lib/useTickingNow";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { DESIGN_PREVIEW_POP_GRACE_MS, useLiveDesignPreviewStore2 } from "@/store/useLiveDesignPreviewStore2";
import LiveStageBackdropPreview2 from "./LiveStageBackdropPreview2";
import ScoringPhysicsBoardPreview2, { type ScoreEvent } from "./ScoringPhysicsBoardPreview2";
import StageCharactersViewPreview2 from "./StageCharactersViewPreview2";
import TsukkomiFloatOverlayPreview from "../live-design-preview/TsukkomiFloatOverlayPreview";

// live-design-preview/StageAnsweringViewPreview.tsx（1個目のデザイン確認）の
// レイアウト・ゲームロジックはそのまま、見た目だけ大喜利素材2のネオン系に
// 差し替えた2個目のデザイン確認。グリッド構成・fitAspectでの実測サイズ計算・
// fillHeightでフリップを隙間いっぱいに広げる仕組みなど、1個目で詰めた
// 「崩れない土台」はすべて踏襲している（差分は各パーツの見た目のみ）。
export default function StageAnsweringViewPreview2() {
  const live = useLiveDesignPreviewStore2((s) => s.live);
  const myParticipant = useLiveDesignPreviewStore2((s) => s.myParticipant);
  const participants = useLiveDesignPreviewStore2((s) => s.participants);
  const participantNames = useLiveDesignPreviewStore2((s) => s.participantNames);
  const groups = useLiveDesignPreviewStore2((s) => s.groups);
  const currentTurn = useLiveDesignPreviewStore2((s) => s.currentTurn);
  const currentTopic = useLiveDesignPreviewStore2((s) => s.currentTopic);
  const activeAnswer = useLiveDesignPreviewStore2((s) => s.activeAnswer);
  const turnAnswers = useLiveDesignPreviewStore2((s) => s.turnAnswers);
  const activeAnswerScores = useLiveDesignPreviewStore2((s) => s.activeAnswerScores);
  const myAnswerCount = useLiveDesignPreviewStore2((s) => s.myAnswerCount);
  const submitMyAnswer = useLiveDesignPreviewStore2((s) => s.submitMyAnswer);
  const glowingParticipantId = useLiveDesignPreviewStore2((s) => s.glowingParticipantId);
  const ballTrigger = useLiveDesignPreviewStore2((s) => s.ballTrigger);

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
      <LiveStageBackdropPreview2 />
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_auto_minmax(140px,1fr)_auto] gap-1 overflow-visible">
        {/* 1個目のStageHeaderBanner（アプリ名バナー）の代わりに、完成イメージ参考画像の
            通り、上部の電飾バーだけを置く。 */}
        <div className="relative mx-auto w-full max-w-xs pt-1">
          <Image
            src={`${BASE_PATH}/images/live2/top-lights-crop.png`}
            alt=""
            width={1024}
            height={230}
            sizes="400px"
            priority
            className="h-auto w-full object-contain"
          />
        </div>
        {/* 客席シルエット(AudienceLayer, z-5)が大きく、上端がこの行の高さまで
            届くことがあるため、ボードだけでなく「残り○回」表示も含めたこの行
            全体にz-indexを与えて常に手前に表示する。 */}
        <div className="relative z-20 -mt-[32px] flex min-h-0 flex-col items-center gap-2 overflow-visible">
          <div
            ref={boardBoxRef}
            className="relative flex w-full justify-center"
            // 2個目のテーマは1行目(上部電飾バー)が1個目のStageHeaderBannerより
            // 縦に短く、その分ボードに使える余白が増えるため、1個目と同じ46vhのままだと
            // 横長PC画面で演者列(固定位置)と「残り回数」表示が重なってしまう。38vhに抑える。
            style={{ height: boardFitted ? boardFitted.height : "38vh" }}
          >
            <div
              className="relative"
              style={boardFitted ? { width: boardFitted.width, height: boardFitted.height } : undefined}
            >
              <ScoringPhysicsBoardPreview2
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
                className={`h-4 w-4 rounded-full border border-[#3b5bff] ${
                  i < myAnswerCount ? "bg-[#3b5bff]" : "bg-transparent"
                }`}
              />
            ))}
            <span className="ml-1 font-sans text-xs text-white/70">
              残り{Math.max(0, MAX_ANSWERS_PER_PLAYER - myAnswerCount)}回
            </span>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          <StageCharactersViewPreview2
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
          {/* 客席視点と高さを合わせるため、同じfixedBottomPxにする
              （ユーザー指摘: 舞台視点と客席視点でシルエットの高さが違っていた）。 */}
          {/* maxWidthClassNameは幅400px固定にしていたが、audience-2.png(550×825)を
              高さ576px(h-[36rem])のboxにobject-coverで収める場合、box幅が384pxを
              超えると拡大率の基準が高さ基準から幅基準に切り替わってしまい、
              画面幅によって見た目の大きさが変わってしまう(384px以下なら常に高さ
              基準で拡大率が一定になる)。また400px固定だと画面幅がそれより狭い
              端末(390px等)ではboxが画面をはみ出し、中央寄せの計算上はみ出た分が
              すべて右側に流れて左端に張り付く挙動になり「右に寄って見える」原因に
              なっていた。w-fullで画面幅を超えないようにしつつ、384px未満で
              上限をかけることで、どんな画面幅でも同じ拡大率・中央寄せを保証する。 */}
          <AudienceLayer
            fixedBottomPx={-45}
            zIndex={5}
            imageSrc="/images/live2/audience-2-crop.png"
            fixedRenderWidthPx={614}
            fixedRenderHeightPx={216}
          />
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
            className="w-full resize-none rounded-xl border-2 border-[#3b5bff]/40 bg-white px-4 py-2.5 font-sans text-lg text-[#1a1a3a] placeholder:text-[#6b6b90] focus:border-[#3b5bff] focus:outline-none disabled:bg-[#e4e6f5] disabled:text-[#8a8ab0] [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-base"
          />
          {error && <p className="mt-1 font-sans text-xs text-red-400">{error}</p>}
          <div className="mt-2 flex items-center justify-center gap-3">
            {busyWithOthers && <div className="w-10 shrink-0" aria-hidden />}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className="w-1/2 max-w-[11rem] rounded-xl border-2 border-[#3b5bff] bg-[#3b5bff] px-4 py-2 font-sans text-base font-bold text-white transition hover:bg-[#2947e0] disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/60 [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-sm"
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
