"use client";

import { useEffect, useMemo, useState } from "react";

import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminShell from "@/components/admin/AdminShell";
import { formatActionLabel, formatTargetTypeLabel } from "@/lib/adminActionLabels";
import { supabase } from "@/lib/supabase";

interface LogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

// 運営操作履歴の一覧画面（運営者専用管理画面）。admin_action_logsを一覧表示する
// 閲覧専用ページ（編集・削除ボタンは持たない）。操作種別での簡易フィルタのみ。
// 2026-08-30（デザイン整理）：カード一覧から表形式に変更し、操作日時・操作内容・
// 操作対象・理由を1行ずつ短く見せるようにした。取得ロジックは変更していない。
export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("admin_action_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      const rows = (data ?? []) as LogRow[];
      setLogs(rows);
      const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[])];
      if (actorIds.length > 0) {
        const { data: authorData } = await supabase.rpc("sns_author_names", { p_ids: actorIds });
        const map: Record<string, string> = {};
        for (const row of (authorData ?? []) as { id: string; display_name: string }[]) {
          map[row.id] = row.display_name;
        }
        setNames(map);
      }
      setLoading(false);
    };
    load();
  }, []);

  const actionTypes = useMemo(() => [...new Set(logs.map((l) => l.action))], [logs]);
  const filtered = useMemo(
    () => (actionFilter === "all" ? logs : logs.filter((l) => l.action === actionFilter)),
    [logs, actionFilter],
  );

  return (
    <AdminShell wide>
      <AdminHeader title="運営操作履歴" />

      <AdminCard>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
        >
          <option value="all">すべての操作</option>
          {actionTypes.map((a) => (
            <option key={a} value={a}>
              {formatActionLabel(a)}
            </option>
          ))}
        </select>
      </AdminCard>

      <AdminCard title={`履歴（${filtered.length}件・閲覧専用）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">履歴がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-1.5 pr-2 font-normal">操作日時</th>
                  <th className="py-1.5 pr-2 font-normal">操作内容</th>
                  <th className="py-1.5 pr-2 font-normal">操作対象</th>
                  <th className="py-1.5 pr-2 font-normal">理由</th>
                  <th className="py-1.5 pl-2 font-normal">操作者</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-b border-gray-100 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-gray-600">
                      {new Date(l.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                    </td>
                    <td className="py-1.5 pr-2 font-bold text-gray-900">{formatActionLabel(l.action)}</td>
                    <td className="py-1.5 pr-2 text-gray-600">
                      {formatTargetTypeLabel(l.target_type)}
                      {l.target_id ? `（${l.target_id.slice(0, 8)}）` : ""}
                    </td>
                    <td className="py-1.5 pr-2 text-gray-600">{l.reason ?? "-"}</td>
                    <td className="py-1.5 pl-2 text-gray-600">
                      {l.actor_id ? (names[l.actor_id] ?? l.actor_id.slice(0, 8)) : "（不明）"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </AdminShell>
  );
}
