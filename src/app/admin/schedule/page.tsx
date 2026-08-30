"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { logAdminAction } from "@/lib/adminActionLog";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import type { LiveRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";

const PHASE_LABEL: Record<string, string> = {
  scheduled: "準備中",
  interlude: "受付中",
  opening: "受付中",
  topic_reveal: "開催中",
  answering: "開催中",
  group_result: "開催中",
  final_result: "開催中",
  closed: "終了",
};

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ライブ予定管理画面（運営者専用管理画面・第2段階）。新規作成はお題選定を伴うため
// 「ライブ準備画面」(/live/host)側に一本化し、ここでは一覧・既存ライブの予定編集
// （日時・タイトル・説明・受付時間・最大参加人数・結果公開状態）のみを扱う
// （準備フォームの二重実装を避けるため）。
export default function AdminSchedulePage() {
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    scheduledAt: string;
    receptionStartsAt: string;
    receptionEndsAt: string;
    maxPlayers: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("lives")
      .select("*")
      .order("scheduled_at", { ascending: false });
    if (fetchError) setError(fetchError.message);
    else {
      setLives((data ?? []) as LiveRow[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const startEdit = (live: LiveRow) => {
    setEditingId(live.id);
    setForm({
      title: live.title ?? "",
      description: live.description ?? "",
      scheduledAt: toDatetimeLocalValue(live.scheduled_at),
      receptionStartsAt: toDatetimeLocalValue(live.reception_starts_at),
      receptionEndsAt: toDatetimeLocalValue(live.reception_ends_at),
      maxPlayers: live.max_players != null ? String(live.max_players) : "",
    });
  };

  const handleSave = async (liveId: string) => {
    if (!form) return;
    const { error: updateError } = await supabase
      .from("lives")
      .update({
        title: form.title || null,
        description: form.description || null,
        scheduled_at: fromDatetimeLocalValue(form.scheduledAt) ?? new Date().toISOString(),
        reception_starts_at: fromDatetimeLocalValue(form.receptionStartsAt),
        reception_ends_at: fromDatetimeLocalValue(form.receptionEndsAt),
        max_players: form.maxPlayers ? Number(form.maxPlayers) : null,
      })
      .eq("id", liveId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await logAdminAction({ action: "live_schedule_edited", targetType: "lives", targetId: liveId });
    setEditingId(null);
    setForm(null);
    await load();
  };

  const handleTogglePublish = async (live: LiveRow) => {
    const { error: updateError } = await supabase
      .from("lives")
      .update({ results_published: !live.results_published })
      .eq("id", live.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await logAdminAction({
      action: live.results_published ? "results_unpublished" : "results_published",
      targetType: "lives",
      targetId: live.id,
    });
    await load();
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">ライブ予定</h1>
      <p className="font-sans text-xs text-dojo-dark-brown">
        新しいライブの予定は
        <Link href="/live/host" className="underline">
          ライブ準備画面
        </Link>
        から作成してください。ここでは既存の予定を編集できます。
      </p>

      {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lives.map((live) => (
            <li key={live.id} className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className="font-sans text-sm font-bold text-dojo-ink">
                  {formatLiveTicketNo(live.sequence_number)} {live.title ?? "（タイトル未設定）"}
                </p>
                <span className="shrink-0 rounded bg-dojo-dark-brown/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-dojo-dark-brown">
                  {PHASE_LABEL[live.current_phase] ?? live.current_phase}
                </span>
              </div>
              <p className="mt-1 font-sans text-xs text-dojo-dark-brown">
                {new Date(live.scheduled_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </p>

              {editingId === live.id && form ? (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="タイトル"
                    className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                  />
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="簡単な説明"
                    rows={2}
                    className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                  />
                  <label className="flex flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
                    開始日時
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                      className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                    />
                  </label>
                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
                      受付開始
                      <input
                        type="datetime-local"
                        value={form.receptionStartsAt}
                        onChange={(e) => setForm({ ...form, receptionStartsAt: e.target.value })}
                        className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
                      受付終了
                      <input
                        type="datetime-local"
                        value={form.receptionEndsAt}
                        onChange={(e) => setForm({ ...form, receptionEndsAt: e.target.value })}
                        className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-0.5 font-sans text-[10px] text-dojo-dark-brown">
                    最大参加人数
                    <input
                      type="number"
                      min={1}
                      value={form.maxPlayers}
                      onChange={(e) => setForm({ ...form, maxPlayers: e.target.value })}
                      className="rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSave(live.id)}
                      className="rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setForm(null);
                      }}
                      className="rounded-full border border-dojo-dark-brown/30 px-4 py-1.5 font-sans text-xs font-bold text-dojo-dark-brown"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(live)}
                    className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
                  >
                    編集
                  </button>
                  {live.current_phase === "closed" && (
                    <button
                      type="button"
                      onClick={() => handleTogglePublish(live)}
                      className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
                    >
                      {live.results_published ? "結果を非公開にする" : "結果を公開する"}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
          {lives.length === 0 && (
            <p className="font-sans text-sm text-dojo-dark-brown">まだライブの予定がありません。</p>
          )}
        </ul>
      )}
    </div>
  );
}
