"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

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

// ユーザー管理画面（運営者専用管理画面・第3段階）。一覧から検索して詳細
// （/admin/users/[id]）へ進み、警告・利用停止等はそちらで行う。
export default function AdminUsersPage() {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, created_at, role, is_permanently_suspended, suspended_until")
        .order("created_at", { ascending: false });
      setUsers((data ?? []) as ProfileRow[]);
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
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">ユーザー管理</h1>

      <input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="プレイヤー名で検索"
        className="rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
      />

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((u) => (
            <li key={u.id}>
              <Link
                href={`/admin/users/${u.id}`}
                className="flex items-center justify-between gap-2 rounded-xl border border-dojo-dark-brown/20 p-3 hover:bg-dojo-light-brown"
              >
                <div className="min-w-0">
                  <p className="truncate font-sans text-sm font-bold text-dojo-ink">
                    {u.display_name}
                    {u.role === "admin" && (
                      <span className="ml-1.5 rounded bg-dojo-curtain-gold/25 px-1 py-0.5 text-[10px]">運営</span>
                    )}
                  </p>
                  <p className="font-sans text-[11px] text-dojo-dark-brown">
                    登録：{new Date(u.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-dojo-dark-brown/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-dojo-dark-brown">
                  {statusLabel(u)}
                </span>
              </Link>
            </li>
          ))}
          {filtered.length === 0 && <p className="font-sans text-sm text-dojo-dark-brown">該当するユーザーがいません。</p>}
        </ul>
      )}
    </div>
  );
}
