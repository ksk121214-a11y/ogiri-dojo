"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEMO_TIMING,
  MAX_ANSWERS_PER_PLAYER,
  MY_PARTICIPANT_ID,
  SCORE_REVEAL_DELAY_MS,
} from "@/data/liveDemoData";
import AnswerRevealCard from "@/components/live-room/AnswerRevealCard";
import AudienceLayer from "./AudienceLayer";
import LaughMarkOverlay from "./LaughMarkOverlay";
import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { playSfx } from "@/lib/sfx";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import LiveStageBackdrop from "./LiveStageBackdrop";
import ScoringPhysicsBoard, { type ScoreEvent } from "./ScoringPhysicsBoard";
import ScreenShell from "./ScreenShell";
import StageCharacters from "./StageCharacters";
import TimerRing from "./TimerRing";
import StageHeaderBanner from "./StageHeaderBanner";
import TsukkomiDanmakuOverlay from "./TsukkomiDanmakuOverlay";

// 回答入力（舞台）画面 L4
// 画面はビューポート内に完全固定し（仕様書§4.5・デザイン方針§4.2）、他メンバーの回答も
// 一覧化せず「今まさに審査されている1件」だけを客席と同じスポットライトカードで表示する。
// お題表示・採点演出は本番のlive-room（StageAnsweringView.tsx）と同じ
// ScoringPhysicsBoard（玉が降ってくる物理演算ボード）+ AnswerRevealCard（回答フリップ）
// 方式（design-preview-2で先に組んだのと同じ構成）。ゲーム進行ロジック自体は
// useLiveDemoStoreのまま変えておらず、見た目・お題表示方式だけをこれに揃えている。
export default function StageScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyAnswer = useLiveDemoStore((s) => s.submitMyAnswer);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const topicBody = turn ? getTopicBody(state, turn.topicId) : "";
  const judging = state.judging;
  const revealPending = state.revealPending;
  const answeringRemainingMs = state.answeringRemainingMs;
  const myCount = state.answerCounts[MY_PARTICIPANT_ID] ?? 0;
  // 「送信して審査待ちで予約」の仕組みは廃止。誰かの回答が表示・審査されている間は
  // 送信そのものができない（入力は引き続き可能）§6改訂。
  // 採点確定後、玉が消えて点数を見せている「間」（revealGateUntil）もまだ次の人へは
  // 進んでいないので、その間も送信できないようにする（一件ずつ順番に進む演出のため）。
  const busyWithOthers =
    judging !== null ||
    revealPending !== null ||
    (state.lastTickAt ?? 0) < state.revealGateUntil;

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ key: number; score: number } | null>(
    null,
  );
  // 回答フリップが消えたあと(猶予表示が切れたあと)にその人の回答席で見えるように、
  // 回答フリップの猶予(useJudgingDisplayの既定3600ms)より長く持たせる。
  const [seatScore, setSeatScore] = useState<{ participantId: string; value: number } | null>(
    null,
  );
  const prevJudgingIdRef = useRef<string | null>(null);
  const popupKeyRef = useRef(0);

  useEffect(() => {
    const prevId = prevJudgingIdRef.current;
    // 「直前どのanswerIdを見ていたか」は、この下の分岐で早期returnしても必ず
    // 更新する（前回、returnより後ろに置いていたせいで最初の1件目より後は
    // 一切更新されず、2件目以降もずっと1件目のスコアを1件目の回答席に出し
    // 続けてしまうバグがあった）。
    prevJudgingIdRef.current = judging?.answerId ?? null;
    if (prevId && judging?.answerId !== prevId) {
      const resolvedAnswer = state.answers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        // 回答フリップが消えて→少し間を置いて→採点ボードの玉が弾けて消え終わる
        // (SCORE_REVEAL_DELAY_MS後)まで待ってから、回答席に得点を表示する。
        const revealTimer = setTimeout(() => {
          setSeatScore({ participantId: resolvedAnswer.participantId, value: resolvedAnswer.scoreTotal });
          setTimeout(() => setSeatScore(null), DEMO_TIMING.scoreDisplayMs);
          if (resolvedAnswer.participantId === MY_PARTICIPANT_ID) {
            popupKeyRef.current += 1;
            const key = popupKeyRef.current;
            setPopup({ key, score: resolvedAnswer.scoreTotal });
            setTimeout(() => {
              setPopup((p) => (p?.key === key ? null : p));
            }, 1800);
          }
        }, SCORE_REVEAL_DELAY_MS);
        return () => clearTimeout(revealTimer);
      }
    }
  }, [judging, state.answers]);

  const activeAnswer = judging
    ? state.answers.find((a) => a.id === judging.answerId) ?? null
    : null;
  // activeAnswerは審査サイクルが終わった瞬間storeからnullになるが、回答フリップ・
  // 採点ボードはそのままだと表示する間もなく消えてしまうため、確定後も一呼吸ぶんだけ
  // 直前の回答を表示し続ける（本番のlive-room版と同じuseJudgingDisplayフック）。
  const displayedAnswer = useJudgingDisplay(activeAnswer, state.answers, DEMO_TIMING.revealGraceMs);

  // 採点ボード（ScoringPhysicsBoard）が表示する「今の1件」は、回答フリップ(displayedAnswer)
  // よりも長く生き続ける必要がある。フリップはrevealGraceMs後に消えるが、ボードの玉は
  // そこからさらにballPopPauseMsぶん間を置いてから弾けるため、displayedAnswerの寿命に
  // 合わせてボードのroundKeyまで一緒にnullへ戻してしまうと、弾ける演出の前に玉が
  // 一瞬で消える（ハードリセットされる）事故になる。そのため、ボード用のroundIdは
  // 「直近judingが持っていたanswerId」を、次の新しいジャッジが始まるまで保持し続ける
  // 専用のstateとして別管理する。
  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  // レンダー中にstateを調整する公式パターン(useEffectではなくレンダー本体で直接setState)。
  // judging.answerIdが新しくなった瞬間だけ更新され、それ以外は毎回同じ値を返すため
  // 無限ループにはならない。
  if (judging?.answerId && judging.answerId !== boardRoundId) {
    setBoardRoundId(judging.answerId);
  }
  const boardAnswer = boardRoundId ? state.answers.find((a) => a.id === boardRoundId) ?? null : null;
  // 回答フリップが新しいboardRoundIdで登場するたびに1回だけ鳴らす（スポットライトが
  // 当たる合図）。マウント時の初回登場ぶんもここで自然にカバーされる。
  const spotlightSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (boardRoundId && boardRoundId !== spotlightSeenRef.current) {
      spotlightSeenRef.current = boardRoundId;
      playSfx("spotlightIn");
    }
  }, [boardRoundId]);
  // 回答送信音は「自分が送信した時だけ」ではなく、他の参加者(ボット含む)が送信した
  // 時にも同じように鳴らしたいので、state.answersの件数そのものを監視する
  // （誰の送信でも増える＝送信の唯一の共通シグナルのため）。マウント時点で既にある
  // 分は対象外にし、その後増えた時だけ鳴らす。
  const answerCountSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (answerCountSeenRef.current !== null && state.answers.length > answerCountSeenRef.current) {
      playSfx("answerSubmit");
    }
    answerCountSeenRef.current = state.answers.length;
  }, [state.answers.length]);
  // live-demoのDemoAnswerには本番のAnswerRowと違いresolvedフィールドが無いため、
  // 「store上のjudgingが終わっている（=このサイクルは確定済み）」を同じ意味として使う。
  // ゲート(revealGateUntil)により次のジャッジが始まるまではjudgingはnullのままなので、
  // boardRoundIdが指す回答と実際に一致する。
  const resolved = judging === null;

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? state.scores
            .filter((s) => s.answerId === boardAnswer.id)
            .map((s) => ({ id: `${s.answerId}-${s.judgeParticipantId}`, points: s.points }))
        : [],
    [state.scores, boardAnswer],
  );

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

  if (!turn || !stageGroup) return null;

  const activeParticipantId = activeAnswer?.participantId ?? null;
  const isMyAnswerJudging = displayedAnswer?.participantId === MY_PARTICIPANT_ID;
  const eligibleJudgeCount = state.participants.filter(
    (p) => !stageGroup.memberIds.includes(p.id),
  ).length;
  const maxBalls = Math.max(3, eligibleJudgeCount * 3);

  const handleSubmit = () => {
    const result = submitMyAnswer(draft);
    if (result.ok) {
      setDraft("");
      setError(null);
    } else {
      setError(result.reason ?? "送信できませんでした");
    }
  };

  // 排他制御の対象は「送信」だけ。テキストの入力・編集自体は
  // 審査サイクル中でも常に可能にする（回数上限に達した場合のみ入力欄を閉じる）§6。
  const overLimit = myCount >= MAX_ANSWERS_PER_PLAYER;
  const submitDisabled = overLimit || busyWithOthers || !draft.trim();

  return (
    <ScreenShell className="!items-stretch !justify-center !overflow-visible !px-3 !pt-1 !pb-1">
      <LiveStageBackdrop variant="neon2" />
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_auto_minmax(140px,1fr)_auto] gap-1 overflow-visible">
        <StageHeaderBanner variant="neon2" />
        {/* 客席シルエット(AudienceLayer, z-5)が大きく、上端がこの行の高さまで
            届くことがあるため、ボードだけでなく「残り○回」表示も含めたこの行
            全体にz-indexを与えて常に手前に表示する。 */}
        <div className="relative z-20 -mt-[22px] flex min-h-0 flex-col items-center gap-2 overflow-visible sm:-mt-[32px]">
          <div
            ref={boardBoxRef}
            className="relative flex w-full justify-center"
            style={{ height: boardFitted ? boardFitted.height : "38vh" }}
          >
            <div
              className="relative"
              style={boardFitted ? { width: boardFitted.width, height: boardFitted.height } : undefined}
            >
              <ScoringPhysicsBoard
                variant="neon2"
                topicBody={topicBody}
                roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={resolved}
                resolvedPopDelayMs={DEMO_TIMING.revealGraceMs + DEMO_TIMING.ballPopPauseMs}
                roundKey={boardRoundId}
              />
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  totalMs={DEMO_TIMING.answerMs}
                  paused={busyWithOthers}
                  size={40}
                  darkText
                  palette="neon2"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {Array.from({ length: MAX_ANSWERS_PER_PLAYER }).map((_, i) => (
              <span
                key={i}
                className={`h-4 w-4 rounded-full border border-[#3b5bff] ${
                  i < myCount ? "bg-[#3b5bff]" : "bg-transparent"
                }`}
              />
            ))}
            <span className="ml-1 font-sans text-xs text-white/60">
              残り{Math.max(0, MAX_ANSWERS_PER_PLAYER - myCount)}回
            </span>
          </div>
        </div>

        {/*
          舞台・アイコンは審査中でも消さず常時表示する。回答フリップはその手前に
          absoluteで重ねる「ドカンと出る」演出にし、スペースを奪い合って
          どちらかが消える・縮む構成を避ける。
        */}
        <div className="relative flex min-h-0 w-full flex-1 items-start justify-center overflow-visible">
          <StageCharacters
            state={state}
            memberIds={stageGroup.memberIds}
            activeParticipantId={activeParticipantId}
            revealPendingParticipantId={revealPending?.participantId ?? null}
            scoreRevealParticipantId={seatScore?.participantId ?? null}
            scoreRevealValue={seatScore?.value ?? null}
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
                    getParticipantName(state, displayedAnswer.participantId) +
                    (isMyAnswerJudging ? "（あなた）" : "")
                  }
                  answerBody={displayedAnswer.body}
                  fillHeight
                  scaleUp={false}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <AudienceLayer
            fixedBottomPx={-45}
            zIndex={5}
            imageSrc="/images/live2/audience-2-crop.png"
            fixedRenderWidthPx={614}
            fixedRenderHeightPx={216}
            imageClassName="brightness-150 contrast-125"
          />
          <LaughMarkOverlay />
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
          {error && (
            <p className="mt-1 font-sans text-xs text-red-400">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="mx-auto mt-2 block w-1/2 max-w-[11rem] rounded-xl border-2 border-[#3b5bff] bg-[#3b5bff] px-4 py-2 font-sans text-base font-bold text-white transition hover:bg-[#2947e0] disabled:cursor-not-allowed disabled:border-[#5b6bb0] disabled:bg-[#5b6bb0] disabled:text-white/60 [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-sm"
          >
            {busyWithOthers ? "審査中…" : "送信する"}
          </button>
        </motion.div>
      </div>

      <AnimatePresence>
        {popup && (
          <motion.div
            key={popup.key}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, y: -30, scale: 1 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="pointer-events-none fixed left-1/2 top-1/3 -translate-x-1/2 font-sans text-6xl font-black text-[#7ab2ff] drop-shadow-[0_0_20px_rgba(59,91,255,0.8)]"
          >
            +{popup.score}
          </motion.div>
        )}
      </AnimatePresence>

      <TsukkomiDanmakuOverlay />
    </ScreenShell>
  );
}
