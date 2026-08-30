"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

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

const TARGET_TYPE_LABEL: Record<string, string> = {
  sns_topic: "お題投稿",
  sns_answer: "回答",
  sns_comment: "コメント",
};

// 通報管理画面（運営者専用管理画面・第3段階）。通報数だけで自動非表示・自動削除は
// 行わず、運営者が内容を見て対応状態・運営メモを記録する（実際の非表示操作は
// /admin/postsで行う）。投稿者・通報者の表示名はここでは出さず、IDのみ表示する
// （profilesのSELECTは本人限定のため、必要ならsns_author_names等の解決を別途追加する）。
export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });
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
  }, []);

  const handleStatusChange = async (report: ReportRow, status: ReportRow["status"]) => {
    await supabase.from("reports").update({ status, updated_at: new Date().toISOString() }).eq("id", report.id);
    await load();
  };

  const handleSaveMemo = async (report: ReportRow) => {
    const memo = memoDrafts[report.id] ?? report.admin_memo ?? "";
    await supabase
      .from("reports")
      .update({ admin_memo: memo, updated_at: new Date().toISOString() })
      .eq("id", report.id);
    await load();
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">通報管理</h1>

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : reports.length === 0 ? (
        <p className="font-sans text-sm text-dojo-dark-brown">通報はまだありません。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="font-sans text-xs font-bold text-dojo-ink">
                  {TARGET_TYPE_LABEL[r.target_type] ?? r.target_type}への通報
                </span>
                <span className="rounded bg-dojo-dark-brown/10 px-1.5 py-0.5 font-sans text-[10px] font-bold text-dojo-dark-brown">
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <p className="mt-1 font-sans text-[11px] text-dojo-dark-brown">
                {new Date(r.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                　通報者：{names[r.reporter_id] ?? r.reporter_id.slice(0, 8)}
                　被通報者：{r.target_author_id ? (names[r.target_author_id] ?? r.target_author_id.slice(0, 8)) : "（不明）"}
              </p>
              <p className="mt-1 font-sans text-xs text-dojo-ink">理由：{r.reason}</p>
              {r.detail && <p className="mt-0.5 font-sans text-xs text-dojo-dark-brown">詳細：{r.detail}</p>}
              <div className="mt-2 rounded bg-dojo-dark-brown/5 p-2 font-sans text-xs text-dojo-dark-brown">
                通報時点の内容：「{r.snapshot_body}」
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABEL) as ReportRow["status"][]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStatusChange(r, s)}
                    className={`rounded-full border px-2 py-0.5 font-sans text-[10px] font-bold ${
                      r.status === s
                        ? "border-dojo-curtain-red bg-dojo-curtain-red text-dojo-washi-white"
                        : "border-dojo-dark-brown/30 text-dojo-dark-brown"
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
                  className="flex-1 rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleSaveMemo(r)}
                  className="shrink-0 rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-[11px]"
                >
                  保存
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
