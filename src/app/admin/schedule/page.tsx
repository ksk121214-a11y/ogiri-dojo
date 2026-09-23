"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { formatLiveTicketLabel } from "@/lib/liveTicketNo";
import type { LiveRow } from "@/lib/liveRoomTypes";
import {
  summarizeReferralSurvey,
  toOverallReferralSurveyCounts,
  type OverallReferralSurveyCounts,
  type OverallReferralSurveyRow,
  type ReferralSurveyCounts,
} from "@/lib/referralSurveySummary";
import { runSingleFlight } from "@/lib/singleFlight";
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

      <OverallReferralSurveySection />
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

// 流入アンケート集計は運営者専用画面だけで使う（一般ユーザー側には一切出さない）。
// そのライブに参加した時点の participants.referral_source を集計するだけの
// 軽いクエリ1本（is_guest/referral_sourceの2列だけをlive_id指定で取得）にとどめ、
// N+1・全件取得は行わない。取得失敗時は0人として誤表示せず"error"を返す。
async function fetchReferralSurveySummary(liveId: string): Promise<ReferralSurveyCounts | "error"> {
  const { data, error } = await supabase
    .from("participants")
    .select("referral_source, is_guest")
    .eq("live_id", liveId);
  if (error || !data) return "error";
  return summarizeReferralSurvey(
    (data as { referral_source: string | null; is_guest: boolean }[]).map((r) => ({
      referralSource: r.referral_source,
      isGuest: r.is_guest,
    })),
  );
}

// 「全体アンケート集計」（サービス全体で1アカウント1回の回答を集計する）。
// ライブ単位の集計（fetchReferralSurveySummary、participants基準）とは目的が
// 異なり、こちらはprofiles.referral_source（0074）をDB側で直接集計するRPC
// public.admin_referral_survey_summary()（0075、運営者のみ実行可・SECURITY
// DEFINER）を呼ぶだけで、フロント側では一切プロフィール行を取得・集計しない。
// Supabaseが返す{error}オブジェクトだけでなく、通信例外等でこの関数自体が
// 例外を投げた場合も、生のエラーを外へ漏らさず"error"として返す
// （呼び出し側のsingle-flightロックが確実に解除されるよう、ここで例外を
// 握りつぶす。詳細はOverallReferralSurveySectionのload参照）。
async function fetchOverallReferralSurveySummary(): Promise<OverallReferralSurveyCounts | "error"> {
  try {
    const { data, error } = await supabase.rpc("admin_referral_survey_summary");
    const row = (data as OverallReferralSurveyRow[] | null)?.[0];
    if (error || !row) return "error";
    return toOverallReferralSurveyCounts(row);
  } catch {
    return "error";
  }
}

function OverallReferralSurveySection() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<OverallReferralSurveyCounts | "error" | null>(null);

  // 2026-09-23修正（レビュー対応）：stateのloadingは次の再描画まで反映されない
  // ため、それだけを連打防止のロックに使うと、同じtick内でload()が2回呼ばれた
  // 場合に両方とも古いloading=falseを見て二重実行してしまう（React Strict Mode
  // の開発時二重effect実行でも同様に起こり得る）。useRef<boolean>が返す
  // { current: boolean }は、そのままsingle-flightの排他ロック
  // （src/lib/singleFlight.ts、SingleFlightLock）として使え、同期的に
  // 読み書きできるため二重実行を確実に防げる。loading state自体は画面表示・
  // ボタンのdisabled制御にだけ引き続き使う。
  const inFlightLockRef = useRef(false);
  // アンマウント後に遅延した取得結果でstateを更新しないためのガード。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = () => {
    void runSingleFlight(inFlightLockRef, async () => {
      setLoading(true);
      try {
        const result = await fetchOverallReferralSurveySummary();
        if (mountedRef.current) setSummary(result);
      } catch {
        // fetchOverallReferralSurveySummary自体は例外を投げない設計だが、
        // 予期しない例外が万一発生しても生のエラーを表示せず、専用の
        // エラーメッセージへ倒す（このtryはrunSingleFlightのfinallyで
        // ロックが確実に解除されることの安全網でもある）。
        if (mountedRef.current) setSummary("error");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    });
  };

  // 初回表示時の自動取得も、再読み込みボタンと同じload()（＝同じ
  // single-flight制御）を通す。React Strict Modeの開発時にこのeffectが
  // マウント→クリーンアップ→再マウントで2回評価されても、1回目のload()が
  // 同期的に立てたinFlightLockRef.currentがまだtrueのままなので、2回目の
  // load()はrunSingleFlightに素通しされずスキップされる。
  useEffect(() => {
    load();
  }, []);

  return (
    <AdminCard title="全体アンケート集計">
      <p className="text-xs text-gray-500">1アカウントにつき1回の回答を集計しています。</p>
      <div className="mt-2 text-sm text-gray-700">
        {summary === null ? (
          <p className="text-gray-400">読み込み中…</p>
        ) : summary === "error" ? (
          <p className="text-red-600">全体アンケート集計の取得に失敗しました</p>
        ) : summary.answeredTotal === 0 ? (
          <p className="text-gray-400">アンケートの回答はまだありません</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p>X（旧Twitter）：{summary.x}人</p>
            <p>友人・知人の紹介：{summary.friend}人</p>
            <p>アプリ内：{summary.app}人</p>
            <p>その他：{summary.other}人</p>
            <p className="mt-1 font-bold">回答済み合計：{summary.answeredTotal}人</p>
          </div>
        )}
      </div>
      <AdminButton className="mt-2" disabled={loading} onClick={load}>
        {loading ? "読み込み中…" : "再読み込み"}
      </AdminButton>
    </AdminCard>
  );
}

function ResultsPublishSection() {
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, QuickResultSummary | "loading">>({});
  const [referralSummaries, setReferralSummaries] = useState<Record<string, ReferralSurveyCounts | "loading" | "error">>(
    {},
  );

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

  const handleToggleExpand = (liveId: string) => {
    if (expandedId === liveId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(liveId);
    if (!summaries[liveId]) {
      setSummaries((s) => ({ ...s, [liveId]: "loading" }));
      fetchQuickResultSummary(liveId).then((summary) => {
        setSummaries((s) => ({ ...s, [liveId]: summary }));
      });
    }
    if (!referralSummaries[liveId]) {
      setReferralSummaries((s) => ({ ...s, [liveId]: "loading" }));
      fetchReferralSurveySummary(liveId).then((summary) => {
        setReferralSummaries((s) => ({ ...s, [liveId]: summary }));
      });
    }
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
                    {formatLiveTicketLabel(live.live_mode, live.official_sequence_number)} {live.title ?? "（タイトル未設定）"}
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
                  <ReferralSurveySummaryBlock summary={referralSummaries[live.id]} />
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

// 流入アンケート集計の表示欄。summary.hasResult（SNS掲載結果の有無）とは無関係に、
// そのライブに参加したparticipants.referral_sourceがあれば常に表示する
// （運営者専用画面だけに出す。一般ユーザー側には一切公開しない）。
function ReferralSurveySummaryBlock({ summary }: { summary: ReferralSurveyCounts | "loading" | "error" | undefined }) {
  return (
    <div className="mt-2 rounded border border-gray-100 bg-gray-50 p-2">
      <p className="mb-1 font-bold text-gray-700">流入アンケート</p>
      {summary === "loading" || !summary ? (
        <p className="text-gray-400">読み込み中…</p>
      ) : summary === "error" ? (
        <p className="text-red-600">アンケート集計の取得に失敗しました</p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            <p>X：{summary.x}人</p>
            <p>友人・知人の紹介：{summary.friend}人</p>
            <p>アプリ内：{summary.app}人</p>
            <p>その他：{summary.other}人</p>
            <p>未回答：{summary.noAnswer}人</p>
          </div>
          <p className="text-gray-500">
            回答済み：{summary.answered}人 / 対象：{summary.target}人
          </p>
        </div>
      )}
    </div>
  );
}
