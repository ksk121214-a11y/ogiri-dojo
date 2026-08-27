"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import ScoreButtons from "@/components/live-demo/ScoreButtons";
import ScreenShell from "@/components/live-demo/ScreenShell";
import StageHeaderBanner from "@/components/live-demo/StageHeaderBanner";
import TimerRing from "@/components/live-demo/TimerRing";
import AnswerRevealCard from "@/components/live-room/AnswerRevealCard";
import { TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import { LIVE_ROOM_TIMING } from "@/data/liveRoomTiming";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { useTickingNow } from "@/lib/useTickingNow";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { DESIGN_PREVIEW_POP_GRACE_MS, useLiveDesignPreviewStore } from "@/store/useLiveDesignPreviewStore";
import LiveStageBackdropPreview from "./LiveStageBackdropPreview";
import ScoringPhysicsBoardPreview, { type ScoreEvent } from "./ScoringPhysicsBoardPreview";
import StageCharactersViewPreview from "./StageCharactersViewPreview";
import TsukkomiFloatOverlayPreview from "./TsukkomiFloatOverlayPreview";

// src/components/live-room/AudienceAnsweringView.tsx（本番/liveの客席・審査員画面）を
// デザイン確認用にそのまま複製したもの。データの出処だけをuseLiveDesignPreviewStoreに差し替え、
// 見た目・JSX構造は本番と完全に同一にしている（本番側のファイルは変更しない）。
export default function AudienceAnsweringViewPreview() {
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
  const myScore = useLiveDesignPreviewStore((s) => s.myScore);
  const submitMyScore = useLiveDesignPreviewStore((s) => s.submitMyScore);
  const sendTsukkomi = useLiveDesignPreviewStore((s) => s.sendTsukkomi);
  const glowingParticipantId = useLiveDesignPreviewStore((s) => s.glowingParticipantId);
  const ballTrigger = useLiveDesignPreviewStore((s) => s.ballTrigger);

  const now = useTickingNow(150);
  const [scoreError, setScoreError] = useState<{ answerId: string; message: string } | null>(
    null,
  );

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
  const eligibleJudgeCount = participants.filter(
    (p) => p.role === "player" && p.group_id !== currentTurn.group_id,
  ).length;
  const maxBalls = Math.max(3, eligibleJudgeCount * 3);

  const answeringRemainingMs =
    live.answering_paused && live.answering_remaining_ms != null
      ? live.answering_remaining_ms
      : live.phase_deadline
        ? Math.max(0, new Date(live.phase_deadline).getTime() - now)
        : 0;
  const judgingRemainingMs = displayedAnswer?.judging_ends_at
    ? Math.max(0, new Date(displayedAnswer.judging_ends_at).getTime() - now)
    : 0;
  const judgingTimeUp = judgingRemainingMs <= 0;

  const handleScore = async (points: 0 | 1 | 2 | 3) => {
    if (!displayedAnswer) return;
    const answerId = displayedAnswer.id;
    const result = await submitMyScore(points);
    setScoreError(
      result.ok
        ? null
        : { answerId, message: result.reason ?? "採点できませんでした（時間切れの可能性があります）" },
    );
  };

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
            画面がある程度広い(md以上)場合は、持ち時間をお題ボードの下ではなく横に並べることで、
            縦方向の圧迫（キャラ列のスペース不足）を避けている。
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
                  paused={live.answering_paused}
                  size={40}
                  darkText
                />
              </div>
            </div>
          </div>
          {/* 舞台視点(StageAnsweringViewPreview)には「残り○回」の行があり、
              客席視点にはそれがない。この行の有無で2行目の高さが変わると、
              3行目(舞台)のcenter配置位置が舞台視点とズレてしまうため、
              同じ高さの不可視スペーサーを置いて高さだけ揃える。 */}
          <div className="invisible flex items-center gap-2" aria-hidden>
            <span className="h-4 w-4 rounded-full border border-dojo-curtain-gold" />
            <span className="ml-1 font-sans text-xs">残り0回</span>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          {/*
            舞台・アイコンは審査中でも消さず常時表示する。回答カードはその手前に
            absoluteで重ねる「ドカンと出る」演出にし、スペースを奪い合って
            どちらかが消える・縮む構成を避ける。
          */}
          <div className="relative flex w-full flex-col items-center">
            <StageCharactersViewPreview
              members={stageMembers}
              myParticipantId={myParticipant.id}
              activeParticipantId={activeParticipantId}
              glowingParticipantId={glowingParticipantId}
            />
            {!displayedAnswer && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute -bottom-16 font-sans text-xs text-dojo-gray-purple"
              >
                次の登壇を待っています……
              </motion.p>
            )}
          </div>
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
                    ボード・入力欄のどちらにも被らずに収まる。採点ボタン・エラー文言は
                    自然な高さのまま下に置き、フリップ側はflex-1でその残りを占める。 */}
                <div className="flex h-full w-full flex-col items-center gap-2">
                  <div className="w-full min-h-[100px] flex-1">
                    <AnswerRevealCard
                      authorName={participantNames[displayedAnswer.participant_id] ?? "（名前未設定）"}
                      answerBody={displayedAnswer.body}
                      fillHeight
                      scaleUp={false}
                    />
                  </div>
                  <ScoreButtons
                    isJudge={true}
                    myScore={myScore as 0 | 1 | 2 | 3 | null}
                    resolved={displayedAnswer.resolved}
                    disabled={judgingTimeUp}
                    onScore={handleScore}
                    remainingMs={judgingRemainingMs}
                    totalMs={LIVE_ROOM_TIMING.judgeMs}
                    scaleUp={false}
                  />
                  {scoreError && scoreError.answerId === displayedAnswer.id && (
                    <p className="font-sans text-xs text-dojo-curtain-red">{scoreError.message}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AudienceLayer fixedBottomPx={-22} zIndex={5} />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-xl items-center justify-center gap-3 pb-1">
          <button
            type="button"
            onClick={() =>
              sendTsukkomi(
                "stamp",
                TSUKKOMI_TEMPLATES[Math.floor(Math.random() * TSUKKOMI_TEMPLATES.length)],
              )
            }
            disabled={!!activeAnswer}
            className="flex-1 rounded-xl border-2 border-dojo-curtain-red bg-dojo-curtain-red px-4 py-3 font-sans text-base font-bold text-dojo-washi-white transition active:scale-95 disabled:cursor-not-allowed disabled:border-dojo-gray-purple disabled:bg-dojo-gray-purple disabled:text-dojo-washi-white"
          >
            ツッコミ
          </button>
          <button
            type="button"
            onClick={() => sendTsukkomi("stamp", "爆笑")}
            disabled={!!activeAnswer}
            className="flex-1 rounded-xl border-2 border-dojo-curtain-gold bg-dojo-curtain-gold px-4 py-3 font-sans text-base font-bold text-dojo-stage-dark transition active:scale-95 disabled:cursor-not-allowed disabled:border-dojo-gray-purple disabled:bg-dojo-gray-purple disabled:text-dojo-washi-white"
          >
            爆笑
          </button>
          <button
            type="button"
            onClick={() => sendTsukkomi("clap", "👏")}
            disabled={!!activeAnswer}
            className="flex-1 rounded-xl border-2 border-dojo-backstage-navy bg-dojo-backstage-navy px-4 py-3 font-sans text-base font-bold text-dojo-curtain-gold transition active:scale-95 disabled:cursor-not-allowed disabled:border-dojo-gray-purple disabled:bg-dojo-gray-purple disabled:text-dojo-washi-white"
          >
            拍手
          </button>
        </div>
      </div>

      <TsukkomiFloatOverlayPreview />
    </ScreenShell>
  );
}
