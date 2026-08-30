"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { logAdminAction } from "@/lib/adminActionLog";
import type { TopicBankRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";

// お題管理画面（運営者専用管理画面・第1段階）。topic_bankテーブルに対する
// 一覧・検索・追加・編集・使用停止・削除を行う。「過去に使用したか」は
// topics.topic_bank_idにこの行を参照している行があるかどうかで判定する。
export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<TopicBankRow[]>([]);
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: bankData, error: bankError }, { data: usedData }] = await Promise.all([
      supabase.from("topic_bank").select("*").order("created_at", { ascending: false }),
      supabase.from("topics").select("topic_bank_id").not("topic_bank_id", "is", null),
    ]);
    if (bankError) {
      setError(bankError.message);
    } else {
      setTopics((bankData ?? []) as TopicBankRow[]);
      setError(null);
    }
    setUsedIds(
      new Set(((usedData ?? []) as { topic_bank_id: string }[]).map((r) => r.topic_bank_id)),
    );
    setLoading(false);
  };

  useEffect(() => {
    // マウント時に1回だけ一覧を取得する（外部システム=Supabaseとの同期）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return topics;
    return topics.filter((t) => t.body.includes(kw));
  }, [topics, keyword]);

  const handleAdd = async () => {
    const body = newBody.trim();
    if (!body) return;
    const { error: insertError } = await supabase.from("topic_bank").insert({ body });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_added", targetType: "topic_bank", detail: { body } });
    setNewBody("");
    await load();
  };

  const handleSaveEdit = async (id: string) => {
    const body = editing[id]?.trim();
    if (!body) return;
    const { error: updateError } = await supabase.from("topic_bank").update({ body }).eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_edited", targetType: "topic_bank", targetId: id });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await load();
  };

  const handleToggleActive = async (topic: TopicBankRow) => {
    const { error: updateError } = await supabase
      .from("topic_bank")
      .update({ is_active: !topic.is_active })
      .eq("id", topic.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await logAdminAction({
      action: topic.is_active ? "topic_bank_deactivated" : "topic_bank_activated",
      targetType: "topic_bank",
      targetId: topic.id,
    });
    await load();
  };

  const handleDelete = async (topic: TopicBankRow) => {
    const confirmed = window.confirm(`「${topic.body}」を完全に削除しますか？この操作は取り消せません。`);
    if (!confirmed) return;
    const { error: deleteError } = await supabase.from("topic_bank").delete().eq("id", topic.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_deleted", targetType: "topic_bank", targetId: topic.id });
    await load();
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin" className="font-sans text-xs text-dojo-dark-brown underline">
        ← 管理画面トップへ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">お題管理</h1>

      <div className="flex gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="キーワード検索"
          className="flex-1 rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
        />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="新しいお題を入力"
          className="flex-1 rounded border border-dojo-dark-brown/30 px-2 py-1.5 font-sans text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="shrink-0 rounded-full bg-dojo-curtain-red px-4 py-1.5 font-sans text-xs font-bold text-dojo-washi-white"
        >
          追加
        </button>
      </div>

      {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}

      {loading ? (
        <p className="font-sans text-sm text-dojo-dark-brown">読み込み中…</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((t) => (
            <li key={t.id} className="rounded-xl border border-dojo-dark-brown/20 p-3">
              {editing[t.id] !== undefined ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editing[t.id]}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    className="flex-1 rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(t.id)}
                    className="shrink-0 rounded bg-dojo-curtain-red px-2 py-1 font-sans text-xs font-bold text-dojo-washi-white"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <p className={`font-sans text-sm ${t.is_active ? "text-dojo-ink" : "text-dojo-dark-brown/50 line-through"}`}>
                  {t.body}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 font-sans text-[11px] text-dojo-dark-brown">
                {usedIds.has(t.id) && (
                  <span className="rounded bg-dojo-dark-brown/10 px-1.5 py-0.5">使用済み</span>
                )}
                {!t.is_active && (
                  <span className="rounded bg-dojo-dark-brown/10 px-1.5 py-0.5">使用停止中</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setEditing((prev) =>
                      prev[t.id] !== undefined
                        ? (() => {
                            const next = { ...prev };
                            delete next[t.id];
                            return next;
                          })()
                        : { ...prev, [t.id]: t.body },
                    )
                  }
                  className="rounded border border-dojo-dark-brown/30 px-2 py-0.5"
                >
                  {editing[t.id] !== undefined ? "キャンセル" : "編集"}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleActive(t)}
                  className="rounded border border-dojo-dark-brown/30 px-2 py-0.5"
                >
                  {t.is_active ? "使用停止にする" : "使用再開する"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t)}
                  className="rounded border border-dojo-deep-crimson/40 px-2 py-0.5 text-dojo-deep-crimson"
                >
                  削除
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="font-sans text-sm text-dojo-dark-brown">該当するお題がありません。</p>
          )}
        </ul>
      )}
    </div>
  );
}
