"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

// admin_update_account_deletion_request（0077）が投げるエラーコードを
// 日本語文言に変換する。生のPostgreSQL/Supabaseのエラー文言は画面に出さない。
function mapAdminUpdateError(message: string | undefined): string {
  if (!message) return "更新に失敗しました";
  if (message.includes("NOT_AUTHORIZED")) return "権限がありません";
  if (message.includes("REQUEST_NOT_FOUND")) return "申請が見つかりませんでした";
  if (message.includes("INVALID_STATUS")) return "この状態へは変更できません";
  if (message.includes("CANNOT_MODIFY_COMPLETED")) return "対応済み（削除完了）の申請は変更できません（削除トリガーのみが設定します）";
  if (message.includes("USER_ID_MISSING")) return "既にアカウントが削除されているため、未対応へは戻せません";
  return "更新に失敗しました。時間をおいて再度お試しください";
}

interface DeletionRequestRow {
  id: string;
  user_id: string | null;
  request_number: string;
  status: "pending" | "completed" | "rejected";
  requested_at: string;
  processed_at: string | null;
  processed_by: string | null;
  admin_memo: string | null;
}

const STATUS_LABEL: Record<DeletionRequestRow["status"], string> = {
  pending: "未対応",
  completed: "対応済み（削除完了）",
  rejected: "却下",
};

const STATUS_ORDER: DeletionRequestRow["status"][] = ["pending", "completed", "rejected"];

// 管理画面から手動で変更してよい状態は未対応・却下の2つだけ。対応済み（削除
// 完了）は0078の削除トリガーだけが設定するため、ボタンとして提示しない
// （admin_update_account_deletion_requestもcompletedへの変更をサーバー側で
// 拒否する。以下のボタンはUI上での事前防止）。
const MANUAL_STATUS_OPTIONS: DeletionRequestRow["status"][] = ["pending", "rejected"];

// アカウント削除申請の一覧・状態管理画面（運営者専用）。
// 2026-09-25：アプリ内から発行された削除申請（account_deletion_requests、0077）を
// 一覧・確認するための画面。実際のアカウント削除処理は既存の/admin/users/[id]の
// 削除ボタン（auth.admin.deleteUser経由）に一本化しており、この画面からは対象
// ユーザーの管理画面へのリンクを提供するだけで、削除処理そのものは行わない
// （0078のトリガーにより、実際に削除が完了すればpending中の申請は自動的に
// completedへ更新されるため、通常はここで手動でcompletedにする必要はない。
// 却下する場合や、削除以外の方法で対応した場合にのみ、ここで状態を変更する）。
export default function AdminAccountDeletionRequestsPage() {
  const [rows, setRows] = useState<DeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<DeletionRequestRow["status"] | "all">("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [savingMemoId, setSavingMemoId] = useState<string | null>(null);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("account_deletion_requests")
      .select("*")
      .order("requested_at", { ascending: false });
    if (error) {
      notifyError(error.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as DeletionRequestRow[];
    setRows(list);

    const ids = [
      ...new Set(
        list.flatMap((r) => [r.user_id, r.processed_by]).filter((id): id is string => !!id),
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
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  // 2026-09-25（再監査対応）：直接updateではなく、is_host()を検証しcompletedへの
  // 遷移・completed済み行の変更・user_id喪失後のpending復帰を拒否する
  // security definer RPC（admin_update_account_deletion_request、0077）経由に
  // する。status変更はRPC内でadmin_action_logsへの記録も同一トランザクションで
  // 行うため、ここから別途logAdminActionは呼ばない。
  const handleStatusChange = async (row: DeletionRequestRow, status: DeletionRequestRow["status"]) => {
    if (changingStatusId) return;
    setChangingStatusId(row.id);
    try {
      const { error } = await supabase.rpc("admin_update_account_deletion_request", {
        p_request_id: row.id,
        p_status: status,
      });
      if (error) {
        notifyError(mapAdminUpdateError(error.message));
        return;
      }
      notifySuccess(`状態を「${STATUS_LABEL[status]}」に変更しました。`);
      await load();
    } finally {
      setChangingStatusId(null);
    }
  };

  const handleSaveMemo = async (row: DeletionRequestRow) => {
    if (savingMemoId) return;
    setSavingMemoId(row.id);
    try {
      const memo = memoDrafts[row.id] ?? row.admin_memo ?? "";
      const { error } = await supabase.rpc("admin_update_account_deletion_request", {
        p_request_id: row.id,
        p_admin_memo: memo,
      });
      if (error) {
        notifyError(mapAdminUpdateError(error.message));
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
      <AdminHeader title="アカウント削除申請" />
      <AdminNotice notice={notice} onClose={clear} />

      <p className="text-xs text-gray-500">
        実際のアカウント削除は「ユーザー管理」の対象ユーザーページから行います。削除が完了すると、この一覧の
        該当申請は自動的に「対応済み」になります。却下する場合や削除以外の方法で対応した場合にのみ、ここで
        手動で状態を変更してください。
      </p>
      <p className="text-xs font-bold text-red-600">
        注意：演者名（表示名）、Xのユーザー名（@ID）、寄合帳への投稿内容等、一般に公開されている情報だけを
        根拠に、これが本人からの依頼であると判断して削除を進めないでください（なりすましの可能性があります）。
        アプリ内から発行された申請番号（＝申請時点でログイン中だった本人のセッションに紐づく）であることを
        基本の確認手段とし、それ以外の方法でご本人であることを確認できない場合は、削除を保留又は却下してください。
      </p>

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

      <AdminCard title={`申請一覧（${filtered.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">該当する申請はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((r) => (
              <li key={r.id} className="rounded border border-gray-200 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 text-xs text-gray-600">
                    <p>
                      {new Date(r.requested_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      　申請者：
                      <span className="font-bold text-gray-900">
                        {r.user_id ? (names[r.user_id] ?? r.user_id.slice(0, 8)) : "（退会済み）"}
                      </span>
                    </p>
                    <p className="mt-0.5">申請番号：{r.request_number}</p>
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
                    {r.user_id && (
                      <Link
                        href={`/admin/users/${r.user_id}`}
                        className="text-xs font-bold text-blue-600 underline underline-offset-2"
                      >
                        対象ユーザーの管理画面を開く（削除はこちらから実行します）
                      </Link>
                    )}
                    {r.processed_at && (
                      <p className="mt-1 text-xs text-gray-600">
                        処理日時：{new Date(r.processed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                        　処理者：
                        {r.processed_by ? (names[r.processed_by] ?? r.processed_by.slice(0, 8)) : "システム処理"}
                      </p>
                    )}
                    {r.status === "completed" && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        対応済み（削除完了）は削除トリガーだけが設定するため、この画面から状態を変更できません。
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {MANUAL_STATUS_OPTIONS.map((s) => {
                        const disabledForMissingUser = s === "pending" && !r.user_id;
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={
                              changingStatusId === r.id || r.status === "completed" || disabledForMissingUser || r.status === s
                            }
                            title={disabledForMissingUser ? "既にアカウントが削除されているため戻せません" : undefined}
                            onClick={() => handleStatusChange(r, s)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                              r.status === s
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-gray-300 text-gray-600"
                            }`}
                          >
                            {STATUS_LABEL[s]}
                          </button>
                        );
                      })}
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
