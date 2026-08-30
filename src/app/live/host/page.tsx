"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import BotSetupPanel from "@/components/live-demo/host/BotSetupPanel";
import { ROUNDS_PER_LIVE_DEFAULT } from "@/data/liveRoomTiming";
import type { LivePreparationInput } from "@/store/useLiveHostStore";
import { useLiveHostStore } from "@/store/useLiveHostStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import type { GroupRow, ParticipantRow, TopicRow } from "@/lib/liveRoomTypes";

const ROLE_LABEL: Record<string, string> = {
  player: "回答者",
  audience: "観客",
};

const PHASE_LABEL: Record<string, string> = {
  scheduled: "準備中（受付前）",
  interlude: "幕間（受付中）",
  opening: "開幕（参加登録受付中）",
  topic_reveal: "お題発表",
  answering: "回答受付中",
  group_result: "組結果発表",
  final_result: "最終結果発表",
  closed: "終了",
};

// datetime-local用のローカル時刻文字列→ISO文字列の変換。
// ブラウザのタイムゾーン（日本時間想定）でそのまま入力できるようにする。
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// 司会コンソール（運営者専用管理画面・第1段階）。
// 「ライブ準備 → 参加受付開始 → 組分け確認・お題確認 → ゲーム開始 → 進行監視 → 終了」の
// 一連の流れをこの1画面（/live/host）で扱う。ゲーム進行中の表示・操作（お題発表〜最終結果、
// 終了ボタン）は既存の実装をそのまま維持している。
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
  const closeLive = useLiveHostStore((s) => s.closeLive);
  const beginGame = useLiveHostStore((s) => s.beginGame);

  const [now, setNow] = useState(() => Date.now());
  const [closing, setClosing] = useState(false);

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
    return <CenterMessage>この画面を開く権限がありません（運営者アカウントではありません）。</CenterMessage>;
  }

  const currentTopic = topics.find(
    (t) => t.id === turns.find((tu) => tu.id === live?.current_turn_id)?.topic_id,
  );
  const activeAnswer = answers.find((a) => a.revealed_at && !a.resolved);
  const queuedCount = answers.filter((a) => !a.revealed_at).length;

  const handleCloseLive = async () => {
    if (closing) return; // 連打防止
    const confirmed = window.confirm("ライブを終了しますか？この操作は取り消せません。");
    if (!confirmed) return;
    setClosing(true);
    try {
      await closeLive();
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col items-center gap-4 px-4 py-8 text-center">
      <Link href="/admin" className="self-start font-sans text-xs text-dojo-dark-brown underline">
        ← 運営者専用管理画面トップへ
      </Link>
      <p className="font-sans text-xs tracking-widest text-dojo-dark-brown">
        ライブ準備・操作
      </p>

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">状態を確認中…</p>
      ) : !live ? (
        <PreparationForm />
      ) : (
        <>
          <p className="font-brush text-xl text-dojo-curtain-red">
            {live.sequence_number ? `${formatLiveTicketNo(live.sequence_number)} ` : ""}
            {PHASE_LABEL[live.current_phase] ?? live.current_phase}
          </p>
          {live.title && <p className="font-sans text-sm font-bold text-dojo-ink">{live.title}</p>}
          {remainingSec !== null && (
            <p className="font-sans text-sm tabular-nums text-dojo-dark-brown">
              残り{remainingSec}秒
              {live.answering_paused && "（審査中は一時停止）"}
            </p>
          )}

          {live.current_phase === "scheduled" && <ReceptionStartPanel />}

          <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
            <p className="font-sans text-xs font-bold text-dojo-ink">
              参加者：{participants.length}人
              {live.max_players != null && (
                <span className="text-dojo-dark-brown">
                  （プレイヤー{participants.filter((p) => p.preferred_role === "player").length}/
                  {live.max_players}人）
                </span>
              )}
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

          {(live.current_phase === "interlude" || live.current_phase === "opening") && (
            <GroupingPanel participants={participants} groups={groups} topics={topics} />
          )}

          {(live.current_phase === "interlude" ||
            live.current_phase === "opening" ||
            live.current_phase === "topic_reveal" ||
            live.current_phase === "answering" ||
            live.current_phase === "group_result" ||
            live.current_phase === "final_result") && <AnnouncementPanel />}

          {live.current_phase === "opening" && turns.length === 0 && (
            <>
              <BotSetupPanel liveId={live.id} />
              <button
                type="button"
                onClick={() => beginGame()}
                className="rounded-full bg-dojo-curtain-red px-4 py-2 font-sans text-xs font-bold text-dojo-washi-white"
              >
                ゲームを開始する
              </button>
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
            disabled={closing}
            onClick={handleCloseLive}
            className="rounded-full border border-dojo-dark-brown/30 px-5 py-2 font-sans text-xs font-bold text-dojo-dark-brown disabled:opacity-50"
          >
            {closing ? "終了処理中…" : "ライブを終了する"}
          </button>
        </>
      )}

      {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}
    </div>
  );
}

// ライブ準備画面：liveが無い（またはclosed後）の時に表示するフォーム。
function PreparationForm() {
  const createLivePreparation = useLiveHostStore((s) => s.createLivePreparation);
  const topicBank = useLiveHostStore((s) => s.topicBank);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [receptionStartsAt, setReceptionStartsAt] = useState("");
  const [receptionEndsAt, setReceptionEndsAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(15);
  const [groupCount, setGroupCount] = useState(3);
  const [topicMode, setTopicMode] = useState<"random" | "manual">("random");
  const [manualTopicIds, setManualTopicIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const neededTopics = groupCount * ROUNDS_PER_LIVE_DEFAULT;

  const handleSubmit = async () => {
    setLocalError(null);
    const input: LivePreparationInput = {
      title,
      description,
      scheduledAt: fromDatetimeLocalValue(scheduledAt) ?? new Date().toISOString(),
      receptionStartsAt: fromDatetimeLocalValue(receptionStartsAt),
      receptionEndsAt: fromDatetimeLocalValue(receptionEndsAt),
      maxPlayers: maxPlayers > 0 ? maxPlayers : null,
      groupCount,
      topicSelection:
        topicMode === "random"
          ? { mode: "random" }
          : { mode: "manual", topicBankIds: manualTopicIds },
    };
    setSubmitting(true);
    const result = await createLivePreparation(input);
    setSubmitting(false);
    if (!result.ok) setLocalError(result.reason ?? "保存に失敗しました");
  };

  const toggleManualTopic = (id: string) => {
    setManualTopicIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="flex w-full flex-col gap-3 text-left">
      <p className="text-center font-sans text-sm font-bold text-dojo-ink">
        ライブ準備画面（次回ライブの設定）
      </p>

      <LabeledInput label="タイトル">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：第721回 定例ライブ"
          className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
        />
      </LabeledInput>

      <LabeledInput label="簡単な説明">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
        />
      </LabeledInput>

      <LabeledInput label="開始日時">
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
        />
      </LabeledInput>

      <div className="flex gap-2">
        <LabeledInput label="受付開始時刻" className="flex-1">
          <input
            type="datetime-local"
            value={receptionStartsAt}
            onChange={(e) => setReceptionStartsAt(e.target.value)}
            className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
          />
        </LabeledInput>
        <LabeledInput label="受付終了時刻" className="flex-1">
          <input
            type="datetime-local"
            value={receptionEndsAt}
            onChange={(e) => setReceptionEndsAt(e.target.value)}
            className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
          />
        </LabeledInput>
      </div>

      <div className="flex gap-2">
        <LabeledInput label="最大参加人数（プレイヤー）" className="flex-1">
          <input
            type="number"
            min={1}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
          />
        </LabeledInput>
        <LabeledInput label="組数" className="flex-1">
          <input
            type="number"
            min={1}
            max={8}
            value={groupCount}
            onChange={(e) => setGroupCount(Number(e.target.value))}
            className="w-full rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
          />
        </LabeledInput>
      </div>

      <div className="rounded border border-dojo-dark-brown/20 p-2">
        <p className="font-sans text-xs font-bold text-dojo-ink">
          お題の選び方（必要数：{neededTopics}件）
        </p>
        <div className="mt-1 flex gap-3 font-sans text-xs">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={topicMode === "random"}
              onChange={() => setTopicMode("random")}
            />
            ランダム選択
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={topicMode === "manual"}
              onChange={() => setTopicMode("manual")}
            />
            手動選択
          </label>
        </div>
        {topicMode === "manual" && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded border border-dojo-dark-brown/10">
            {topicBank.length === 0 ? (
              <p className="p-2 font-sans text-xs text-dojo-dark-brown">
                登録済みのお題がありません。先にお題管理画面で追加してください。
              </p>
            ) : (
              topicBank.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 border-b border-dojo-dark-brown/5 px-2 py-1 font-sans text-xs last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={manualTopicIds.includes(t.id)}
                    onChange={() => toggleManualTopic(t.id)}
                  />
                  {t.body}
                </label>
              ))
            )}
            <p className="p-1 text-right font-sans text-[10px] text-dojo-dark-brown">
              選択中：{manualTopicIds.length}/{neededTopics}
            </p>
          </div>
        )}
      </div>

      {localError && <p className="font-sans text-xs text-dojo-deep-crimson">{localError}</p>}

      <button
        type="button"
        disabled={submitting}
        onClick={handleSubmit}
        className="rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-sm font-bold text-dojo-washi-white disabled:opacity-50"
      >
        {submitting ? "保存中…" : "この内容でライブを準備する"}
      </button>
    </div>
  );
}

function LabeledInput({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 font-sans text-xs text-dojo-dark-brown ${className}`}>
      {label}
      {children}
    </label>
  );
}

// 準備完了後、「参加受付を開始する」ボタンだけを表示するパネル。
function ReceptionStartPanel() {
  const openReception = useLiveHostStore((s) => s.openReception);
  const [submitting, setSubmitting] = useState(false);

  const handleClick = async () => {
    const confirmed = window.confirm("参加受付を開始しますか？参加者がホームから参加できるようになります。");
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await openReception();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      disabled={submitting}
      onClick={handleClick}
      className="rounded-full bg-dojo-curtain-red px-6 py-3 font-sans text-sm font-bold text-dojo-washi-white disabled:opacity-50"
    >
      {submitting ? "処理中…" : "参加受付を開始する"}
    </button>
  );
}

// 組分け確認画面：ランダム振り分け・手動組変更・お題確認変更。
function GroupingPanel({
  participants,
  groups,
  topics,
}: {
  participants: ParticipantRow[];
  groups: GroupRow[];
  topics: TopicRow[];
}) {
  const hostProfiles = useLiveHostStore((s) => s.profiles);
  const topicBank = useLiveHostStore((s) => s.topicBank);
  const randomizeGroups = useLiveHostStore((s) => s.randomizeGroups);
  const setParticipantGroup = useLiveHostStore((s) => s.setParticipantGroup);
  const changeTopicAssignment = useLiveHostStore((s) => s.changeTopicAssignment);
  const [busy, setBusy] = useState(false);
  const [openTopicPicker, setOpenTopicPicker] = useState<string | null>(null);

  const hasManualGrouping = participants.some((p) => p.group_id);

  const handleRandomize = async () => {
    if (hasManualGrouping) {
      const confirmed = window.confirm(
        "もう一度ランダムに振り分けますか？現在の手動変更は消えます。",
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      await randomizeGroups();
    } finally {
      setBusy(false);
    }
  };

  const handleChangeTopic = async (topic: TopicRow) => {
    if (topic.locked) {
      const confirmed = window.confirm(
        "このお題は既に参加者へ公開されています。変更しますか？",
      );
      if (!confirmed) return;
    }
    setOpenTopicPicker(topic.id);
  };

  return (
    <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
      <p className="font-sans text-xs font-bold text-dojo-ink">組分け確認</p>

      <button
        type="button"
        disabled={busy}
        onClick={handleRandomize}
        className="mt-2 rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white disabled:opacity-50"
      >
        {hasManualGrouping ? "もう一度ランダムに振り分ける" : "ランダムに振り分ける"}
      </button>

      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto font-sans text-[11px] text-dojo-dark-brown">
        {participants
          .filter((p) => p.preferred_role === "player")
          .map((p) => {
            const name =
              hostProfiles.find((pr) => pr.id === p.user_id)?.display_name ?? "（名前未設定）";
            return (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{name}</span>
                <select
                  value={p.group_id ?? ""}
                  onChange={(e) => setParticipantGroup(p.id, e.target.value || null)}
                  className="rounded border border-dojo-dark-brown/30 px-1 py-0.5 text-xs"
                >
                  <option value="">未割当</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      組{g.group_order}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
      </ul>

      {topics.length > 0 && (
        <div className="mt-3 border-t border-dojo-dark-brown/10 pt-2">
          <p className="font-sans text-xs font-bold text-dojo-ink">使用するお題</p>
          <ul className="mt-1 space-y-1 font-sans text-[11px] text-dojo-dark-brown">
            {topics.map((t) => (
              <li key={t.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {t.body}
                    {t.locked && <span className="ml-1 text-dojo-curtain-red">（公開済み）</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleChangeTopic(t)}
                    className="shrink-0 rounded border border-dojo-dark-brown/30 px-1.5 py-0.5 text-[10px]"
                  >
                    変更
                  </button>
                </div>
                {openTopicPicker === t.id && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded border border-dojo-dark-brown/10 bg-dojo-washi-white">
                    {topicBank.map((tb) => (
                      <button
                        key={tb.id}
                        type="button"
                        onClick={async () => {
                          await changeTopicAssignment(t.id, tb);
                          setOpenTopicPicker(null);
                        }}
                        className="block w-full truncate px-2 py-1 text-left text-[10px] hover:bg-dojo-light-brown"
                      >
                        {tb.body}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// 運営メッセージ送信欄。組分け確認中〜ゲーム進行中まで共通で表示する。
function AnnouncementPanel() {
  const live = useLiveHostStore((s) => s.live);
  const sendAnnouncement = useLiveHostStore((s) => s.sendAnnouncement);
  const clearAnnouncement = useLiveHostStore((s) => s.clearAnnouncement);
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<"player" | "all">("all");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await sendAnnouncement(message, scope);
      setMessage("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
      <p className="font-sans text-xs font-bold text-dojo-ink">プレイヤー全員への運営メッセージ</p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="例：まもなくゲームを開始します"
          className="flex-1 rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-xs"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "player" | "all")}
          className="rounded border border-dojo-dark-brown/30 px-1 py-1 text-xs"
        >
          <option value="all">全員に表示</option>
          <option value="player">プレイヤーのみ</option>
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={sending || !message.trim()}
          onClick={handleSend}
          className="rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white disabled:opacity-50"
        >
          送信する
        </button>
        {live?.announcement_message && (
          <button
            type="button"
            onClick={() => clearAnnouncement()}
            className="rounded-full border border-dojo-dark-brown/30 px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown"
          >
            表示を消す
          </button>
        )}
      </div>
      {live?.announcement_message && (
        <p className="mt-2 font-sans text-[11px] text-dojo-dark-brown">
          現在表示中：「{live.announcement_message}」
          {live.announcement_sent_at &&
            `（${new Date(live.announcement_sent_at).toLocaleString("ja-JP")}送信）`}
        </p>
      )}
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
