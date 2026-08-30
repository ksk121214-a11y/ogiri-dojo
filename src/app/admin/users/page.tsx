"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminShell from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

interface ProfileRow {
  id: string;
  display_name: string;
  created_at: string;
  role: string;
  is_permanently_suspended: boolean;
  suspended_until: string | null;
}

function statusLabel(p: ProfileRow): string {
  if (p.is_permanently_suspended) return "永久停止";
  if (p.suspended_until && new Date(p.suspended_until).getTime() > Date.now()) return "利用停止中";
  return "問題なし";
}

function countBy(rows: { key: string | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.key) continue;
    map.set(row.key, (map.get(row.key) ?? 0) + 1);
  }
  return map;
}

// ユーザー管理画面（運営者専用管理画面）。一覧から検索して詳細
// （/admin/users/[id]）へ進み、警告・利用停止等はそちらで行う。
// 2026-08-30（デザイン整理）：一覧に「通報された件数」「警告件数」を追加し、
// 表形式でコンパクトに表示するようにした。警告等の操作ボタンは引き続き
// 詳細ページのみに置く（一覧には出さない）。
export default function AdminUsersPage() {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [reportedCounts, setReportedCounts] = useState<Map<string, number>>(new Map());
  const [warningCounts, setWarningCounts] = useState<Map<string, number>>(new Map());
  const [kickedCounts, setKickedCounts] = useState<Map<string, number>>(new Map());
  // 未確認（acknowledged_at未設定）の退場記録があるユーザーID集合。
  // 名前の横に赤い印を出し、詳細を開く(=確認する)と消える（/admin/users/[id]参照）。
  const [unacknowledgedKickedUserIds, setUnacknowledgedKickedUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const load = async () => {
      const [{ data: profiles }, { data: reportRows }, { data: warnRows }, { data: kickRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, created_at, role, is_permanently_suspended, suspended_until")
          .order("created_at", { ascending: false }),
        supabase.from("reports").select("target_author_id").not("target_author_id", "is", null),
        supabase.from("user_sanctions").select("user_id").eq("type", "warning"),
        supabase.from("user_sanctions").select("user_id, acknowledged_at").eq("type", "kicked"),
      ]);
      setUsers((profiles ?? []) as ProfileRow[]);
      setReportedCounts(
        countBy(((reportRows ?? []) as { target_author_id: string }[]).map((r) => ({ key: r.target_author_id }))),
      );
      setWarningCounts(
        countBy(((warnRows ?? []) as { user_id: string }[]).map((r) => ({ key: r.user_id }))),
      );
      const kickRowsTyped = (kickRows ?? []) as { user_id: string; acknowledged_at: string | null }[];
      setKickedCounts(countBy(kickRowsTyped.map((r) => ({ key: r.user_id }))));
      setUnacknowledgedKickedUserIds(
        new Set(kickRowsTyped.filter((r) => !r.acknowledged_at).map((r) => r.user_id)),
      );
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return users;
    return users.filter((u) => u.display_name.includes(kw));
  }, [users, keyword]);

  return (
    <AdminShell wide>
      <AdminHeader title="ユーザー管理" />

      <AdminCard>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="プレイヤー名で検索"
          className="w-full max-w-xs rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </AdminCard>

      <AdminCard title={`ユーザー一覧（${filtered.length}人）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">該当するユーザーがいません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-1.5 pr-2 font-normal">プレイヤー名</th>
                  <th className="py-1.5 pr-2 font-normal">利用状態</th>
                  <th className="py-1.5 pr-2 font-normal">通報された件数</th>
                  <th className="py-1.5 pr-2 font-normal">警告件数</th>
                  <th className="py-1.5 pr-2 font-normal">ライブからの退場</th>
                  <th className="py-1.5 pl-2 font-normal">詳細</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100">
                    <td className="py-2 pr-2 font-bold text-gray-900">
                      {unacknowledgedKickedUserIds.has(u.id) && (
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600"
                          title="要確認：ライブから退場させられました"
                          aria-label="要確認"
                        />
                      )}
                      {u.display_name}
                      {u.role === "admin" && (
                        <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-bold text-blue-700">
                          運営
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-gray-700">{statusLabel(u)}</td>
                    <td className="py-2 pr-2 text-gray-700">{reportedCounts.get(u.id) ?? 0}件</td>
                    <td className="py-2 pr-2 text-gray-700">{warningCounts.get(u.id) ?? 0}件</td>
                    <td className="py-2 pr-2 text-gray-700">{kickedCounts.get(u.id) ?? 0}回</td>
                    <td className="py-2 pl-2">
                      <Link href={`/admin/users/${u.id}`}>
                        <AdminButton>詳細確認</AdminButton>
                      </Link>
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
