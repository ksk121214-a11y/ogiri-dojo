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

      <ResultsPublishSection notifySuccess={notifySuccess} notifyError={notifyError} />
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

// 終了したライブの結果公開状態のみを扱う既存機能（第2段階から温存）。
// 日時等の編集は上のライブ予定（表示専用データ）に役目が移ったため、ここでは
// 結果公開トグルのみのシンプルな一覧にしている。
function ResultsPublishSection({
  notifySuccess,
  notifyError,
}: {
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
}) {
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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
    if (togglingId) return;
    setTogglingId(live.id);
    try {
      const { error } = await supabase
        .from("lives")
        .update({ results_published: !live.results_published })
        .eq("id", live.id);
      if (error) {
        notifyError(error.message);
        return;
      }
      await logAdminAction({
        action: live.results_published ? "results_unpublished" : "results_published",
        targetType: "lives",
        targetId: live.id,
      });
      notifySuccess(live.results_published ? "結果を非公開にしました。" : "結果を公開しました。");
      await load();
    } finally {
      setTogglingId(null);
    }
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
            <AdminButton disabled={togglingId === live.id} onClick={() => handleToggle(live)}>
              {togglingId === live.id
                ? "処理中…"
                : live.results_published
                  ? "結果を非公開にする"
                  : "結果を公開する"}
            </AdminButton>
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}
