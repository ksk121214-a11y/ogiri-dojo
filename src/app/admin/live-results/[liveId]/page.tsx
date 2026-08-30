"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import SnsLiveResultBody from "@/components/sns/SnsLiveResultBody";
import { logAdminAction } from "@/lib/adminActionLog";
import { toLiveScheduleDate } from "@/lib/liveDateFormat";
import { computeLiveResultCandidates, isPerfectAnswer } from "@/lib/liveResultsExtraction";
import type { AnswerRow, LiveRow, ParticipantRow, TopicRow, TurnRow } from "@/lib/liveRoomTypes";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import { supabase } from "@/lib/supabase";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";

interface LiveResultRow {
  id: string;
  live_id: string;
  manager_best_answer_id: string | null;
  manager_comment: string | null;
}

interface ResultAnswerRow {
  id: string;
  live_result_id: string;
  answer_id: string;
  rank: 1 | 2 | 3 | null;
  included: boolean;
  source: "auto" | "manual";
  likes: number;
}

interface CommentRow {
  id: string;
  result_answer_id: string;
  author_id: string;
  body: string;
  created_at: string;
  is_hidden: boolean;
  hidden_reason: string | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ライブ結果（SNS掲載）詳細・設定画面。終了ライブを開いた時点で1〜3位最高得点回答
// （同点含む）・満点回答・運営ベスト候補を自動抽出し、掲載可否・代表の差し替え・
// 運営ベスト・運営コメントを設定してSNSへ公開する。
export default function AdminLiveResultDetailPage() {
  const params = useParams<{ liveId: string }>();
  const liveId = params.liveId;
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveRow | null>(null);
  const [liveResult, setLiveResult] = useState<LiveResultRow | null>(null);
  const [resolvedAnswers, setResolvedAnswers] = useState<AnswerRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [topicByTurnId, setTopicByTurnId] = useState<Map<string, string>>(new Map());
  const [resultAnswers, setResultAnswers] = useState<ResultAnswerRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [managerCommentDraft, setManagerCommentDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const previewDetail = useSnsLiveResultsStore((s) => (liveResult ? s.details[liveResult.id] : undefined));
  const fetchDetail = useSnsLiveResultsStore((s) => s.fetchDetail);

  const candidates = useMemo(
    () => computeLiveResultCandidates(resolvedAnswers, participants),
    [resolvedAnswers, participants],
  );
  const podiumParticipantIdByRank = useMemo(() => {
    const map = new Map<1 | 2 | 3, string>();
    for (const g of candidates.podiumGroups) map.set(g.rank, g.participantId);
    return map;
  }, [candidates]);
  const answerById = useMemo(() => new Map(resolvedAnswers.map((a) => [a.id, a])), [resolvedAnswers]);
  const participantById = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);

  const load = async () => {
    setLoading(true);
    const { data: liveData } = await supabase.from("lives").select("*").eq("id", liveId).maybeSingle();
    if (!liveData) {
      setLoading(false);
      return;
    }
    const liveRow = liveData as LiveRow;
    setLive(liveRow);

    // 1件目のアクセス時はsns_live_results行を作成する（unique(live_id)で二重作成防止）。
    let resultRow: LiveResultRow | null = null;
    const { data: existingResult } = await supabase
      .from("sns_live_results")
      .select("id, live_id, manager_best_answer_id, manager_comment")
      .eq("live_id", liveId)
      .maybeSingle();
    if (existingResult) {
      resultRow = existingResult as LiveResultRow;
    } else {
      const { data: created, error: createError } = await supabase
        .from("sns_live_results")
        .insert({ live_id: liveId })
        .select("id, live_id, manager_best_answer_id, manager_comment")
        .single();
      if (createError) {
        notifyError(`ライブ結果の初期化に失敗しました: ${createError.message}`);
        setLoading(false);
        return;
      }
      resultRow = created as LiveResultRow;
    }
    setLiveResult(resultRow);
    setManagerCommentDraft(resultRow.manager_comment ?? "");

    const { data: turnsData } = await supabase.from("turns").select("*").eq("live_id", liveId);
    const turns = (turnsData ?? []) as TurnRow[];
    const turnIds = turns.map((t) => t.id);

    const [{ data: answersData }, { data: participantsData }, { data: topicsData }] = await Promise.all([
      turnIds.length
        ? supabase.from("answers").select("*").in("turn_id", turnIds).eq("resolved", true)
        : Promise.resolve({ data: [] as AnswerRow[] }),
      supabase.from("participants").select("*").eq("live_id", liveId),
      supabase.from("topics").select("*").eq("live_id", liveId),
    ]);
    const answers = (answersData ?? []) as AnswerRow[];
    const participantsRows = (participantsData ?? []) as ParticipantRow[];
    const topics = (topicsData ?? []) as TopicRow[];
    const topicBodyByTopicId = new Map(topics.map((t) => [t.id, t.body]));
    const topicByTurn = new Map(turns.map((t) => [t.id, topicBodyByTopicId.get(t.topic_id) ?? ""]));

    setResolvedAnswers(answers);
    setParticipants(participantsRows);
    setTopicByTurnId(topicByTurn);

    // 自動抽出結果のうち、sns_live_result_answersにまだ無いものを登録する
    // （既存行のincluded/sourceは上書きしない＝運営の判断を保持する）。
    const computed = computeLiveResultCandidates(answers, participantsRows);
    const toInsert: { live_result_id: string; answer_id: string; rank: 1 | 2 | 3 | null }[] = [];
    for (const g of computed.podiumGroups) {
      for (const a of g.answers) toInsert.push({ live_result_id: resultRow.id, answer_id: a.id, rank: g.rank });
    }
    for (const a of computed.perfectAnswers) {
      if (toInsert.some((r) => r.answer_id === a.id)) continue;
      toInsert.push({ live_result_id: resultRow.id, answer_id: a.id, rank: null });
    }
    if (toInsert.length > 0) {
      await supabase
        .from("sns_live_result_answers")
        .upsert(toInsert, { onConflict: "live_result_id,answer_id", ignoreDuplicates: true });
    }

    const { data: raData } = await supabase
      .from("sns_live_result_answers")
      .select("id, live_result_id, answer_id, rank, included, source, likes")
      .eq("live_result_id", resultRow.id);
    const ra = (raData ?? []) as ResultAnswerRow[];
    setResultAnswers(ra);

    const profileIds = [...new Set(participantsRows.map((p) => p.user_id))];
    if (profileIds.length > 0) {
      const { data: namesData } = await supabase.rpc("sns_author_names", { p_ids: profileIds });
      const map: Record<string, string> = {};
      for (const row of (namesData ?? []) as { id: string; display_name: string }[]) {
        map[row.id] = row.display_name;
      }
      setNames(map);
    }

    const resultAnswerIds = ra.map((r) => r.id);
    if (resultAnswerIds.length > 0) {
      const { data: commentsData } = await supabase
        .from("sns_live_result_comments")
        .select("*")
        .in("result_answer_id", resultAnswerIds)
        .order("created_at", { ascending: false });
      setComments((commentsData ?? []) as CommentRow[]);
    } else {
      setComments([]);
    }

    setLoading(false);
    fetchDetail(resultRow.id, true);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveId]);

  const authorNameOf = (participantId: string): string => {
    const p = participantById.get(participantId);
    if (!p) return "（不明）";
    return names[p.user_id] ?? "（名前未設定）";
  };

  const refreshResultAnswers = async () => {
    if (!liveResult) return;
    const { data } = await supabase
      .from("sns_live_result_answers")
      .select("id, live_result_id, answer_id, rank, included, source, likes")
      .eq("live_result_id", liveResult.id);
    setResultAnswers((data ?? []) as ResultAnswerRow[]);
    fetchDetail(liveResult.id, true);
  };

  const handleToggleIncluded = async (row: ResultAnswerRow) => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("sns_live_result_answers")
      .update({ included: !row.included })
      .eq("id", row.id);
    if (error) {
      notifyError(error.message);
    } else {
      await logAdminAction({
        action: row.included ? "sns_live_result_answer_excluded" : "sns_live_result_answer_restored",
        targetType: "sns_live_results",
        targetId: liveResult?.id,
        detail: { answer_id: row.answer_id, rank: row.rank },
      });
      notifySuccess(row.included ? "掲載対象から外しました。" : "掲載対象に戻しました。");
      await refreshResultAnswers();
    }
    setBusy(false);
  };

  const handleReplaceRank = async (rank: 1 | 2 | 3, newAnswerId: string) => {
    if (!liveResult || !newAnswerId || busy) return;
    setBusy(true);
    // その順位の現在の代表(自動・手動問わず)をすべて掲載対象から外し、選び直した回答を
    // 新しい代表として追加する（同じプレイヤーの別回答への差し替え）。
    const currentRows = resultAnswers.filter((r) => r.rank === rank);
    for (const row of currentRows) {
      await supabase.from("sns_live_result_answers").update({ included: false }).eq("id", row.id);
    }
    const { error } = await supabase.from("sns_live_result_answers").upsert(
      {
        live_result_id: liveResult.id,
        answer_id: newAnswerId,
        rank,
        included: true,
        source: "manual",
      },
      { onConflict: "live_result_id,answer_id" },
    );
    if (error) {
      notifyError(error.message);
    } else {
      await logAdminAction({
        action: "sns_live_result_rank_replaced",
        targetType: "sns_live_results",
        targetId: liveResult.id,
        detail: { rank, answer_id: newAnswerId },
      });
      notifySuccess(`${rank}位代表を差し替えました。`);
      await refreshResultAnswers();
    }
    setBusy(false);
  };

  const excludedForManagerBest = useMemo(() => {
    const ids = new Set<string>();
    for (const g of candidates.podiumGroups) for (const a of g.answers) ids.add(a.id);
    for (const a of candidates.perfectAnswers) ids.add(a.id);
    for (const r of resultAnswers) {
      if (r.rank !== null && r.included) ids.add(r.answer_id);
    }
    return ids;
  }, [candidates, resultAnswers]);

  const managerBestOptions = useMemo(() => {
    const playerIds = new Set(participants.filter((p) => p.role === "player").map((p) => p.id));
    return resolvedAnswers.filter((a) => playerIds.has(a.participant_id) && !excludedForManagerBest.has(a.id));
  }, [resolvedAnswers, participants, excludedForManagerBest]);

  const handleSetManagerBest = async (answerId: string | null) => {
    if (!liveResult || busy) return;
    setBusy(true);
    if (answerId) {
      await supabase.from("sns_live_result_answers").upsert(
        { live_result_id: liveResult.id, answer_id: answerId, rank: null, included: true, source: "manual" },
        { onConflict: "live_result_id,answer_id" },
      );
    }
    const { error } = await supabase
      .from("sns_live_results")
      .update({ manager_best_answer_id: answerId, updated_at: new Date().toISOString() })
      .eq("id", liveResult.id);
    if (error) {
      notifyError(error.message);
    } else {
      setLiveResult({ ...liveResult, manager_best_answer_id: answerId });
      await logAdminAction({
        action: "sns_live_result_best_set",
        targetType: "sns_live_results",
        targetId: liveResult.id,
        detail: { answer_id: answerId },
      });
      notifySuccess(answerId ? "運営ベストを設定しました。" : "運営ベストを「該当なし」にしました。");
      await refreshResultAnswers();
    }
    setBusy(false);
  };

  const handleSaveManagerComment = async () => {
    if (!liveResult || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("sns_live_results")
      .update({ manager_comment: managerCommentDraft || null, updated_at: new Date().toISOString() })
      .eq("id", liveResult.id);
    if (error) {
      notifyError(error.message);
    } else {
      setLiveResult({ ...liveResult, manager_comment: managerCommentDraft || null });
      await logAdminAction({
        action: "sns_live_result_comment_set",
        targetType: "sns_live_results",
        targetId: liveResult.id,
      });
      notifySuccess("運営コメントを保存しました。");
      fetchDetail(liveResult.id, true);
    }
    setBusy(false);
  };

  const handleTogglePublish = async () => {
    if (!live || publishing) return;
    if (live.current_phase !== "closed") {
      notifyError("終了していないライブは公開できません。");
      return;
    }
    setPublishing(true);
    const nextValue = !live.results_published;
    const { error } = await supabase.from("lives").update({ results_published: nextValue }).eq("id", live.id);
    if (error) {
      notifyError(error.message);
    } else {
      setLive({ ...live, results_published: nextValue });
      await logAdminAction({
        action: nextValue ? "results_published" : "results_unpublished",
        targetType: "lives",
        targetId: live.id,
      });
      notifySuccess(nextValue ? "SNSにライブ結果を公開しました。" : "SNSでの公開を解除しました。");
      if (liveResult) fetchDetail(liveResult.id, true);
    }
    setPublishing(false);
  };

  const handleToggleCommentHidden = async (comment: CommentRow) => {
    if (busy) return;
    let reason: string | null = null;
    if (!comment.is_hidden) {
      reason = window.prompt("非表示にする理由を入力してください（省略可）", "") ?? "";
    }
    setBusy(true);
    const { error } = await supabase
      .from("sns_live_result_comments")
      .update({
        is_hidden: !comment.is_hidden,
        hidden_reason: comment.is_hidden ? null : reason || null,
        hidden_at: comment.is_hidden ? null : new Date().toISOString(),
      })
      .eq("id", comment.id);
    if (error) {
      notifyError(error.message);
    } else {
      await logAdminAction({
        action: comment.is_hidden ? "post_unhidden" : "post_hidden",
        targetType: "sns_live_result_comment",
        targetId: comment.id,
      });
      notifySuccess(comment.is_hidden ? "非表示を解除しました。" : "非表示にしました。");
      await refreshResultAnswers();
      if (liveResult) {
        const { data } = await supabase
          .from("sns_live_result_comments")
          .select("*")
          .in(
            "result_answer_id",
            resultAnswers.map((r) => r.id),
          )
          .order("created_at", { ascending: false });
        setComments((data ?? []) as CommentRow[]);
      }
    }
    setBusy(false);
  };

  const handleDeleteComment = async (comment: CommentRow) => {
    if (busy) return;
    if (!window.confirm("このコメントを完全に削除しますか？この操作は取り消せません。")) return;
    setBusy(true);
    const { error } = await supabase.from("sns_live_result_comments").delete().eq("id", comment.id);
    if (error) {
      notifyError(error.message);
    } else {
      await logAdminAction({
        action: "post_deleted",
        targetType: "sns_live_result_comment",
        targetId: comment.id,
      });
      notifySuccess("完全に削除しました。");
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      if (liveResult) await refreshResultAnswers();
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <AdminShell wide>
        <AdminHeader title="ライブ結果の設定" backHref="/admin/live-results" />
        <p className="text-sm text-gray-500">読み込み中…</p>
      </AdminShell>
    );
  }

  if (!live || !liveResult) {
    return (
      <AdminShell wide>
        <AdminHeader title="ライブ結果の設定" backHref="/admin/live-results" />
        <p className="text-sm text-gray-500">ライブが見つかりませんでした。</p>
      </AdminShell>
    );
  }

  const perfectRows = resultAnswers.filter(
    (r) => r.rank === null && r.answer_id !== liveResult.manager_best_answer_id && isPerfect(r),
  );

  function isPerfect(r: ResultAnswerRow): boolean {
    const a = answerById.get(r.answer_id);
    return !!a && isPerfectAnswer(a);
  }

  return (
    <AdminShell wide>
      <AdminHeader title="ライブ結果の設定" backHref="/admin/live-results" />
      <AdminNotice notice={notice} onClose={clear} />

      <AdminCard>
        <p className="text-sm font-bold text-gray-900">
          {formatLiveTicketNo(live.sequence_number)}
          {live.title ? `　${live.title}` : ""}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {(() => {
            const d = toLiveScheduleDate(live.scheduled_at);
            return `${d.year}/${d.month}/${d.day}(${d.weekday}) ${d.time}`;
          })()}
          　現在の公開状態：
          <span className={live.results_published ? "font-bold text-green-700" : "font-bold text-gray-500"}>
            {live.results_published ? "SNS公開中" : "未公開"}
          </span>
        </p>
        <div className="mt-3">
          <AdminButton
            variant={live.results_published ? "danger" : "primary"}
            disabled={publishing || live.current_phase !== "closed"}
            onClick={handleTogglePublish}
          >
            {publishing
              ? "処理中…"
              : live.results_published
                ? "SNSでの公開を解除する"
                : "SNSにライブ結果を公開する"}
          </AdminButton>
          {live.current_phase !== "closed" && (
            <p className="mt-1 text-[11px] text-red-600">終了していないライブは公開できません。</p>
          )}
        </div>
      </AdminCard>

      {([1, 2, 3] as const).map((rank) => {
        const rows = resultAnswers.filter((r) => r.rank === rank);
        const participantId = podiumParticipantIdByRank.get(rank);
        const otherAnswers = participantId
          ? resolvedAnswers.filter(
              (a) => a.participant_id === participantId && !rows.some((r) => r.answer_id === a.id),
            )
          : [];
        return (
          <AdminCard key={rank} title={`${rank}位 最高得点回答`}>
            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">対象の回答がありません。</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((row) => {
                  const answer = answerById.get(row.answer_id);
                  if (!answer) return null;
                  return (
                    <li key={row.id} className="rounded border border-gray-200 p-2.5">
                      <p className="text-[11px] text-gray-400">
                        お題：{topicByTurnId.get(answer.turn_id) || "（不明）"}
                      </p>
                      <p className="text-sm text-gray-900">{truncate(answer.body, 60)}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {authorNameOf(answer.participant_id)}　{answer.score_total}点
                        {row.source === "manual" && "　（差し替え済み）"}
                      </p>
                      <div className="mt-1.5">
                        <AdminButton
                          variant={row.included ? "danger" : "secondary"}
                          disabled={busy}
                          onClick={() => handleToggleIncluded(row)}
                        >
                          {row.included ? "掲載対象から外す" : "掲載対象へ戻す"}
                        </AdminButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {otherAnswers.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <select
                  disabled={busy}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) handleReplaceRank(rank, e.target.value);
                    e.target.value = "";
                  }}
                  className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">別の回答へ差し替える…</option>
                  {otherAnswers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {truncate(a.body, 30)}（{a.score_total}点）
                    </option>
                  ))}
                </select>
              </div>
            )}
          </AdminCard>
        );
      })}

      {perfectRows.length > 0 && (
        <AdminCard title="満点回答">
          <ul className="flex flex-col gap-2">
            {perfectRows.map((row) => {
              const answer = answerById.get(row.answer_id);
              if (!answer) return null;
              return (
                <li key={row.id} className="rounded border border-gray-200 p-2.5">
                  <p className="text-[11px] text-gray-400">
                    お題：{topicByTurnId.get(answer.turn_id) || "（不明）"}
                  </p>
                  <p className="text-sm text-gray-900">{truncate(answer.body, 60)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {authorNameOf(answer.participant_id)}　{answer.score_total}点
                  </p>
                  <div className="mt-1.5">
                    <AdminButton
                      variant={row.included ? "danger" : "secondary"}
                      disabled={busy}
                      onClick={() => handleToggleIncluded(row)}
                    >
                      {row.included ? "掲載対象から外す" : "掲載対象へ戻す"}
                    </AdminButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminCard>
      )}

      <AdminCard title="運営ベスト">
        <select
          disabled={busy}
          value={liveResult.manager_best_answer_id ?? ""}
          onChange={(e) => handleSetManagerBest(e.target.value || null)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">該当なし</option>
          {managerBestOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {authorNameOf(a.participant_id)}：{truncate(a.body, 30)}（{a.score_total}点）
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-500">
          1〜3位代表・満点回答は候補に表示されません。候補が無い場合は「該当なし」のままにできます。
        </p>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-bold text-gray-700">運営コメント（任意）</span>
          <textarea
            value={managerCommentDraft}
            onChange={(e) => setManagerCommentDraft(e.target.value)}
            rows={2}
            className="w-full rounded border border-gray-300 p-2 text-sm"
          />
        </label>
        <div className="mt-2">
          <AdminButton variant="primary" disabled={busy} onClick={handleSaveManagerComment}>
            運営コメントを保存
          </AdminButton>
        </div>
      </AdminCard>

      {comments.length > 0 && (
        <AdminCard title={`ライブ結果コメント（${comments.length}件）`}>
          <ul className="flex flex-col gap-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded border border-gray-200 p-2.5">
                <p className={`text-sm ${c.is_hidden ? "text-gray-400 line-through" : "text-gray-900"}`}>
                  {truncate(c.body, 60)}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{names[c.author_id] ?? c.author_id.slice(0, 8)}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <AdminButton
                    variant={c.is_hidden ? "secondary" : "danger"}
                    disabled={busy}
                    onClick={() => handleToggleCommentHidden(c)}
                  >
                    {c.is_hidden ? "非表示を解除" : "非表示にする"}
                  </AdminButton>
                  <AdminButton variant="danger" disabled={busy} onClick={() => handleDeleteComment(c)}>
                    完全削除
                  </AdminButton>
                </div>
              </li>
            ))}
          </ul>
        </AdminCard>
      )}

      <AdminCard title="SNS上での表示プレビュー">
        {previewDetail ? (
          <SnsLiveResultBody detail={previewDetail} readOnly />
        ) : (
          <p className="text-sm text-gray-500">プレビューを読み込み中…</p>
        )}
      </AdminCard>
    </AdminShell>
  );
}
