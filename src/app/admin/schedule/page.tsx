"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { logAdminAction } from "@/lib/adminActionLog";
import { toScheduleEntryDate } from "@/lib/liveDateFormat";
import {
  ASSIGNABLE_DISPLAY_ROLES,
  DISPLAY_ROLE_LABEL,
  addOneWeek,
  buildStartTimeOptions,
  defaultReceptionTime,
  nextTicketNoCandidate,
  type LiveScheduleDisplayRole,
  type LiveScheduleEntry,
} from "@/lib/liveSchedulePlan";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import type { LiveRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";

const START_TIME_OPTIONS = buildStartTimeOptions();

// ライブ予定管理画面（運営者専用管理画面）。
// 実際にゲームが進行するlivesテーブルとは完全に切り離した、表示専用の
// 予定データ(live_schedule_entries)を扱う。
//
// 2026-08-30（一覧UIの廃止）：「前回/今回/次回/ホームの次回ライブ」の4枠を
// 一覧テーブルから選ぶ方式だと、使うほど過去の予定が溜まって見づらくなるため、
// 4枠のカードを直接編集する方式に変更した。各カードの「編集する」/「予定を
// 作成する」から、その場でフォームを開いて保存すると、そのままそのカードの
// 表示が更新される。使わなくなった予定は完全削除ではなく「未設定に戻す」
// （display_role='preparing'に戻すだけ）にすることで、データ自体は失われない。
// 新規のライブ実施（お題選定・受付開始等）は引き続き/live/host（ライブ準備画面）で行う。
export default function AdminSchedulePage() {
  const [entries, setEntries] = useState<LiveScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState<LiveScheduleDisplayRole | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const load = async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("live_schedule_entries")
      .select("*")
      .order("event_date", { ascending: true });
    if (fetchError) notifyError(fetchError.message);
    else setEntries((data ?? []) as LiveScheduleEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byRole = useMemo(() => {
    const map: Partial<Record<LiveScheduleDisplayRole, LiveScheduleEntry>> = {};
    for (const e of entries) {
      if (e.display_role !== "preparing") map[e.display_role] = e;
    }
    return map;
  }, [entries]);

  const handleClear = async (entry: LiveScheduleEntry) => {
    if (clearingId) return;
    const confirmed = window.confirm(
      `「${DISPLAY_ROLE_LABEL[entry.display_role]}」の予定を未設定に戻しますか？（データ自体は削除されません）`,
    );
    if (!confirmed) return;
    setClearingId(entry.id);
    try {
      const { error } = await supabase.rpc("set_live_schedule_role", {
        p_entry_id: entry.id,
        p_role: "preparing",
      });
      if (error) {
        notifyError(error.message);
        return;
      }
      await logAdminAction({
        action: "schedule_entry_role_changed",
        targetType: "live_schedule_entries",
        targetId: entry.id,
        detail: { role: "preparing" },
      });
      notifySuccess(`「${DISPLAY_ROLE_LABEL[entry.display_role]}」を未設定に戻しました。`);
      setEditingRole(null);
      await load();
    } finally {
      setClearingId(null);
    }
  };

  return (
    <AdminShell wide>
      <AdminHeader title="ライブ予定" />
      <p className="text-xs text-gray-500">
        ここで管理する日付・番号は、ホーム画面・ライブ画面のチケット表示にのみ使う
        告知用の予定です。実際のライブの実施（受付開始・組分け等）は
        <Link href="/live/host" className="mx-1 underline">
          ライブ準備画面
        </Link>
        で行ってください。
      </p>

      <AdminNotice notice={notice} onClose={clear} />

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ASSIGNABLE_DISPLAY_ROLES.map((role) => {
            const entry = byRole[role];
            const isEditing = editingRole === role;
            const otherEntries = ASSIGNABLE_DISPLAY_ROLES.filter((r) => r !== role)
              .map((r) => byRole[r])
              .filter((e): e is LiveScheduleEntry => !!e);

            return (
              <AdminCard key={role} title={DISPLAY_ROLE_LABEL[role]}>
                {!isEditing &&
                  (entry ? (
                    <>
                      <p className="text-lg font-bold text-gray-900">{entry.ticket_no}</p>
                      <p className="text-sm text-gray-700">
                        {entry.event_date} {entry.start_time.slice(0, 5)}開演
                      </p>
                      <p className="text-xs text-gray-500">受付 {entry.reception_time.slice(0, 5)}〜</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <AdminButton variant="primary" onClick={() => setEditingRole(role)}>
                          編集する
                        </AdminButton>
                        <AdminButton disabled={clearingId === entry.id} onClick={() => handleClear(entry)}>
                          {clearingId === entry.id ? "処理中…" : "未設定に戻す"}
                        </AdminButton>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-400">未設定</p>
                      <AdminButton variant="primary" onClick={() => setEditingRole(role)} className="mt-2">
                        予定を作成する
                      </AdminButton>
                    </>
                  ))}

                {isEditing && (
                  <ScheduleEntryForm
                    entries={entries}
                    initial={entry}
                    otherEntries={otherEntries}
                    onCancel={() => setEditingRole(null)}
                    onSave={async (input) => {
                      if (entry) {
                        const { error } = await supabase
                          .from("live_schedule_entries")
                          .update(input)
                          .eq("id", entry.id);
                        if (error) return { ok: false, reason: error.message };
                        await logAdminAction({
                          action: "schedule_entry_updated",
                          targetType: "live_schedule_entries",
                          targetId: entry.id,
                          detail: { ...input },
                        });
                      } else {
                        const { data, error } = await supabase
                          .from("live_schedule_entries")
                          .insert({ ...input, display_role: role })
                          .select()
                          .single();
                        if (error || !data) return { ok: false, reason: error?.message };
                        await logAdminAction({
                          action: "schedule_entry_created",
                          targetType: "live_schedule_entries",
                          targetId: (data as LiveScheduleEntry).id,
                          detail: { ...input, display_role: role },
                        });
                      }
                      notifySuccess("保存しました。");
                      setEditingRole(null);
                      await load();
                      return { ok: true };
                    }}
                  />
                )}
              </AdminCard>
            );
          })}
        </div>
      )}

      <ResultsPublishSection />
    </AdminShell>
  );
}

interface ScheduleEntryInput {
  event_date: string;
  start_time: string;
  reception_time: string;
  ticket_no: string;
}

// 各枠カード共通の入力フォーム。開催日→カレンダーピッカー、開始時刻→選択欄、
// 受付時刻→開始時刻の5分前を自動入力しつつ手動変更も可能、ライブ番号→自動候補＋
// 手動編集、という要件どおりのシンプルな構成。表示先はカード側で固定済みのため
// このフォームでは選ばせない。他の枠に既に予定があれば、その内容をコピーして
// 使えるようにしている（複製に相当する操作）。
function ScheduleEntryForm({
  entries,
  initial,
  otherEntries,
  onSave,
  onCancel,
}: {
  entries: LiveScheduleEntry[];
  initial?: LiveScheduleEntry;
  otherEntries: LiveScheduleEntry[];
  onSave: (input: ScheduleEntryInput) => Promise<{ ok: boolean; reason?: string }>;
  onCancel: () => void;
}) {
  const [eventDate, setEventDate] = useState(initial?.event_date ?? "");
  const [startTime, setStartTime] = useState(initial?.start_time.slice(0, 5) ?? START_TIME_OPTIONS[6]);
  const [receptionTime, setReceptionTime] = useState(
    initial?.reception_time.slice(0, 5) ?? defaultReceptionTime(START_TIME_OPTIONS[6]),
  );
  const [receptionEdited, setReceptionEdited] = useState(!!initial);
  const [ticketNo, setTicketNo] = useState(initial?.ticket_no ?? nextTicketNoCandidate(entries));
  const [copyFromId, setCopyFromId] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleStartTimeChange = (value: string) => {
    setStartTime(value);
    if (!receptionEdited) setReceptionTime(defaultReceptionTime(value));
  };

  const handleCopy = (id: string) => {
    setCopyFromId(id);
    const source = otherEntries.find((e) => e.id === id);
    if (!source) return;
    setEventDate(source.event_date);
    setStartTime(source.start_time.slice(0, 5));
    setReceptionTime(source.reception_time.slice(0, 5));
    setReceptionEdited(true);
  };

  const handleSave = async () => {
    if (!eventDate) {
      setLocalError("開催日を入力してください");
      return;
    }
    setSaving(true);
    setLocalError(null);
    const result = await onSave({
      event_date: eventDate,
      start_time: startTime,
      reception_time: receptionTime,
      ticket_no: ticketNo,
    });
    setSaving(false);
    if (!result.ok) setLocalError(result.reason ?? "保存に失敗しました");
  };

  const preview = eventDate ? toScheduleEntryDate(eventDate, startTime) : null;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-3">
      {otherEntries.length > 0 && (
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-600">
          他の予定をコピーして使う（任意）
          <select
            value={copyFromId}
            onChange={(e) => handleCopy(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">選択してください</option>
            {otherEntries.map((e) => (
              <option key={e.id} value={e.id}>
                {DISPLAY_ROLE_LABEL[e.display_role]}（{e.ticket_no}・{e.event_date}）
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-0.5 text-[11px] text-gray-600">
        開催日
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-600">
          開始時刻
          <select
            value={startTime}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {START_TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-600">
          受付時刻（開始5分前を自動入力）
          <input
            type="time"
            value={receptionTime}
            onChange={(e) => {
              setReceptionEdited(true);
              setReceptionTime(e.target.value);
            }}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <label className="flex flex-col gap-0.5 text-[11px] text-gray-600">
        ライブ番号
        <input
          type="text"
          value={ticketNo}
          onChange={(e) => setTicketNo(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>

      {preview && (
        <p className="text-[11px] text-gray-500">
          プレビュー：{preview.year}年{preview.month}月{preview.day}日（{preview.weekday}）
          {preview.time}開演
        </p>
      )}

      {eventDate && (
        <AdminButton onClick={() => setEventDate((d) => (d ? addOneWeek(d) : d))} className="self-start">
          開催日を1週間後にする
        </AdminButton>
      )}

      {localError && <p className="text-xs text-red-600">{localError}</p>}

      <div className="flex gap-2">
        <AdminButton variant="primary" disabled={saving} onClick={handleSave}>
          {saving ? "保存中…" : "保存する"}
        </AdminButton>
        <AdminButton onClick={onCancel}>キャンセル</AdminButton>
      </div>
    </div>
  );
}

// 終了したライブの結果公開状態の一覧表示（第2段階から温存）。
// 2026-08-31（ライブ結果のSNS掲載機能の追加）：以前はここで直接
// lives.results_publishedを反転させていたが、自動抽出した内容をそのまま
// 確認無しに公開してしまえるのは危険なため、実際の公開操作は
// 「/admin/live-results/[liveId]」（掲載回答の確認・運営ベスト設定を経てから
// 公開するページ）に一本化した。ここでは公開状態の確認と、その設定画面への
// 導線のみを残す（同じlives.results_publishedを見ているだけで、公開フラグ自体は
// 増やしていない）。
// カードをタップした時に、遷移せずその場で見られる簡易サマリー。
// 「設定」ページのプレビューのような重い作りにはせず、既に保存済みの掲載内容
// （sns_live_result_answers等）を読むだけの軽いクエリに留める。
interface QuickResultSummary {
  hasResult: boolean;
  podiumNames: { rank: 1 | 2 | 3; name: string }[];
  perfectCount: number;
  managerBestSet: boolean;
}

async function fetchQuickResultSummary(liveId: string): Promise<QuickResultSummary> {
  const { data: resultData } = await supabase
    .from("sns_live_results")
    .select("id, manager_best_answer_id")
    .eq("live_id", liveId)
    .maybeSingle();
  if (!resultData) return { hasResult: false, podiumNames: [], perfectCount: 0, managerBestSet: false };

  const { data: raData } = await supabase
    .from("sns_live_result_answers")
    .select("answer_id, rank")
    .eq("live_result_id", resultData.id)
    .eq("included", true);
  const rows = (raData ?? []) as { answer_id: string; rank: 1 | 2 | 3 | null }[];
  const answerIds = rows.map((r) => r.answer_id);

  const { data: answersData } = answerIds.length
    ? await supabase.from("answers").select("id, participant_id, judge_count, top_score_votes").in("id", answerIds)
    : { data: [] as { id: string; participant_id: string; judge_count: number; top_score_votes: number }[] };
  const answerById = new Map((answersData ?? []).map((a) => [a.id, a]));

  const podiumParticipantIds = [
    ...new Set(
      rows
        .filter((r) => r.rank !== null)
        .map((r) => answerById.get(r.answer_id)?.participant_id)
        .filter((v): v is string => !!v),
    ),
  ];
  const { data: participantsData } = podiumParticipantIds.length
    ? await supabase.from("participants").select("id, user_id").in("id", podiumParticipantIds)
    : { data: [] as { id: string; user_id: string }[] };
  const userIdByParticipantId = new Map((participantsData ?? []).map((p) => [p.id, p.user_id]));
  const profileIds = [...new Set([...userIdByParticipantId.values()])];
  let names: Record<string, string> = {};
  if (profileIds.length > 0) {
    const { data: namesData } = await supabase.rpc("sns_author_names", { p_ids: profileIds });
    names = Object.fromEntries(
      ((namesData ?? []) as { id: string; display_name: string }[]).map((n) => [n.id, n.display_name]),
    );
  }

  const podiumNames = ([1, 2, 3] as const)
    .map((rank) => {
      const row = rows.find((r) => r.rank === rank);
      const participantId = row ? answerById.get(row.answer_id)?.participant_id : undefined;
      const userId = participantId ? userIdByParticipantId.get(participantId) : undefined;
      if (!userId) return null;
      return { rank, name: names[userId] ?? "（名前未設定）" };
    })
    .filter((v): v is { rank: 1 | 2 | 3; name: string } => v !== null);

  const perfectCount = rows.filter((r) => {
    const a = answerById.get(r.answer_id);
    return a && a.judge_count > 0 && a.top_score_votes === a.judge_count;
  }).length;

  return { hasResult: true, podiumNames, perfectCount, managerBestSet: !!resultData.manager_best_answer_id };
}

function ResultsPublishSection() {
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, QuickResultSummary | "loading">>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lives")
        .select("*")
        .eq("current_phase", "closed")
        .order("scheduled_at", { ascending: false });
      setLives((data ?? []) as LiveRow[]);
      setLoading(false);
    })();
  }, []);

  const handleToggleExpand = async (liveId: string) => {
    if (expandedId === liveId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(liveId);
    if (summaries[liveId]) return;
    setSummaries((s) => ({ ...s, [liveId]: "loading" }));
    const summary = await fetchQuickResultSummary(liveId);
    setSummaries((s) => ({ ...s, [liveId]: summary }));
  };

  if (loading || lives.length === 0) return null;

  return (
    <AdminCard title="終了したライブの結果公開">
      <ul className="flex flex-col gap-1.5">
        {lives.map((live) => {
          const expanded = expandedId === live.id;
          const summary = summaries[live.id];
          return (
            <li key={live.id} className="rounded border border-gray-200">
              <button
                type="button"
                onClick={() => handleToggleExpand(live.id)}
                className="flex w-full items-center justify-between gap-2 p-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-700">
                    {formatLiveTicketNo(live.sequence_number)} {live.title ?? "（タイトル未設定）"}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      live.results_published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {live.results_published ? "SNS公開中" : "未公開"}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{expanded ? "閉じる ▲" : "結果を見る ▼"}</span>
              </button>
              {expanded && (
                <div className="border-t border-gray-100 px-2.5 py-2 text-xs text-gray-700">
                  {summary === "loading" || !summary ? (
                    <p className="text-gray-400">読み込み中…</p>
                  ) : !summary.hasResult ? (
                    <p className="text-gray-400">まだライブ結果を設定していません。</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {summary.podiumNames.length === 0 ? (
                        <p className="text-gray-400">掲載中の1〜3位代表がありません。</p>
                      ) : (
                        <p className="flex flex-wrap gap-x-3">
                          {summary.podiumNames.map(({ rank, name }) => (
                            <span key={rank}>
                              {rank}位：{name}
                            </span>
                          ))}
                        </p>
                      )}
                      <p className="text-gray-500">
                        満点 {summary.perfectCount}件　運営ベスト
                        {summary.managerBestSet ? "：設定済み" : "：未設定"}
                      </p>
                    </div>
                  )}
                  <div className="mt-2">
                    <Link href={`/admin/live-results/${live.id}`}>
                      <AdminButton>ライブ結果の設定・公開はこちら →</AdminButton>
                    </Link>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </AdminCard>
  );
}
