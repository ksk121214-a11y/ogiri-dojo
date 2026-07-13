"use client";

import { AnimatePresence, motion } from "framer-motion";

import { DEMO_TIMING, TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import {
  getCurrentTurn,
  getMyScoreForCurrentJudging,
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

// ライブ観戦（客席/審査員）画面 L3
// 客席のランダム拍手演出は舞台画面でも同じ客席の熱量が伝わるよう画面共通のpage.tsx側で発生させている（§9）
// 画面はビューポート内に完全固定し（仕様書§4.5・デザイン方針§4.2）、過去の回答一覧は持たず、
// 「今まさに審査されている1件」だけを中央のスポットライトカードで使い捨て表示する。
export default function AudienceScreen() {
  const state = useLiveDemoStore((s) => s);
  const submitMyScore = useLiveDemoStore((s) => s.submitMyScore);
  const sendTsukkomi = useLiveDemoStore((s) => s.sendTsukkomi);
  const turn = getCurrentTurn(state);
  const stageGroup = getStageGroup(state);
  const judging = state.judging;

  if (!turn || !stageGroup) return null;
  const topicBody = getTopicBody(state, turn.topicId);
  const judgingAnswer = judging
    ? state.answers.find((a) => a.id === judging.answerId)
    : null;
  const activeParticipantId = judgingAnswer?.participantId ?? null;
  const myScore = getMyScoreForCurrentJudging(state);

  return (
    <ScreenShell className="!items-stretch !justify-center !overflow-hidden !px-3 !py-3 sm:!px-6 sm:!py-6">
      {/*
        StageScreenと同じ3ゾーン固定グリッド構造（お題ゾーン/舞台ゾーン/操作ゾーン、仕様書§4.5）。
        中段（舞台キャラ＋審査カード）を1frにして「残りの高さぴったり」を機械的に占有させ、
        旧実装のflex-1 + max-hの併用による「はみ出す/余る」のブレを排除する。
      */}
      <div className="grid h-full w-full grid-rows-[auto_1fr_auto] gap-2 overflow-hidden">
        <div className="flex min-h-0 flex-col items-center gap-2 overflow-hidden">
          <p className="font-sans text-xs tracking-widest text-dojo-gray-purple">
            客席・審査員
          </p>

          <div className="w-full max-w-3xl">
            <TopicBanner
              topicBody={topicBody}
              roundLabel={`第${turn.round}周 ・ ${turn.groupOrder}組目`}
            />
          </div>

          <TimerRing
            remainingMs={state.answeringRemainingMs}
            totalMs={DEMO_TIMING.answerMs}
            label="持ち時間"
            paused={judging !== null}
            size={56}
          />
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
                authorName={getParticipantName(state, judgingAnswer.participantId)}
                answerBody={judgingAnswer.body}
                remainingMs={judging.endsAt - (state.lastTickAt ?? judging.endsAt)}
                isJudge
                myScore={myScore}
                onScore={submitMyScore}
              />
            ) : (
              <div key="characters" className="flex flex-col items-center gap-2">
                <StageCharacters
                  state={state}
                  memberIds={stageGroup.memberIds}
                  activeParticipantId={activeParticipantId}
                />
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-sans text-xs text-dojo-gray-purple"
                >
                  次の登壇を待っています……
                </motion.p>
              </div>
            )}
          </AnimatePresence>
        </div>

        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-3 pb-1">
          <button
            type="button"
            onClick={() => sendTsukkomi("clap", "👏")}
            disabled={!!judging}
            className="rounded-full border border-dojo-curtain-gold/60 bg-dojo-backstage-navy px-5 py-2.5 font-sans text-sm font-bold text-dojo-curtain-gold transition hover:bg-dojo-backstage-navy/60 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
          >
            拍手 👏
          </button>
          <div className="flex flex-wrap justify-center gap-2">
            {TSUKKOMI_TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => sendTsukkomi("stamp", t)}
                disabled={!!judging}
                className="rounded-full border border-dojo-gray-purple/40 px-3 py-1.5 font-sans text-xs text-dojo-washi-white/90 transition hover:border-dojo-curtain-gold hover:text-dojo-curtain-gold disabled:cursor-not-allowed disabled:opacity-30"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TsukkomiFloatOverlay />
    </ScreenShell>
  );
}
