"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

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

// 投稿・回答管理画面（運営者専用管理画面・第3段階）。sns_topics/sns_answers/
// sns_commentsを横断的に一覧し、非表示/解除・完全削除を行う。通常はすぐ完全削除
// せず「非表示」を基本にする（要件どおり）。非表示にした内容も一覧に表示し続ける
// （is_hiddenの値に関わらずここでは全件取得する）。
export default function AdminPostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [reportedTargetIds, setReportedTargetIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<PostKind | "all">("all");

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
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filtered = useMemo(
    () => (filterKind === "all" ? rows : rows.filter((r) => r.kind === filterKind)),
    [rows, filterKind],
  );

  const tableName = (kind: PostKind) =>
    kind === "sns_topic" ? "sns_topics" : kind === "sns_answer" ? "sns_answers" : "sns_comments";

  const handleToggleHidden = async (row: PostRow) => {
    let reason: string | null = null;
    if (!row.is_hidden) {
      reason = window.prompt("非表示にする理由を入力してください（省略可）", "") ?? "";
    }
    const { error } = await supabase
      .from(tableName(row.kind))
      .update({
        is_hidden: !row.is_hidden,
        hidden_reason: row.is_hidden ? null : reason || null,
        hidden_at: row.is_hidden ? null : new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await logAdminAction({
      action: row.is_hidden ? "post_unhidden" : "post_hidden",
      targetType: row.kind,
      targetId: row.id,
      reason: reason ?? undefined,
    });
    await load();
  };

  const handleDelete = async (row: PostRow) => {
    const confirmed = window.confirm(
      "この投稿を完全に削除しますか？通常は「非表示」を推奨します。この操作は取り消せません。",
    );
    if (!confirmed) return;
    const { error } = await supabase.from(tableName(row.kind)).delete().eq("id", row.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await logAdminAction({ action: "post_deleted", targetType: row.kind, targetId: row.id });
    await load();
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">投稿・回答管理</h1>

      <div className="flex gap-1.5">
        {(["all", "sns_topic", "sns_answer", "sns_comment"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilterKind(k)}
            className={`rounded-full border px-2.5 py-1 font-sans text-[11px] font-bold ${
              filterKind === k
                ? "border-dojo-curtain-red bg-dojo-curtain-red text-dojo-washi-white"
                : "border-dojo-dark-brown/30 text-dojo-dark-brown"
            }`}
          >
            {k === "all" ? "すべて" : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left">
              <div className="flex items-center gap-2 font-sans text-[10px] text-dojo-dark-brown">
                <span className="rounded bg-dojo-dark-brown/10 px-1.5 py-0.5">{KIND_LABEL[row.kind]}</span>
                {row.is_hidden && <span className="rounded bg-dojo-deep-crimson/15 px-1.5 py-0.5 text-dojo-deep-crimson">非表示中</span>}
                {reportedTargetIds.has(row.id) && (
                  <span className="rounded bg-dojo-curtain-gold/25 px-1.5 py-0.5">通報あり</span>
                )}
                <span>{new Date(row.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
              </div>
              <p className={`mt-1 font-sans text-sm ${row.is_hidden ? "text-dojo-dark-brown/50 line-through" : "text-dojo-ink"}`}>
                {row.body}
              </p>
              {row.hidden_reason && (
                <p className="mt-0.5 font-sans text-[11px] text-dojo-dark-brown">非表示理由：{row.hidden_reason}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleHidden(row)}
                  className="rounded border border-dojo-dark-brown/30 px-2 py-0.5 font-sans text-[11px]"
                >
                  {row.is_hidden ? "非表示を解除する" : "非表示にする"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(row)}
                  className="rounded border border-dojo-deep-crimson/40 px-2 py-0.5 font-sans text-[11px] text-dojo-deep-crimson"
                >
                  完全削除
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && <p className="font-sans text-sm text-dojo-dark-brown">投稿がありません。</p>}
        </ul>
      )}
    </div>
  );
}
