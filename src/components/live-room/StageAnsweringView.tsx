"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import AudienceLayer from "@/components/live-demo/AudienceLayer";
import LiveStageBackdrop from "@/components/live-demo/LiveStageBackdrop";
import ScoreButtons from "@/components/live-demo/ScoreButtons";
import ScoringPhysicsBoard, { type ScoreEvent } from "@/components/live-demo/ScoringPhysicsBoard";
import ScreenShell from "@/components/live-demo/ScreenShell";
import StageHeaderBanner from "@/components/live-demo/StageHeaderBanner";
import TimerRing from "@/components/live-demo/TimerRing";
import { LIVE_ROOM_TIMING, MAX_ANSWERS_PER_PLAYER, SCORE_REVEAL_DELAY_MS } from "@/data/liveRoomTiming";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { useJudgingDisplay } from "@/lib/useJudgingDisplay";
import { fitAspect, useElementSize } from "@/lib/useElementSize";
import { playSfx } from "@/lib/sfx";
import { useTickingNow } from "@/lib/useTickingNow";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import AnswerRevealCard from "./AnswerRevealCard";
import LaughMarkOverlay from "./LaughMarkOverlay";
import StageCharactersView from "./StageCharactersView";
import TsukkomiDanmakuOverlay from "./TsukkomiDanmakuOverlay";

// 回答入力（舞台）画面の実バックエンド版。src/components/live-demo/StageScreen.tsxと
// 同じ見た目・排他制御の考え方だが、useLiveDemoStoreではなく実際のDB/Realtimeを見る
// useLiveFollowerStoreを直接使う（このコンポーネントは/live/answering専用の1箇所でしか使わないため、
// propsで全部受け渡すより自分でストアを読む方がシンプルになる）。
export default function StageAnsweringView() {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const groups = useLiveFollowerStore((s) => s.groups);
  const currentTurn = useLiveFollowerStore((s) => s.currentTurn);
  const currentTopic = useLiveFollowerStore((s) => s.currentTopic);
  const activeAnswer = useLiveFollowerStore((s) => s.activeAnswer);
  const turnAnswers = useLiveFollowerStore((s) => s.turnAnswers);
  const activeAnswerScores = useLiveFollowerStore((s) => s.activeAnswerScores);
  const myAnswerCount = useLiveFollowerStore((s) => s.myAnswerCount);
  const submitMyAnswer = useLiveFollowerStore((s) => s.submitMyAnswer);

  const now = useTickingNow(150);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 回答フリップが消えたあと(猶予表示が切れたあと)にその人の回答席で見えるように、
  // 回答フリップの猶予(useJudgingDisplayの既定3600ms)より長く持たせる。
  // 参加者ID→点数のマップにしているのは、確定が立て続けに起きた場合でも
  // 前の人の予約タイマーを次の人の検知が巻き込んで消してしまわないようにするため
  // （下のuseEffectのクリーンアップでrevealTimerを消すと、2件目の確定を検知した
  // 瞬間に1件目の表示予約が丸ごとキャンセルされ「点数が出る時と出ない時がある」
  // 不具合になっていた）。
  const [seatScores, setSeatScores] = useState<Record<string, number>>({});
  const prevActiveIdRef = useRef<string | null>(null);
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const prevId = prevActiveIdRef.current;
    // 「直前どのanswerIdを見ていたか」は、この下の分岐で早期returnしても必ず
    // 更新する（returnより後ろに置くと、2件目以降ずっと1件目のスコアを1件目の
    // 回答席に出し続けてしまうバグになる。src/components/live-demo/StageScreen.tsx参照）。
    prevActiveIdRef.current = activeAnswer?.id ?? null;
    if (prevId && activeAnswer?.id !== prevId) {
      const resolvedAnswer = turnAnswers.find((a) => a.id === prevId);
      if (resolvedAnswer) {
        const participantId = resolvedAnswer.participant_id;
        const value = resolvedAnswer.score_total;
        // 回答フリップが消えて→少し間を置いて→採点ボードの玉が弾けて消え終わる
        // (SCORE_REVEAL_DELAY_MS後)まで待ってから、回答席に得点を表示する。
        // このタイマーはuseEffectの依存配列変化(＝次の確定の検知)で巻き込みキャンセル
        // されないよう、ここではcleanupを返さない（アンマウント時だけ下のuseEffectで
        // まとめて掃除する）。
        const revealTimer = setTimeout(() => {
          pendingTimersRef.current.delete(revealTimer);
          setSeatScores((prev) => ({ ...prev, [participantId]: value }));
          const hideTimer = setTimeout(() => {
            pendingTimersRef.current.delete(hideTimer);
            setSeatScores((prev) => {
              if (prev[participantId] !== value) return prev; // 既に別の値で上書きされていたら触らない
              const next = { ...prev };
              delete next[participantId];
              return next;
            });
          }, LIVE_ROOM_TIMING.scoreDisplayMs);
          pendingTimersRef.current.add(hideTimer);
        }, SCORE_REVEAL_DELAY_MS);
        pendingTimersRef.current.add(revealTimer);
      }
    }
  }, [activeAnswer, turnAnswers]);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // 採点ボード（ScoringPhysicsBoard）が表示する「今の1件」は、回答フリップ(displayedAnswer)
  // よりも長く生き続ける必要がある。フリップは確定後の表示猶予が切れると消えるが、
  // ボードの玉はそこからさらに間を置いてから弾けるため、displayedAnswerの寿命に合わせて
  // ボードのroundKeyまで一緒にリセットしてしまうと、弾ける演出の前に玉が一瞬で消える
  // （ハードリセットされる）事故になる（src/components/live-demo/StageScreen.tsx参照）。
  const [boardRoundId, setBoardRoundId] = useState<string | null>(null);
  // レンダー中にstateを調整する公式パターン(useEffectではなくレンダー本体で直接setState)。
  // activeAnswer.idが新しくなった瞬間だけ更新され、それ以外は毎回同じ値を返すため
  // 無限ループにはならない。
  if (activeAnswer?.id && activeAnswer.id !== boardRoundId) {
    setBoardRoundId(activeAnswer.id);
  }
  const boardAnswer = boardRoundId ? turnAnswers.find((a) => a.id === boardRoundId) ?? null : null;
  const spotlightSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (boardRoundId && boardRoundId !== spotlightSeenRef.current) {
      spotlightSeenRef.current = boardRoundId;
      playSfx("spotlightIn");
    }
  }, [boardRoundId]);
  // 回答送信音は誰が送信しても鳴らしたいので、turnAnswersの件数増加を監視する
  // （turnAnswersはターンが変わるたびに[]へリセットされるが、その場合は「減少」なので
  // 何も鳴らさず基準だけ更新される＝次のターンでも正しく動く）。
  const answerCountSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (answerCountSeenRef.current !== null && turnAnswers.length > answerCountSeenRef.current) {
      playSfx("answerSubmit");
    }
    answerCountSeenRef.current = turnAnswers.length;
  }, [turnAnswers.length]);

  // 確定した瞬間も回答カードを表示し続ける猶予ぶんだけ残す（activeAnswerは確定と同時にnullになるため）。
  // revealGraceMsを明示的に渡すことで、玉が弾け始めるタイミング(resolvedPopDelayMs)や
  // 得点表示のタイミング(SCORE_REVEAL_DELAY_MS)と揃える。
  const displayedAnswer = useJudgingDisplay(activeAnswer, turnAnswers, LIVE_ROOM_TIMING.revealGraceMs);

  const scoreEvents: ScoreEvent[] = useMemo(
    () =>
      boardAnswer
        ? activeAnswerScores
            .filter((s) => s.answer_id === boardAnswer.id)
            .map((s) => ({ id: `${s.answer_id}-${s.judge_participant_id}`, points: s.points }))
        : [],
    [activeAnswerScores, boardAnswer],
  );

  const [boardBoxRef, boardBoxSize] = useElementSize<HTMLDivElement>();
  const boardFitted = boardBoxSize ? fitAspect(boardBoxSize.width, boardBoxSize.height, 16 / 9) : null;

  if (!live || !currentTurn || !currentTopic || !myParticipant) return null;

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 0;
  const stageMembers = participants
    .filter((p) => p.role === "player" && p.group_id === currentTurn.group_id)
    .map((p) => ({ id: p.id, name: participantNames[p.id] ?? "（名前未設定）" }));

  const activeParticipantId = activeAnswer?.participant_id ?? null;
  // 送信直後・司会がまだ表示していない「一呼吸」中(revealDelayMs)の対象者。
  // activeAnswerが無い間、キューの先頭(最も古い未表示回答、司会側のprocessRevealQueueが
  // 次にrevealする対象と同じ選び方)の投稿者を光らせる。回答フリップがまだ画面を
  // 覆っていないため、回答席の光る演出が実際に見える唯一のタイミング。
  const revealPendingParticipantId = activeAnswer
    ? null
    : [...turnAnswers]
        .filter((a) => !a.revealed_at)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
        ?.participant_id ?? null;
  const eligibleJudgeCount = participants.filter(
    (p) => p.role === "player" && p.group_id !== currentTurn.group_id,
  ).length;
  const maxBalls = Math.max(3, eligibleJudgeCount * 3);
  // 審査サイクル中(=司会が持ち時間を一時停止している間)は送信を止める。lives.answering_pausedは
  // 「表示中の回答がある」だけでなく「直前の採点確定演出(reveal_sequence_until)が終わって
  // いない」間もtrueのままになるよう司会側(useLiveHostStore.ts)で拡張済みだが、これは司会の
  // ポーリング(最大500ms間隔)を経由してlivesテーブル経由で伝わるため、多少の遅れが出うる。
  // 誰かが送信した直後、実際にはもう「busy」なのにこの伝搬が間に合わず送信ボタンが
  // 一瞬押せてしまう隙間があったため、turnAnswers（Realtimeで即座に届く）から
  // 未表示・未確定の回答が無いかを自前でも判定し、両方のORで即座にロックする
  // （最終的な二重送信の防止はDB側のanswers_one_unresolved_per_turn制約が担保する）。
  const busyByTurnAnswers = turnAnswers.some((a) => !a.revealed_at || (a.revealed_at && !a.resolved));
  const busyWithOthers = live.answering_paused || busyByTurnAnswers;

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
      <LiveStageBackdrop variant="neon2" />
      <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_auto_minmax(140px,1fr)_auto] gap-1 overflow-visible">
        <StageHeaderBanner variant="neon2" />
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
                topicBody={currentTopic.body}
                roundLabel={`第${currentTurn.round}周 ・ ${groupOrder}組目`}
                maxBalls={maxBalls}
                scoreEvents={scoreEvents}
                resolved={boardAnswer?.resolved ?? false}
                resolvedPopDelayMs={LIVE_ROOM_TIMING.revealGraceMs + LIVE_ROOM_TIMING.ballPopPauseMs}
                roundKey={boardRoundId}
              />
              <div className="absolute right-8 top-5">
                <TimerRing
                  remainingMs={answeringRemainingMs}
                  totalMs={LIVE_ROOM_TIMING.answerMs}
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
                  i < myAnswerCount ? "bg-[#3b5bff]" : "bg-transparent"
                }`}
              />
            ))}
            <span className="ml-1 font-sans text-xs text-white/60">
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
          <StageCharactersView
            members={stageMembers}
            activeParticipantId={activeParticipantId}
            revealPendingParticipantId={revealPendingParticipantId}
            scoreReveals={seatScores}
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
                <div className="flex h-full w-full flex-col items-center gap-2">
                  <div className="w-full min-h-[100px] flex-1">
                    <AnswerRevealCard
                      authorName={truncateLiveDisplayName(
                        participantNames[displayedAnswer.participant_id] ?? "（名前未設定）",
                      )}
                      answerBody={displayedAnswer.body}
                      fillHeight
                      scaleUp={false}
                      hideAuthorName
                    />
                  </div>
                  <ScoreButtons
                    isJudge={false}
                    myScore={null}
                    resolved={displayedAnswer.resolved}
                    remainingMs={judgingRemainingMs}
                    totalMs={LIVE_ROOM_TIMING.judgeMs}
                    scaleUp={false}
                  />
                </div>
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
          {error && <p className="mt-1 font-sans text-xs text-red-400">{error}</p>}
          <div className="mt-2 flex items-center justify-center gap-3">
            {/* タイマー表示時にボタンが右にずれないよう、反対側に同じ幅の
                透明スペーサーを置いてボタンを常に中央固定にする。 */}
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
              <TimerRing
                remainingMs={judgingRemainingMs}
                totalMs={LIVE_ROOM_TIMING.judgeMs}
                size={40}
                palette="neon2"
              />
            )}
          </div>
        </motion.div>
      </div>

      <TsukkomiDanmakuOverlay />
    </ScreenShell>
  );
}
