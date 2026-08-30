"use client";

import { useEffect, useMemo, useState } from "react";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { logAdminAction } from "@/lib/adminActionLog";
import { supabase } from "@/lib/supabase";

type PostKind = "sns_topic" | "sns_answer" | "sns_comment";

interface PostRow {
  id: string;
  kind: PostKind;
  body: string;
  author_id: string;
  created_at: string;
  is_hidden: boolean;
  hidden_reason: string | null;
}

const KIND_LABEL: Record<PostKind, string> = {
  sns_topic: "お題投稿",
  sns_answer: "回答",
  sns_comment: "コメント",
};

type VisibilityFilter = "all" | "visible" | "hidden";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 投稿・回答管理画面（運営者専用管理画面）。sns_topics/sns_answers/
// sns_commentsを横断的に一覧し、非表示/解除・完全削除を行う。通常はすぐ完全削除
// せず「非表示」を基本にする（要件どおり）。非表示にした内容も一覧に表示し続ける
// （is_hiddenの値に関わらずここでは全件取得する）。
// 2026-08-30（デザイン整理）：キーワード検索・種別/公開状態の絞り込み・投稿者名の
// 表示を追加し、非表示/完全削除の操作は「詳細確認」を開いた後にのみ表示するように
// した。管理操作のロジック自体（クエリ・更新内容）は変更していない。
export default function AdminPostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reportedTargetIds, setReportedTargetIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [filterKind, setFilterKind] = useState<PostKind | "all">("all");
  const [filterVisibility, setFilterVisibility] = useState<VisibilityFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const load = async () => {
    setLoading(true);
    const [{ data: topics }, { data: answers }, { data: comments }, { data: reports }] = await Promise.all([
      supabase.from("sns_topics").select("*").order("created_at", { ascending: false }),
      supabase.from("sns_answers").select("*").order("created_at", { ascending: false }),
      supabase.from("sns_comments").select("*").order("created_at", { ascending: false }),
      supabase.from("reports").select("target_id"),
    ]);
    const combined: PostRow[] = [
      ...(topics ?? []).map((t) => ({ ...t, kind: "sns_topic" as const })),
      ...(answers ?? []).map((a) => ({ ...a, kind: "sns_answer" as const })),
      ...(comments ?? []).map((c) => ({ ...c, kind: "sns_comment" as const })),
    ];
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setRows(combined);
    setReportedTargetIds(new Set((reports ?? []).map((r) => r.target_id as string)));

    const authorIds = [...new Set(combined.map((r) => r.author_id))];
    if (authorIds.length > 0) {
      const { data: authorData } = await supabase.rpc("sns_author_names", { p_ids: authorIds });
      const map: Record<string, string> = {};
      for (const row of (authorData ?? []) as { id: string; display_name: string }[]) {
        map[row.id] = row.display_name;
      }
      setNames(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return rows.filter((r) => {
      if (filterKind !== "all" && r.kind !== filterKind) return false;
      if (filterVisibility === "visible" && r.is_hidden) return false;
      if (filterVisibility === "hidden" && !r.is_hidden) return false;
      if (kw && !r.body.includes(kw)) return false;
      return true;
    });
  }, [rows, keyword, filterKind, filterVisibility]);

  const tableName = (kind: PostKind) =>
    kind === "sns_topic" ? "sns_topics" : kind === "sns_answer" ? "sns_answers" : "sns_comments";

  const handleToggleHidden = async (row: PostRow, key: string) => {
    if (togglingKey) return;
    let reason: string | null = null;
    if (!row.is_hidden) {
      reason = window.prompt("非表示にする理由を入力してください（省略可）", "") ?? "";
    }
    setTogglingKey(key);
    try {
      const { error } = await supabase
        .from(tableName(row.kind))
        .update({
          is_hidden: !row.is_hidden,
          hidden_reason: row.is_hidden ? null : reason || null,
          hidden_at: row.is_hidden ? null : new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) {
        notifyError(error.message);
        return;
      }
      await logAdminAction({
        action: row.is_hidden ? "post_unhidden" : "post_hidden",
        targetType: row.kind,
        targetId: row.id,
        reason: reason ?? undefined,
      });
      notifySuccess(row.is_hidden ? "非表示を解除しました。" : "非表示にしました。");
      await load();
    } finally {
      setTogglingKey(null);
    }
  };

  const handleDelete = async (row: PostRow, key: string) => {
    if (deletingKey) return;
    const confirmed = window.confirm(
      "この投稿を完全に削除しますか？通常は「非表示」を推奨します。この操作は取り消せません。",
    );
    if (!confirmed) return;
    setDeletingKey(key);
    try {
      const { error } = await supabase.from(tableName(row.kind)).delete().eq("id", row.id);
      if (error) {
        notifyError(error.message);
        return;
      }
      await logAdminAction({ action: "post_deleted", targetType: row.kind, targetId: row.id });
      notifySuccess("完全に削除しました。");
      await load();
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <AdminShell wide>
      <AdminHeader title="投稿・回答管理" />
      <AdminNotice notice={notice} onClose={clear} />

      <AdminCard>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="キーワード検索"
            className="min-w-[160px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["all", "sns_topic", "sns_answer", "sns_comment"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilterKind(k)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                filterKind === k ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 text-gray-600"
              }`}
            >
              {k === "all" ? "すべて" : KIND_LABEL[k]}
            </button>
          ))}
          <span className="mx-1 self-center text-gray-300">|</span>
          {(["all", "visible", "hidden"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilterVisibility(v)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                filterVisibility === v ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 text-gray-600"
              }`}
            >
              {v === "all" ? "すべて" : v === "visible" ? "公開中" : "非表示"}
            </button>
          ))}
        </div>
      </AdminCard>

      <AdminCard title={`一覧（${filtered.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">投稿がありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((row) => {
              const key = `${row.kind}-${row.id}`;
              return (
                <li key={key} className="rounded border border-gray-200 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 text-xs text-gray-600">
                      <p className={`text-sm ${row.is_hidden ? "text-gray-400 line-through" : "text-gray-900"}`}>
                        {truncate(row.body, 40)}
                      </p>
                      <p className="mt-0.5">
                        {KIND_LABEL[row.kind]}　投稿者：{names[row.author_id] ?? row.author_id.slice(0, 8)}
                        　{new Date(row.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.is_hidden && (
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
                          非表示中
                        </span>
                      )}
                      {reportedTargetIds.has(row.id) && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          通報あり
                        </span>
                      )}
                      <AdminButton onClick={() => setOpenKey((prev) => (prev === key ? null : key))}>
                        {openKey === key ? "閉じる" : "詳細確認"}
                      </AdminButton>
                    </div>
                  </div>

                  {openKey === key && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-sm text-gray-900">{row.body}</p>
                      {row.hidden_reason && (
                        <p className="mt-1 text-xs text-gray-500">非表示理由：{row.hidden_reason}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <AdminButton
                          variant="primary"
                          disabled={togglingKey === key}
                          onClick={() => handleToggleHidden(row, key)}
                        >
                          {togglingKey === key ? "処理中…" : row.is_hidden ? "非表示を解除する" : "非表示にする"}
                        </AdminButton>
                        <AdminButton
                          variant="danger"
                          disabled={deletingKey === key}
                          onClick={() => handleDelete(row, key)}
                        >
                          {deletingKey === key ? "削除中…" : "完全削除"}
                        </AdminButton>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>
    </AdminShell>
  );
}
