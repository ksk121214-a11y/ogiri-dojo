"use client";

import { useEffect, useMemo, useState } from "react";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { logAdminAction } from "@/lib/adminActionLog";
import type { TopicBankRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "used" | "inactive";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "すべて",
  active: "使用可能",
  used: "使用済み",
  inactive: "使用停止中",
};

// お題管理画面（運営者専用管理画面）。topic_bankテーブルに対する一覧・検索・
// 追加・編集・使用停止・削除を行う。「過去に使用したか」はtopics.topic_bank_idに
// この行を参照している行があるかどうかで判定する（既存ロジックのまま）。
// 2026-08-30（デザイン整理）：状態フィルタ・20件ずつのページネーションを追加し、
// 共通のAdmin*コンポーネントに置き換えた。管理操作のロジック自体は変更していない。
export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<TopicBankRow[]>([]);
  const [usedIds, setUsedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [newBody, setNewBody] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const load = async () => {
    setLoading(true);
    const [{ data: bankData, error: bankError }, { data: usedData }] = await Promise.all([
      supabase.from("topic_bank").select("*").order("created_at", { ascending: false }),
      supabase.from("topics").select("topic_bank_id").not("topic_bank_id", "is", null),
    ]);
    if (bankError) {
      notifyError(bankError.message);
    } else {
      setTopics((bankData ?? []) as TopicBankRow[]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusOf = (t: TopicBankRow): Exclude<StatusFilter, "all"> => {
    if (!t.is_active) return "inactive";
    if (usedIds.has(t.id)) return "used";
    return "active";
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    return topics.filter((t) => {
      if (kw && !t.body.includes(kw)) return false;
      if (statusFilter !== "all" && statusOf(t) !== statusFilter) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, keyword, statusFilter, usedIds]);

  // キーワード・状態フィルタが変わったら20件ずつの表示件数をリセットする。
  // effectでの非同期リセットではなく、Reactが推奨するレンダー中の比較パターンを使う
  // （https://react.dev/learn/you-might-not-need-an-effect の「keyで一部stateをリセットする」に準拠）。
  const [filterKey, setFilterKey] = useState(`${keyword}|${statusFilter}`);
  const nextFilterKey = `${keyword}|${statusFilter}`;
  if (filterKey !== nextFilterKey) {
    setFilterKey(nextFilterKey);
    setVisibleCount(PAGE_SIZE);
  }

  const visible = filtered.slice(0, visibleCount);

  const handleAdd = async () => {
    const body = newBody.trim();
    if (!body) return;
    const { error: insertError } = await supabase.from("topic_bank").insert({ body });
    if (insertError) {
      notifyError(insertError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_added", targetType: "topic_bank", detail: { body } });
    setNewBody("");
    notifySuccess("お題を追加しました。");
    await load();
  };

  const handleSaveEdit = async (id: string) => {
    const body = editing[id]?.trim();
    if (!body) return;
    const { error: updateError } = await supabase.from("topic_bank").update({ body }).eq("id", id);
    if (updateError) {
      notifyError(updateError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_edited", targetType: "topic_bank", targetId: id });
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    notifySuccess("保存しました。");
    await load();
  };

  const handleToggleActive = async (topic: TopicBankRow) => {
    const { error: updateError } = await supabase
      .from("topic_bank")
      .update({ is_active: !topic.is_active })
      .eq("id", topic.id);
    if (updateError) {
      notifyError(updateError.message);
      return;
    }
    await logAdminAction({
      action: topic.is_active ? "topic_bank_deactivated" : "topic_bank_activated",
      targetType: "topic_bank",
      targetId: topic.id,
    });
    notifySuccess(topic.is_active ? "使用停止にしました。" : "使用再開しました。");
    await load();
  };

  const handleDelete = async (topic: TopicBankRow) => {
    const confirmed = window.confirm(`「${topic.body}」を完全に削除しますか？この操作は取り消せません。`);
    if (!confirmed) return;
    const { error: deleteError } = await supabase.from("topic_bank").delete().eq("id", topic.id);
    if (deleteError) {
      notifyError(deleteError.message);
      return;
    }
    await logAdminAction({ action: "topic_bank_deleted", targetType: "topic_bank", targetId: topic.id });
    notifySuccess("削除しました。");
    await load();
  };

  return (
    <AdminShell wide>
      <AdminHeader title="お題管理" />
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
          <div className="flex gap-1.5">
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                  statusFilter === s
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                {STATUS_FILTER_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="新しいお題を入力"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <AdminButton variant="primary" onClick={handleAdd}>
            追加
          </AdminButton>
        </div>
      </AdminCard>

      <AdminCard title={`お題一覧（${filtered.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {visible.map((t) => {
                const status = statusOf(t);
                return (
                  <li key={t.id} className="rounded border border-gray-200 p-2.5">
                    {editing[t.id] !== undefined ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editing[t.id]}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <AdminButton variant="primary" onClick={() => handleSaveEdit(t.id)}>
                          保存
                        </AdminButton>
                      </div>
                    ) : (
                      <p className={`text-sm ${status === "inactive" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                        {t.body}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span
                        className={`rounded px-1.5 py-0.5 font-bold ${
                          status === "inactive"
                            ? "bg-gray-200 text-gray-600"
                            : status === "used"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-green-100 text-green-800"
                        }`}
                      >
                        {STATUS_FILTER_LABEL[status]}
                      </span>
                      <AdminButton
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
                      >
                        {editing[t.id] !== undefined ? "キャンセル" : "編集"}
                      </AdminButton>
                      <AdminButton onClick={() => handleToggleActive(t)}>
                        {t.is_active ? "使用停止にする" : "使用再開する"}
                      </AdminButton>
                      <AdminButton variant="danger" onClick={() => handleDelete(t)}>
                        削除
                      </AdminButton>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && <p className="text-sm text-gray-500">該当するお題がありません。</p>}
            </ul>
            {visibleCount < filtered.length && (
              <AdminButton onClick={() => setVisibleCount((v) => v + PAGE_SIZE)} className="mt-3">
                もっと見る（残り{filtered.length - visibleCount}件）
              </AdminButton>
            )}
          </>
        )}
      </AdminCard>
    </AdminShell>
  );
}
