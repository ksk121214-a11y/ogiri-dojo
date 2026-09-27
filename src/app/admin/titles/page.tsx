"use client";

import { useEffect, useState } from "react";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import { isValidFirstLiveRewardRpcData } from "@/lib/firstLiveRewardResult";
import { supabase } from "@/lib/supabase";

// admin_update_title / admin_regrant_first_live_reward（0081）が投げるエラーコードを
// 日本語文言に変換する。生のPostgreSQL/Supabaseのエラー文言は画面に出さない。
function mapAdminTitleError(message: string | undefined): string {
  if (!message) return "操作に失敗しました";
  if (message.includes("not authorized")) return "権限がありません";
  if (message.includes("TITLE_NOT_FOUND")) return "称号が見つかりませんでした";
  if (message.includes("INVALID_DISPLAY_NAME")) return "表示名を入力してください";
  if (message.includes("NO_PRESENCE_RECORD")) return "この利用者は最終結果画面への到達記録が無いため、付与できません（参加登録だけでは付与できません）";
  if (message.includes("PARTICIPANT_KICKED")) return "退場済みの利用者のため付与できません";
  return "操作に失敗しました。時間をおいて再度お試しください";
}

interface TitleRow {
  slug: string;
  display_name: string;
  description: string | null;
  kind: "normal" | "limited";
  sort_order: number;
  is_active: boolean;
  auto_equip: boolean;
  transferable: boolean;
}

interface PresenceRow {
  user_id: string;
  display_name: string;
  role: string;
  seen_at: string;
  has_title: boolean;
  has_icon: boolean;
}

const ROLE_LABEL: Record<string, string> = { player: "プレイヤー", audience: "観客" };

// 称号管理画面（運営者専用）。
// 2026-09-27：称号（通常5種＋初回ライブ限定「最初の目撃者」）の表示名・説明文・
// 並び順・公開状態の編集と所有者数の確認、初回ライブ#0001の最終結果到達記録・
// 称号/アイコンの付与状況の確認、未付与者への再付与を行う（supabase/migrations/0081）。
// 内部ID(slug)は編集不可。物理削除は行わず、is_activeで非表示にするのみ。
export default function AdminTitlesPage() {
  const [titles, setTitles] = useState<TitleRow[] | null>(null);
  const [ownerCounts, setOwnerCounts] = useState<Record<string, number>>({});
  const [normalMemberCount, setNormalMemberCount] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { displayName: string; description: string; sortOrder: number; isActive: boolean }>>({});
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  const [firstLiveId, setFirstLiveId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceRow[] | null>(null);
  const [regrantingUserId, setRegrantingUserId] = useState<string | null>(null);

  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const loadTitles = async () => {
    const { data, error } = await supabase.from("titles").select("*").order("sort_order");
    if (error) {
      notifyError(error.message);
      return;
    }
    const list = (data ?? []) as TitleRow[];
    setTitles(list);
    const draftMap: typeof drafts = {};
    for (const t of list) {
      draftMap[t.slug] = {
        displayName: t.display_name,
        description: t.description ?? "",
        sortOrder: t.sort_order,
        isActive: t.is_active,
      };
    }
    setDrafts(draftMap);

    // 所有者数：限定称号はuser_titlesの件数、通常称号は実際にXログインしている
    // 通常会員の総数（全員が所有扱いのため所有行を持たない、§13番）。
    // 2026-09-27（レビュー対応）：単純な「is_guest=false」件数だとメール+パスワードの
    // ボットアカウントも含まれてしまうため、一般クライアントからauth.users/
    // auth.identitiesを直接読ませない運営専用RPC(admin_count_x_login_members)を使う。
    const limitedSlugs = list.filter((t) => t.kind === "limited").map((t) => t.slug);
    const counts: Record<string, number> = {};
    if (limitedSlugs.length > 0) {
      const { data: ownedRows } = await supabase.from("user_titles").select("title_slug").in("title_slug", limitedSlugs);
      for (const slug of limitedSlugs) counts[slug] = 0;
      for (const row of (ownedRows ?? []) as { title_slug: string }[]) {
        counts[row.title_slug] = (counts[row.title_slug] ?? 0) + 1;
      }
    }
    setOwnerCounts(counts);

    const { data: xLoginCount } = await supabase.rpc("admin_count_x_login_members");
    setNormalMemberCount(typeof xLoginCount === "number" ? xLoginCount : null);
  };

  const loadPresence = async () => {
    const { data: liveRow } = await supabase
      .from("lives")
      .select("id")
      .eq("live_mode", "official")
      .eq("official_sequence_number", 1)
      .maybeSingle();
    const liveId = liveRow?.id ?? null;
    setFirstLiveId(liveId);
    if (!liveId) {
      setPresence([]);
      return;
    }
    const { data, error } = await supabase.rpc("admin_list_final_result_presence", { p_live_id: liveId });
    if (error) {
      notifyError(mapAdminTitleError(error.message));
      return;
    }
    setPresence((data ?? []) as PresenceRow[]);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTitles();
    loadPresence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (slug: string) => {
    const draft = drafts[slug];
    if (!draft) return;
    if (!draft.displayName.trim()) {
      notifyError("表示名を入力してください");
      return;
    }
    setSavingSlug(slug);
    const { error } = await supabase.rpc("admin_update_title", {
      p_slug: slug,
      p_display_name: draft.displayName.trim(),
      p_description: draft.description.trim() || null,
      p_sort_order: draft.sortOrder,
      p_is_active: draft.isActive,
    });
    setSavingSlug(null);
    if (error) {
      notifyError(mapAdminTitleError(error.message));
      return;
    }
    notifySuccess("称号を更新しました。");
    await loadTitles();
  };

  const handleRegrant = async (userId: string) => {
    if (!firstLiveId || regrantingUserId) return;
    setRegrantingUserId(userId);
    const { data, error } = await supabase.rpc("admin_regrant_first_live_reward", {
      p_user_id: userId,
      p_live_id: firstLiveId,
    });
    setRegrantingUserId(null);
    if (error) {
      notifyError(mapAdminTitleError(error.message));
      return;
    }
    // 2026-09-28（レビュー対応）：error=nullでもdataがnull・不正な形式の場合は
    // 「既に付与済み」と誤表示せず、操作失敗として扱う（再試行を促す）。
    if (!isValidFirstLiveRewardRpcData(data)) {
      notifyError("操作に失敗しました。時間をおいて再度お試しください");
      return;
    }
    notifySuccess(data.newly_granted ? "限定称号・限定アイコンを付与しました。" : "既に付与済みでした（変更なし）。");
    await loadPresence();
  };

  return (
    <AdminShell wide>
      <AdminHeader title="称号管理" />
      <AdminNotice notice={notice} onClose={clear} />

      <AdminCard title={`称号一覧（${titles?.length ?? 0}件）`}>
        {titles === null ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {titles.map((t) => {
              const draft = drafts[t.slug] ?? {
                displayName: t.display_name,
                description: t.description ?? "",
                sortOrder: t.sort_order,
                isActive: t.is_active,
              };
              const count = t.kind === "limited" ? (ownerCounts[t.slug] ?? 0) : (normalMemberCount ?? "…");
              return (
                <li key={t.slug} className="rounded border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono">{t.slug}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-bold ${
                        t.kind === "limited" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t.kind === "limited" ? "限定" : "通常"}
                    </span>
                    <span>所有者数：{count}{typeof count === "number" ? "人" : ""}</span>
                    {!draft.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700">非表示</span>}
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto_auto]">
                    <input
                      type="text"
                      value={draft.displayName}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [t.slug]: { ...draft, displayName: e.target.value } }))}
                      placeholder="表示名"
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      value={draft.description}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [t.slug]: { ...draft, description: e.target.value } }))}
                      placeholder="説明文（省略可）"
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={draft.sortOrder}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [t.slug]: { ...draft, sortOrder: Number(e.target.value) } }))
                      }
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [t.slug]: { ...draft, isActive: e.target.checked } }))}
                      />
                      公開
                    </label>
                  </div>

                  <div className="mt-2 flex justify-end">
                    <AdminButton variant="primary" disabled={savingSlug === t.slug} onClick={() => handleSave(t.slug)}>
                      {savingSlug === t.slug ? "保存中…" : "保存"}
                    </AdminButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdminCard>

      <AdminCard title="初回ライブ「#0001」限定特典の付与状況">
        {!firstLiveId ? (
          <p className="text-sm text-gray-500">初回本番ライブ（official #1）がまだ登録されていません。</p>
        ) : presence === null ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : presence.length === 0 ? (
          <p className="text-sm text-gray-500">最終結果画面への到達記録はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {presence.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2.5 text-xs">
                <div className="text-gray-700">
                  <p className="font-bold text-gray-900">
                    {p.display_name}
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-600">
                      {ROLE_LABEL[p.role] ?? p.role}
                    </span>
                  </p>
                  <p className="mt-0.5 text-gray-500">
                    到達日時：{new Date(p.seen_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${p.has_title ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    称号{p.has_title ? "済" : "未"}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${p.has_icon ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    アイコン{p.has_icon ? "済" : "未"}
                  </span>
                  {(!p.has_title || !p.has_icon) && (
                    <AdminButton disabled={regrantingUserId === p.user_id} onClick={() => handleRegrant(p.user_id)}>
                      {regrantingUserId === p.user_id ? "処理中…" : "再付与"}
                    </AdminButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-gray-500">
          「再付与」は、最終結果画面への到達記録が既にある利用者にのみ実行できます。参加登録があるだけの利用者への一括付与はできません。
        </p>
      </AdminCard>
    </AdminShell>
  );
}
