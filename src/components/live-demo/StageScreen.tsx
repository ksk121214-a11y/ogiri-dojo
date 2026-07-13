"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { DEMO_TIMING, MAX_ANSWERS_PER_PLAYER, MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getParticipantName,
  getStageGroup,
  getTopicBody,
} from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import JudgingCard from "./JudgingCard";
import ScreenShell from "./ScreenShell";
import StageCharacters from "./StageCharacters";
import TimerRing from "./TimerRing";
import TopicBanner from "./TopicBanner";
import TsukkomiFloatOverlay from "./TsukkomiFloatOverlay";

// 回答入力（舞台）画面 L4
// 画面はビューポート内に完全固定し（仕様書§4.5・デザイン方針§4.2）、他メンバーの回答も
// 一覧化せず「今まさに審査されている1件」だけを客席と同じスポットライトカードで表示する。
export default function StageScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyAnswer = useLiveDemoStore((s) => s.submitMyAnswer);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const topicBody = turn ? getTopicBody(state, turn.topicId) : "";
  const judging = state.judging;
  const answeringRemainingMs = state.answeringRemainingMs;
  const myCount = state.answerCounts[MY_PARTICIPANT_ID] ?? 0;
  const queuedByMe = state.submissionQueue.some(
    (q) => q.participantId === MY_PARTICIPANT_ID,
  );

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ key: number; score: number } | null>(
    null,
  );
  const prevJudgingIdRef = useRef<string | null>(null);
  const popupKeyRef = useRef(0);

  useEffect(() => {
    const prevId = prevJudgingIdRef.current;
    if (prevId && judging?.answerId !== prevId) {
      const resolved = state.answers.find((a) => a.id === prevId);
      if (resolved && resolved.participantId === MY_PARTICIPANT_ID) {
        popupKeyRef.current += 1;
        const key = popupKeyRef.current;
        setPopup({ key, score: resolved.scoreTotal });
        const t = setTimeout(() => {
          setPopup((p) => (p?.key === key ? null : p));
        }, 1800);
        return () => clearTimeout(t);
      }
    }
    prevJudgingIdRef.current = judging?.answerId ?? null;
  }, [judging, state.answers]);

  if (!turn || !stageGroup) return null;

  const judgingAnswer = judging
    ? state.answers.find((a) => a.id === judging.answerId)
    : null;
  const activeParticipantId = judgingAnswer?.participantId ?? null;
  const isMyAnswerJudging = judgingAnswer?.participantId === MY_PARTICIPANT_ID;

  const handleSubmit = () => {
    const result = submitMyAnswer(draft);
    if (result.ok) {
      setDraft("");
      setError(null);
    } else {
      setError(result.reason ?? "送信できませんでした");
    }
  };

  // 排他制御・キュー処理の対象は「送信」だけ。テキストの入力・編集自体は
  // 審査サイクル中でも常に可能にする（回数上限に達した場合のみ入力欄を閉じる）§6。
  const overLimit = myCount >= MAX_ANSWERS_PER_PLAYER;
  const submitDisabled = overLimit || queuedByMe || !draft.trim();

  return (
    <ScreenShell className="!items-stretch !justify-center !overflow-hidden !px-3 !py-3 sm:!px-6 sm:!py-6">
      {/*
        3ゾーン固定グリッド（お題ゾーン/舞台ゾーン/操作ゾーン、仕様書§4.5・改訂方針）。
        grid-rows-[auto_1fr_auto] により、上段（お題・タイマー）と下段（入力欄）は内容量ぶんの高さだけを取り、
        中段（舞台キャラ＋審査カード）が「残りの高さぴったり」を機械的に占有する。
        flex-1 と max-h の併用（旧実装）は、内容量によって「はみ出す」か「余る」かのどちらかに
        ブレていたのが崩れの根本原因だったため、両者を明示的な行に分離して排除している。
      */}
      <div className="grid h-full w-full grid-rows-[auto_1fr_auto] gap-2 overflow-hidden">
        <div className="flex min-h-0 flex-col items-center gap-2 overflow-hidden">
          <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
            あなたの組の番です・舞台
          </p>

          <div className="w-full max-w-3xl">
            <TopicBanner
              topicBody={topicBody}
              roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <TimerRing
              remainingMs={answeringRemainingMs}
              totalMs={DEMO_TIMING.answerMs}
              label="持ち時間"
              paused={judging !== null}
              size={56}
            />
            <div className="flex items-center gap-2">
              {Array.from({ length: MAX_ANSWERS_PER_PLAYER }).map((_, i) => (
                <span
                  key={i}
                  className={`h-4 w-4 rounded-full border border-dojo-curtain-gold ${
                    i < myCount ? "bg-dojo-curtain-gold" : "bg-transparent"
                  }`}
                />
              ))}
              <span className="ml-1 font-sans text-xs text-dojo-gray-purple">
                残り{Math.max(0, MAX_ANSWERS_PER_PLAYER - myCount)}回
              </span>
            </div>
          </div>
        </div>

        {/*
          審査サイクル中はキャラ列とJudgingCardを同時表示せず入れ替える（AnimatePresence mode="wait"）。
          両方を同時に出そうとして縦幅を奪い合うことが「レイヤーが崩れる／見切れる」の主因だったため、
          「今まさに審査されている1件」だけを見せる仕様書§4.5の使い捨て表示の考え方に合わせて一本化した。
        */}
        <div className="flex min-h-0 w-full flex-col items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            {judging && judgingAnswer ? (
              <JudgingCard
                key="judging"
                authorName={
                  getParticipantName(state, judgingAnswer.participantId) +
                  (isMyAnswerJudging ? "（あなた）" : "")
                }
                answerBody={judgingAnswer.body}
                remainingMs={judging.endsAt - (state.lastTickAt ?? judging.endsAt)}
                isJudge={false}
                myScore={null}
              />
            ) : (
              <StageCharacters
                key="characters"
                state={state}
                memberIds={stageGroup.memberIds}
                activeParticipantId={activeParticipantId}
              />
            )}
          </AnimatePresence>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mx-auto w-full max-w-xl"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={overLimit}
            placeholder={
              overLimit
                ? "回答できる回数の上限に達しました"
                : queuedByMe
                  ? "送信済み。審査待ちです（続けて次の回答を書けます）"
                  : "回答を入力……"
            }
            rows={2}
            className="w-full resize-none rounded-xl border border-dojo-gray-purple/40 bg-dojo-stage-dark px-4 py-2.5 font-sans text-lg text-dojo-washi-white placeholder:text-dojo-gray-purple focus:border-dojo-curtain-gold focus:outline-none disabled:opacity-50 [@media(max-height:600px)]:py-1.5 [@media(max-height:600px)]:text-base"
          />
          {error && (
            <p className="mt-1 font-sans text-xs text-dojo-curtain-red">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="mt-2 w-full rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-lg font-bold text-dojo-washi-white transition hover:bg-dojo-deep-crimson disabled:cursor-not-allowed disabled:opacity-40 [@media(max-height:600px)]:py-2 [@media(max-height:600px)]:text-base"
          >
            {queuedByMe ? "審査待ち……" : "送信する"}
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
            className="pointer-events-none fixed left-1/2 top-1/3 -translate-x-1/2 font-brush text-6xl text-dojo-curtain-gold drop-shadow-[0_0_20px_rgba(232,184,76,0.8)]"
          >
            +{popup.score}
          </motion.div>
        )}
      </AnimatePresence>

      <TsukkomiFloatOverlay />
    </ScreenShell>
  );
}
