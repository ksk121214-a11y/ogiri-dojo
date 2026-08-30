"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

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
// 2026-08-30：実際にゲームが進行するlivesテーブルとは完全に切り離した、表示専用の
// 予定データ(live_schedule_entries)を扱うように全面刷新した。1件の予定を
// 「準備中/前回/今回/次回/ホームの次回ライブ」のどこに表示するか手動で選べる。
// 新規のライブ実施（お題選定・受付開始等）は引き続き/live/host（ライブ準備画面）で行う
// （このページはあくまで公開画面に出す日付・番号の告知データを管理するだけ）。
export default function AdminSchedulePage() {
  const [entries, setEntries] = useState<LiveScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("live_schedule_entries")
      .select("*")
      .order("event_date", { ascending: true });
    if (fetchError) setError(fetchError.message);
    else {
      setEntries((data ?? []) as LiveScheduleEntry[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
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
      setError(rpcError.message);
      return;
    }
    await logAdminAction({
      action: "schedule_entry_role_changed",
      targetType: "live_schedule_entries",
      targetId: entry.id,
      detail: { role },
    });
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
      setError(insertError?.message ?? "複製に失敗しました");
      return;
    }
    await logAdminAction({
      action: "schedule_entry_duplicated",
      targetType: "live_schedule_entries",
      targetId: (data as LiveScheduleEntry).id,
      detail: { fromId: entry.id },
    });
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
      setError(deleteError.message);
      return;
    }
    await logAdminAction({
      action: "schedule_entry_deleted",
      targetType: "live_schedule_entries",
      targetId: entry.id,
    });
    await load();
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">ライブ予定</h1>
      <p className="font-sans text-xs text-dojo-dark-brown">
        ここで管理する日付・番号は、ホーム画面・次回ライブ画面のチケット表示にのみ使う
        告知用の予定です。実際のライブの実施（受付開始・組分け等）は
        <Link href="/live/host" className="underline">
          ライブ準備画面
        </Link>
        で行ってください。
      </p>

      {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}

      {/* 現在の割当一覧 */}
      <div className="grid grid-cols-2 gap-2">
        {ASSIGNABLE_DISPLAY_ROLES.map((role) => {
          const entry = byRole[role];
          return (
            <div key={role} className="rounded-xl border border-dojo-dark-brown/20 p-3">
              <p className="font-sans text-[11px] font-bold text-dojo-dark-brown">
                {DISPLAY_ROLE_LABEL[role]}
              </p>
              {entry ? (
                <>
                  <p className="mt-1 font-sans text-sm font-bold text-dojo-ink">{entry.ticket_no}</p>
                  <p className="font-sans text-xs text-dojo-dark-brown">
                    {entry.event_date} {entry.start_time.slice(0, 5)}
                  </p>
                </>
              ) : (
                <p className="mt-1 font-sans text-sm text-dojo-dark-brown/60">未割当</p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCreating((v) => !v)}
        className="self-start rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white"
      >
        {creating ? "キャンセル" : "＋ 新しい予定を作成"}
      </button>

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
            await load();
            return { ok: true };
          }}
        />
      )}

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className="font-sans text-sm font-bold text-dojo-ink">
                  {entry.ticket_no}（{entry.event_date} {entry.start_time.slice(0, 5)}）
                </p>
                <span className="shrink-0 rounded bg-dojo-dark-brown/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-dojo-dark-brown">
                  {DISPLAY_ROLE_LABEL[entry.display_role]}
                </span>
              </div>

              {editingId === entry.id ? (
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
                    await load();
                    return { ok: true };
                  }}
                />
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(entry.id)}
                    className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(entry)}
                    className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px] text-dojo-deep-crimson"
                  >
                    削除
                  </button>
                  <select
                    value={entry.display_role}
                    onChange={(e) => handleChangeRole(entry, e.target.value as LiveScheduleDisplayRole)}
                    className="rounded border border-dojo-dark-brown/30 px-1 py-0.5 font-sans text-[11px]"
                  >
                    <option value="preparing">{DISPLAY_ROLE_LABEL.preparing}</option>
                    {ASSIGNABLE_DISPLAY_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {DISPLAY_ROLE_LABEL[role]}にする
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          ))}
          {entries.length === 0 && (
            <p className="font-sans text-sm text-dojo-dark-brown">まだライブ予定がありません。</p>
          )}
        </ul>
      )}

      <ResultsPublishSection />
    </div>
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
    <div className="flex flex-col gap-2 rounded-xl border border-dojo-dark-brown/20 bg-dojo-light-brown/30 p-3">
      <label className="flex flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
        開催日
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
          開始時刻
          <select
            value={startTime}
            onChange={(e) => handleStartTimeChange(e.target.value)}
            className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
          >
            {START_TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
          受付時刻（開始5分前を自動入力）
          <input
            type="time"
            value={receptionTime}
            onChange={(e) => {
              setReceptionEdited(true);
              setReceptionTime(e.target.value);
            }}
            className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
          ライブ番号
          <input
            type="text"
            value={ticketNo}
            onChange={(e) => setTicketNo(e.target.value)}
            className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
          表示先
          <select
            value={displayRole}
            onChange={(e) => setDisplayRole(e.target.value as LiveScheduleDisplayRole)}
            className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
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
        <p className="font-sans text-[11px] text-dojo-dark-brown">
          プレビュー：{preview.year}年{preview.month}月{preview.day}日（{preview.weekday}）
          {preview.time}開演
        </p>
      )}

      {initial && (
        <button
          type="button"
          onClick={() => setEventDate((d) => (d ? addOneWeek(d) : d))}
          className="self-start rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
        >
          開催日を1週間後にする
        </button>
      )}

      {localError && <p className="font-sans text-xs text-dojo-deep-crimson">{localError}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存する"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-dojo-dark-brown/30 px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// 終了したライブの結果公開状態のみを扱う既存機能（第2段階から温存）。
// 日時等の編集は上のライブ予定（表示専用データ）に役目が移ったため、ここでは
// 結果公開トグルのみのシンプルな一覧にしている。
function ResultsPublishSection() {
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
    await load();
  };

  if (loading || lives.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-dojo-dark-brown/20 pt-4">
      <h2 className="font-sans text-sm font-bold text-dojo-ink">終了したライブの結果公開</h2>
      <ul className="flex flex-col gap-1.5">
        {lives.map((live) => (
          <li
            key={live.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-dojo-dark-brown/20 p-2"
          >
            <p className="font-sans text-xs text-dojo-dark-brown">
              {formatLiveTicketNo(live.sequence_number)} {live.title ?? "（タイトル未設定）"}
            </p>
            <button
              type="button"
              onClick={() => handleToggle(live)}
              className="shrink-0 rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
            >
              {live.results_published ? "結果を非公開にする" : "結果を公開する"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
