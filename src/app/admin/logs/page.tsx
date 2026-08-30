"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

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

// 運営操作履歴の一覧画面（運営者専用管理画面・第3段階）。第1段階から記録している
// admin_action_logsを一覧表示する。操作種別での簡易フィルタのみのシンプルな構成。
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
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">運営操作履歴</h1>

      <select
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
        className="rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-xs"
      >
        <option value="all">すべての操作</option>
        {actionTypes.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((l) => (
            <li key={l.id} className="rounded-lg border border-dojo-dark-brown/15 p-2 text-left font-sans text-[11px] text-dojo-dark-brown">
              <p>
                {new Date(l.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                <span className="font-bold text-dojo-ink">{l.action}</span>
                　操作者：{l.actor_id ? (names[l.actor_id] ?? l.actor_id.slice(0, 8)) : "（不明）"}
              </p>
              {l.target_type && (
                <p>
                  対象：{l.target_type}
                  {l.target_id ? `（${l.target_id.slice(0, 8)}）` : ""}
                </p>
              )}
              {l.reason && <p>理由：{l.reason}</p>}
            </li>
          ))}
          {filtered.length === 0 && <p className="font-sans text-sm text-dojo-dark-brown">履歴がありません。</p>}
        </ul>
      )}
    </div>
  );
}
