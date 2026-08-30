"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

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
// 予定データ(live_schedule_entries)を扱う。1件の予定を
// 「準備中/前回/今回/次回/ホームの次回ライブ」のどこに表示するか手動で選べる。
// 新規のライブ実施（お題選定・受付開始等）は引き続き/live/host（ライブ準備画面）で行う
// （このページはあくまで公開画面に出す日付・番号の告知データを管理するだけ）。
// 2026-08-30（デザイン整理）：管理操作のロジックは変更せず、共通の
// AdminShell/AdminCard/AdminButton/AdminNoticeに置き換えて表示だけ整理した。
export default function AdminSchedulePage() {
  const [entries, setEntries] = useState<LiveScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const handleChangeRole = async (entry: LiveScheduleEntry, role: LiveScheduleDisplayRole) => {
    const { error: rpcError } = await supabase.rpc("set_live_schedule_role", {
      p_entry_id: entry.id,
      p_role: role,
    });
    if (rpcError) {
      notifyError(rpcError.message);
      return;
    }
    await logAdminAction({
      action: "schedule_entry_role_changed",
      targetType: "live_schedule_entries",
      targetId: entry.id,
      detail: { role },
    });
    notifySuccess(`表示先を「${DISPLAY_ROLE_LABEL[role]}」に変更しました。`);
    await load();
  };

  const handleDuplicate = async (entry: LiveScheduleEntry) => {
    const ticketNo = nextTicketNoCandidate(entries);
    const { data, error: insertError } = await supabase
      .from("live_schedule_entries")
      .insert({
        event_date: entry.event_date,
        start_time: entry.start_time,
        reception_time: entry.reception_time,
        ticket_no: ticketNo,
        display_role: "preparing",
      })
      .select()
      .single();
    if (insertError || !data) {
      notifyError(insertError?.message ?? "複製に失敗しました");
      return;
    }
    await logAdminAction({
      action: "schedule_entry_duplicated",
      targetType: "live_schedule_entries",
      targetId: (data as LiveScheduleEntry).id,
      detail: { fromId: entry.id },
    });
    notifySuccess("複製しました。必要に応じて開催日を調整してください。");
    await load();
    setEditingId((data as LiveScheduleEntry).id);
  };

  const handleDelete = async (entry: LiveScheduleEntry) => {
    const confirmed = window.confirm(
      `${entry.ticket_no}（${entry.event_date}）を削除しますか？この操作は取り消せません。`,
    );
    if (!confirmed) return;
    const { error: deleteError } = await supabase
      .from("live_schedule_entries")
      .delete()
      .eq("id", entry.id);
    if (deleteError) {
      notifyError(deleteError.message);
      return;
    }
    await logAdminAction({
      action: "schedule_entry_deleted",
      targetType: "live_schedule_entries",
      targetId: entry.id,
    });
    notifySuccess("削除しました。");
    await load();
  };

  return (
    <AdminShell wide>
      <AdminHeader title="ライブ予定" />
      <p className="text-xs text-gray-500">
        ここで管理する日付・番号は、ホーム画面・次回ライブ画面のチケット表示にのみ使う
        告知用の予定です。実際のライブの実施（受付開始・組分け等）は
        <Link href="/live/host" className="mx-1 underline">
          ライブ準備画面
        </Link>
        で行ってください。
      </p>

      <AdminNotice notice={notice} onClose={clear} />

      {/* 現在の割当一覧 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ASSIGNABLE_DISPLAY_ROLES.map((role) => {
          const entry = byRole[role];
          return (
            <AdminCard key={role} title={DISPLAY_ROLE_LABEL[role]}>
              {entry ? (
                <>
                  <p className="text-sm font-bold text-gray-900">{entry.ticket_no}</p>
                  <p className="text-xs text-gray-500">
                    {entry.event_date} {entry.start_time.slice(0, 5)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400">未割当</p>
              )}
            </AdminCard>
          );
        })}
      </div>

      <AdminButton
        variant="primary"
        onClick={() => setCreating((v) => !v)}
        className="self-start"
      >
        {creating ? "キャンセル" : "＋ 新しい予定を作成"}
      </AdminButton>

      {creating && (
        <ScheduleEntryForm
          entries={entries}
          onCancel={() => setCreating(false)}
          onSave={async (input) => {
            const { data, error: insertError } = await supabase
              .from("live_schedule_entries")
              .insert(input)
              .select()
              .single();
            if (insertError || !data) return { ok: false, reason: insertError?.message };
            await logAdminAction({
              action: "schedule_entry_created",
              targetType: "live_schedule_entries",
              targetId: (data as LiveScheduleEntry).id,
              detail: { ...input },
            });
            setCreating(false);
            notifySuccess("新しい予定を作成しました。");
            await load();
            return { ok: true };
          }}
        />
      )}

      <AdminCard title={`ライブ予定一覧（${entries.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500">まだライブ予定がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-1.5 pr-2 font-normal">番号</th>
                  <th className="py-1.5 pr-2 font-normal">日付</th>
                  <th className="py-1.5 pr-2 font-normal">開始</th>
                  <th className="py-1.5 pr-2 font-normal">状態</th>
                  <th className="py-1.5 pr-2 font-normal">操作</th>
                  <th className="py-1.5 pl-4 font-normal">削除</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2 font-bold text-gray-900">{entry.ticket_no}</td>
                      <td className="py-2 pr-2 text-gray-700">{entry.event_date}</td>
                      <td className="py-2 pr-2 text-gray-700">{entry.start_time.slice(0, 5)}</td>
                      <td className="py-2 pr-2">
                        <select
                          value={entry.display_role}
                          onChange={(e) =>
                            handleChangeRole(entry, e.target.value as LiveScheduleDisplayRole)
                          }
                          className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                        >
                          <option value="preparing">{DISPLAY_ROLE_LABEL.preparing}</option>
                          {ASSIGNABLE_DISPLAY_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {DISPLAY_ROLE_LABEL[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1.5">
                          <AdminButton
                            onClick={() =>
                              setEditingId((prev) => (prev === entry.id ? null : entry.id))
                            }
                          >
                            {editingId === entry.id ? "閉じる" : "編集"}
                          </AdminButton>
                          <AdminButton onClick={() => handleDuplicate(entry)}>複製</AdminButton>
                        </div>
                      </td>
                      <td className="py-2 pl-4">
                        <AdminButton variant="danger" onClick={() => handleDelete(entry)}>
                          削除
                        </AdminButton>
                      </td>
                    </tr>
                    {editingId === entry.id && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={6} className="py-2">
                          <ScheduleEntryForm
                            entries={entries}
                            initial={entry}
                            onCancel={() => setEditingId(null)}
                            onSave={async (input) => {
                              const { error: updateError } = await supabase
                                .from("live_schedule_entries")
                                .update(input)
                                .eq("id", entry.id);
                              if (updateError) return { ok: false, reason: updateError.message };
                              await logAdminAction({
                                action: "schedule_entry_updated",
                                targetType: "live_schedule_entries",
                                targetId: entry.id,
                                detail: { ...input },
                              });
                              setEditingId(null);
                              notifySuccess("保存しました。");
                              await load();
                              return { ok: true };
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <ResultsPublishSection notifySuccess={notifySuccess} />
    </AdminShell>
  );
}

interface ScheduleEntryInput {
  event_date: string;
  start_time: string;
  reception_time: string;
  ticket_no: string;
  display_role: LiveScheduleDisplayRole;
}

// 新規作成・編集で共用する入力フォーム。開催日→カレンダーピッカー、開始時刻→選択欄、
// 受付時刻→開始時刻の5分前を自動入力しつつ手動変更も可能、ライブ番号→自動候補＋手動編集、
// 表示先→選択欄、という要件どおりのシンプルな1画面構成にしている。
function ScheduleEntryForm({
  entries,
  initial,
  onSave,
  onCancel,
}: {
  entries: LiveScheduleEntry[];
  initial?: LiveScheduleEntry;
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
  const [displayRole, setDisplayRole] = useState<LiveScheduleDisplayRole>(
    initial?.display_role ?? "preparing",
  );
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleStartTimeChange = (value: string) => {
    setStartTime(value);
    if (!receptionEdited) setReceptionTime(defaultReceptionTime(value));
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
      display_role: displayRole,
    });
    setSaving(false);
    if (!result.ok) setLocalError(result.reason ?? "保存に失敗しました");
  };

  const preview = eventDate ? toScheduleEntryDate(eventDate, startTime) : null;

  return (
    <AdminCard className="border-blue-200 bg-blue-50/40">
      <div className="flex flex-col gap-2">
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

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-600">
            ライブ番号
            <input
              type="text"
              value={ticketNo}
              onChange={(e) => setTicketNo(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-gray-600">
            表示先
            <select
              value={displayRole}
              onChange={(e) => setDisplayRole(e.target.value as LiveScheduleDisplayRole)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="preparing">{DISPLAY_ROLE_LABEL.preparing}</option>
              {ASSIGNABLE_DISPLAY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {DISPLAY_ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {preview && (
          <p className="text-[11px] text-gray-500">
            プレビュー：{preview.year}年{preview.month}月{preview.day}日（{preview.weekday}）
            {preview.time}開演
          </p>
        )}

        {initial && (
          <AdminButton
            onClick={() => setEventDate((d) => (d ? addOneWeek(d) : d))}
            className="self-start"
          >
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
    </AdminCard>
  );
}

// 終了したライブの結果公開状態のみを扱う既存機能（第2段階から温存）。
// 日時等の編集は上のライブ予定（表示専用データ）に役目が移ったため、ここでは
// 結果公開トグルのみのシンプルな一覧にしている。
function ResultsPublishSection({ notifySuccess }: { notifySuccess: (message: string) => void }) {
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("lives")
      .select("*")
      .eq("current_phase", "closed")
      .order("scheduled_at", { ascending: false });
    setLives((data ?? []) as LiveRow[]);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const handleToggle = async (live: LiveRow) => {
    const { error } = await supabase
      .from("lives")
      .update({ results_published: !live.results_published })
      .eq("id", live.id);
    if (error) return;
    await logAdminAction({
      action: live.results_published ? "results_unpublished" : "results_published",
      targetType: "lives",
      targetId: live.id,
    });
    notifySuccess(live.results_published ? "結果を非公開にしました。" : "結果を公開しました。");
    await load();
  };

  if (loading || lives.length === 0) return null;

  return (
    <AdminCard title="終了したライブの結果公開">
      <ul className="flex flex-col gap-1.5">
        {lives.map((live) => (
          <li
            key={live.id}
            className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
          >
            <p className="text-xs text-gray-700">
              {formatLiveTicketNo(live.sequence_number)} {live.title ?? "（タイトル未設定）"}
            </p>
            <AdminButton onClick={() => handleToggle(live)}>
              {live.results_published ? "結果を非公開にする" : "結果を公開する"}
            </AdminButton>
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}
