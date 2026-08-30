"use client";

import { useEffect, useMemo, useState } from "react";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  target_author_id: string | null;
  reason: string;
  detail: string | null;
  snapshot_body: string;
  status: "open" | "reviewing" | "resolved" | "no_action";
  admin_memo: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<ReportRow["status"], string> = {
  open: "未対応",
  reviewing: "確認中",
  resolved: "対応済み",
  no_action: "問題なし",
};

const STATUS_ORDER: ReportRow["status"][] = ["open", "reviewing", "resolved", "no_action"];

const TARGET_TYPE_LABEL: Record<string, string> = {
  sns_topic: "お題投稿",
  sns_answer: "回答",
  sns_comment: "コメント",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 通報管理画面（運営者専用管理画面）。通報数だけで自動非表示・自動削除は
// 行わず、運営者が内容を見て対応状態・運営メモを記録する（実際の非表示操作は
// /admin/postsで行う）。投稿者・通報者の表示名はsns_author_names RPCで解決する。
// 2026-08-30（デザイン整理）：一覧は概要のみのコンパクト表示にし、対応状態の
// 変更・運営メモの記入は「詳細確認」を押した後にだけ表示するようにした。
// 管理操作のロジック自体（クエリ・更新内容）は変更していない。
export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<ReportRow["status"] | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [savingMemoId, setSavingMemoId] = useState<string | null>(null);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      notifyError(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as ReportRow[];
    setReports(rows);

    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.reporter_id, r.target_author_id].filter(Boolean) as string[]),
      ),
    ];
    if (ids.length > 0) {
      const { data: authorData } = await supabase.rpc("sns_author_names", { p_ids: ids });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (statusFilter === "all" ? reports : reports.filter((r) => r.status === statusFilter)),
    [reports, statusFilter],
  );

  const handleStatusChange = async (report: ReportRow, status: ReportRow["status"]) => {
    if (changingStatusId) return;
    setChangingStatusId(report.id);
    try {
      const { error } = await supabase
        .from("reports")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", report.id);
      if (error) {
        notifyError(error.message);
        return;
      }
      notifySuccess(`対応状態を「${STATUS_LABEL[status]}」に変更しました。`);
      await load();
    } finally {
      setChangingStatusId(null);
    }
  };

  const handleSaveMemo = async (report: ReportRow) => {
    if (savingMemoId) return;
    setSavingMemoId(report.id);
    try {
      const memo = memoDrafts[report.id] ?? report.admin_memo ?? "";
      const { error } = await supabase
        .from("reports")
        .update({ admin_memo: memo, updated_at: new Date().toISOString() })
        .eq("id", report.id);
      if (error) {
        notifyError(error.message);
        return;
      }
      notifySuccess("運営メモを保存しました。");
      await load();
    } finally {
      setSavingMemoId(null);
    }
  };

  return (
    <AdminShell wide>
      <AdminHeader title="通報管理" />
      <AdminNotice notice={notice} onClose={clear} />

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...STATUS_ORDER] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              statusFilter === s ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 text-gray-600"
            }`}
          >
            {s === "all" ? "すべて" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <AdminCard title={`通報一覧（${filtered.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">該当する通報はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((r) => (
              <li key={r.id} className="rounded border border-gray-200 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 text-xs text-gray-600">
                    <p>
                      {new Date(r.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      　被通報者：
                      <span className="font-bold text-gray-900">
                        {r.target_author_id ? (names[r.target_author_id] ?? r.target_author_id.slice(0, 8)) : "（不明）"}
                      </span>
                    </p>
                    <p className="mt-0.5">
                      理由：{r.reason}　対象：{TARGET_TYPE_LABEL[r.target_type] ?? r.target_type}
                      「{truncate(r.snapshot_body, 24)}」
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                    {STATUS_LABEL[r.status]}
                  </span>
                  <AdminButton onClick={() => setOpenId((prev) => (prev === r.id ? null : r.id))}>
                    {openId === r.id ? "閉じる" : "詳細確認"}
                  </AdminButton>
                </div>

                {openId === r.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-600">
                      通報者：{names[r.reporter_id] ?? r.reporter_id.slice(0, 8)}
                    </p>
                    {r.detail && <p className="mt-1 text-xs text-gray-600">詳細：{r.detail}</p>}
                    <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-700">
                      通報時点の内容：「{r.snapshot_body}」
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {STATUS_ORDER.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={changingStatusId === r.id}
                          onClick={() => handleStatusChange(r, s)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                            r.status === s
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-gray-300 text-gray-600"
                          }`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={memoDrafts[r.id] ?? r.admin_memo ?? ""}
                        onChange={(e) => setMemoDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="運営メモ"
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                      <AdminButton disabled={savingMemoId === r.id} onClick={() => handleSaveMemo(r)}>
                        {savingMemoId === r.id ? "保存中…" : "保存"}
                      </AdminButton>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </AdminShell>
  );
}
