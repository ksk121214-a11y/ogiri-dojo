"use client";

import { useEffect, useState } from "react";

import BotSetupPanel from "@/components/live-demo/host/BotSetupPanel";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveHostStore } from "@/store/useLiveHostStore";
import { useProfileStore } from "@/store/useProfileStore";

const ROLE_LABEL: Record<string, string> = {
  player: "回答者",
  audience: "観客",
};

const PHASE_LABEL: Record<string, string> = {
  scheduled: "開演準備中",
  interlude: "幕間",
  opening: "開幕（参加登録受付中）",
  topic_reveal: "お題発表",
  answering: "回答受付中",
  group_result: "組結果発表",
  final_result: "最終結果発表",
  closed: "終了",
};

// 司会コンソール（フェーズB：最小版のUI）。開始・組分け確定・進行状況の確認・終了ができる。
export default function LiveHostPage() {
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const profile = useProfileStore((s) => s.profile);

  const live = useLiveHostStore((s) => s.live);
  const participants = useLiveHostStore((s) => s.participants);
  const hostProfiles = useLiveHostStore((s) => s.profiles);
  const groups = useLiveHostStore((s) => s.groups);
  const turns = useLiveHostStore((s) => s.turns);
  const topics = useLiveHostStore((s) => s.topics);
  const answers = useLiveHostStore((s) => s.answers);
  const scores = useLiveHostStore((s) => s.scores);
  const resolvedAnswers = useLiveHostStore((s) => s.resolvedAnswers);
  const resolvedScoresByAnswer = useLiveHostStore((s) => s.resolvedScoresByAnswer);
  const loading = useLiveHostStore((s) => s.loading);
  const error = useLiveHostStore((s) => s.error);
  const init = useLiveHostStore((s) => s.init);
  const startLive = useLiveHostStore((s) => s.startLive);
  const closeLive = useLiveHostStore((s) => s.closeLive);
  const confirmGroupingAndBegin = useLiveHostStore((s) => s.confirmGroupingAndBegin);

  const [now, setNow] = useState(() => Date.now());
  const [groupCount, setGroupCount] = useState(3);

  useEffect(() => {
    if (profile?.isHost) init();
  }, [profile?.isHost, init]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const remainingSec =
    live?.answering_paused && live.answering_remaining_ms != null
      ? Math.ceil(live.answering_remaining_ms / 1000)
      : live?.phase_deadline
        ? Math.max(0, Math.ceil((new Date(live.phase_deadline).getTime() - now) / 1000))
        : null;

  if (authLoading) return <CenterMessage>読み込み中…</CenterMessage>;

  if (!authUser) {
    return (
      <CenterMessage>
        <p className="mb-4">司会コンソールを開くにはXログインが必要です。</p>
        <button
          type="button"
          onClick={() => signInWithX()}
          className="rounded-full bg-dojo-ink px-5 py-2.5 font-sans text-sm font-bold text-dojo-washi-white"
        >
          Xでログイン
        </button>
      </CenterMessage>
    );
  }

  if (!profile?.isHost) {
    return <CenterMessage>この画面を開く権限がありません（司会役アカウントではありません）。</CenterMessage>;
  }

  const currentTopic = topics.find(
    (t) => t.id === turns.find((tu) => tu.id === live?.current_turn_id)?.topic_id,
  );
  const activeAnswer = answers.find((a) => a.revealed_at && !a.resolved);
  const queuedCount = answers.filter((a) => !a.revealed_at).length;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center gap-4 px-4 py-8 text-center">
      <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
        司会コンソール
      </p>

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">状態を確認中…</p>
      ) : !live ? (
        <button
          type="button"
          onClick={() => startLive()}
          className="rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-sm font-bold text-dojo-washi-white"
        >
          ライブを開始する
        </button>
      ) : (
        <>
          <p className="font-brush text-xl text-dojo-curtain-red">
            {PHASE_LABEL[live.current_phase] ?? live.current_phase}
          </p>
          {remainingSec !== null && (
            <p className="font-sans text-sm tabular-nums text-dojo-dark-brown">
              残り{remainingSec}秒
              {live.answering_paused && "（審査中は一時停止）"}
            </p>
          )}

          <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
            <p className="font-sans text-xs font-bold text-dojo-ink">
              参加者：{participants.length}人
            </p>
            <ul className="mt-1 max-h-32 overflow-y-auto font-sans text-[11px] text-dojo-dark-brown">
              {participants.map((p) => {
                const name =
                  hostProfiles.find((pr) => pr.id === p.user_id)?.display_name ?? "（名前未設定）";
                const groupOrder = p.group_id
                  ? groups.find((g) => g.id === p.group_id)?.group_order
                  : null;
                // 組分け前は実際のrole（常に'audience'）ではなく、本人の希望(preferred_role)を出す。
                const statusLabel = p.group_id
                  ? `${ROLE_LABEL[p.role] ?? p.role}・組${groupOrder}`
                  : `${ROLE_LABEL[p.preferred_role] ?? p.preferred_role}希望`;
                return (
                  <li key={p.id}>
                    {name}（{statusLabel}）
                  </li>
                );
              })}
            </ul>
          </div>

          {live.current_phase === "opening" && turns.length === 0 && (
            <>
              <BotSetupPanel liveId={live.id} />

              <div className="flex items-center gap-2">
                <label className="font-sans text-xs text-dojo-dark-brown">
                  組数：
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={groupCount}
                    onChange={(e) => setGroupCount(Number(e.target.value))}
                    className="ml-1 w-14 rounded border border-dojo-dark-brown/30 px-2 py-1 text-center"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => confirmGroupingAndBegin(groupCount)}
                  className="rounded-full bg-dojo-curtain-red px-4 py-2 font-sans text-xs font-bold text-dojo-washi-white"
                >
                  組分け確定してライブを進める
                </button>
              </div>
            </>
          )}

          {currentTopic && (
            <div className="w-full rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-light-brown/60 p-4">
              <p className="font-sans text-xs text-dojo-dark-brown">お題</p>
              <p className="mt-1 font-sans text-base font-bold text-dojo-ink">
                {currentTopic.body}
              </p>
            </div>
          )}

          {live.current_phase === "answering" && (
            <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left font-sans text-xs text-dojo-dark-brown">
              <p>未表示の回答：{queuedCount}件</p>
              {activeAnswer ? (
                <>
                  <p className="mt-1 font-bold text-dojo-ink">
                    表示中：{activeAnswer.body}
                  </p>
                  <p>
                    採点数：{scores.length}人・合計点：
                    {scores.reduce((sum, s) => sum + s.points, 0)}点
                  </p>
                </>
              ) : (
                <p className="mt-1">表示中の回答はありません</p>
              )}
            </div>
          )}

          {resolvedAnswers.length > 0 && (
            <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
              <p className="font-sans text-xs font-bold text-dojo-ink">
                確定済みの回答ログ（{resolvedAnswers.length}件）
              </p>
              <ul className="mt-1 max-h-56 overflow-y-auto font-sans text-[11px] text-dojo-dark-brown">
                {[...resolvedAnswers].reverse().map((a) => {
                  const participant = participants.find((p) => p.id === a.participant_id);
                  const name = participant
                    ? (hostProfiles.find((pr) => pr.id === participant.user_id)?.display_name ??
                      "（名前未設定）")
                    : "（不明な参加者）";
                  const turn = turns.find((t) => t.id === a.turn_id);
                  const groupOrder = turn
                    ? groups.find((g) => g.id === turn.group_id)?.group_order
                    : null;
                  const breakdown = (resolvedScoresByAnswer[a.id] ?? [])
                    .map((score) => {
                      const judge = participants.find((p) => p.id === score.judge_participant_id);
                      const judgeName = judge
                        ? (hostProfiles.find((pr) => pr.id === judge.user_id)?.display_name ??
                          "（名前未設定）")
                        : "（不明な参加者）";
                      return `${judgeName}=${score.points}点`;
                    })
                    .join("、");
                  return (
                    <li key={a.id} className="border-b border-dojo-dark-brown/10 py-1 last:border-0">
                      <p>
                        {groupOrder ? `【組${groupOrder}・${turn?.round}巡目】` : ""}
                        {name}：「{a.body}」→ {a.score_total}点（{a.judge_count}人中{a.top_score_votes}
                        人が3点）
                      </p>
                      {breakdown && (
                        <p className="text-dojo-dark-brown/70">採点内訳：{breakdown}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => closeLive()}
            className="rounded-full border border-dojo-dark-brown/30 px-5 py-2 font-sans text-xs font-bold text-dojo-dark-brown"
          >
            ライブを終了する
          </button>
        </>
      )}

      {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center px-4 text-center font-sans text-sm text-dojo-dark-brown">
      {children}
    </div>
  );
}
