"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { logAdminAction } from "@/lib/adminActionLog";
import { supabase } from "@/lib/supabase";
import { useTickingNow } from "@/lib/useTickingNow";
import { useAuthStore } from "@/store/useAuthStore";

interface ProfileDetail {
  id: string;
  display_name: string;
  created_at: string;
  is_permanently_suspended: boolean;
  suspended_until: string | null;
  admin_memo: string | null;
}
interface SanctionRow {
  id: string;
  type: string;
  reason: string;
  detail: string | null;
  target_ref: string | null;
  created_at: string;
}
interface ReportedRow {
  id: string;
  target_type: string;
  reason: string;
  status: string;
  created_at: string;
}
interface ParticipationRow {
  id: string;
  live_id: string;
  role: string;
  joined_at: string;
}

const SANCTION_TYPE_LABEL: Record<string, string> = {
  warning: "警告",
  suspend_temporary: "期限付き利用停止",
  suspend_permanent: "永久停止",
  lift: "停止解除",
  delete: "アカウント削除",
};

// ユーザー詳細・対応画面（運営者専用管理画面・第3段階）。
// 「問題なし→投稿を非表示→警告→期限付き利用停止→永久停止→（必要な場合のみ）完全削除」
// の順に進められるよう、強い操作ほど下・目立たない位置に置く。
export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = params.id;
  const now = useTickingNow(60_000); // 分単位の期限判定にしか使わないため長めの間隔にする

  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [answerCount, setAnswerCount] = useState(0);
  const [sanctions, setSanctions] = useState<SanctionRow[]>([]);
  const [reported, setReported] = useState<ReportedRow[]>([]);
  const [participations, setParticipations] = useState<ParticipationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [memoDraft, setMemoDraft] = useState("");

  const load = async () => {
    setLoading(true);
    const [
      { data: profileData },
      { count: topicsCount },
      { count: answersCount },
      { data: sanctionData },
      { data: reportData },
      { data: participationData },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, created_at, is_permanently_suspended, suspended_until, admin_memo")
        .eq("id", userId)
        .single(),
      supabase.from("sns_topics").select("id", { count: "exact", head: true }).eq("author_id", userId),
      supabase.from("sns_answers").select("id", { count: "exact", head: true }).eq("author_id", userId),
      supabase.from("user_sanctions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase
        .from("reports")
        .select("id, target_type, reason, status, created_at")
        .eq("target_author_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("participants").select("*").eq("user_id", userId).order("joined_at", { ascending: false }),
    ]);
    setProfile(profileData as ProfileDetail | null);
    setPostCount(topicsCount ?? 0);
    setAnswerCount(answersCount ?? 0);
    setSanctions((sanctionData ?? []) as SanctionRow[]);
    setReported((reportData ?? []) as ReportedRow[]);
    setParticipations((participationData ?? []) as ParticipationRow[]);
    setMemoDraft((profileData as ProfileDetail | null)?.admin_memo ?? "");
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const recordSanction = async (type: string, reason: string, detail: string | null, targetRef: string | null) => {
    const actorId = useAuthStore.getState().user?.id ?? null;
    await supabase.from("user_sanctions").insert({
      user_id: userId,
      type,
      reason,
      detail,
      target_ref: targetRef,
      created_by: actorId,
    });
    await logAdminAction({
      action: `user_${type}`,
      targetType: "profiles",
      targetId: userId,
      reason,
      detail: { detail, targetRef },
    });
  };

  const handleSaveMemo = async () => {
    await supabase.from("profiles").update({ admin_memo: memoDraft }).eq("id", userId);
    await load();
  };

  const handleWarning = async () => {
    const targetRef = window.prompt("対象となった投稿や行為を入力してください", "") ?? "";
    const reason = window.prompt("警告理由を入力してください", "") ?? "";
    if (!reason) return;
    const body = window.prompt("警告本文（本人への通知に表示されます）を入力してください", "") ?? "";
    const responseNote = window.prompt("今回行った対応を入力してください（省略可）", "") ?? "";
    await recordSanction("warning", reason, `${body}\n\n対応：${responseNote}`, targetRef);
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "warning",
      title: "運営からの警告",
      body: body || reason,
    });
    await load();
  };

  const handleSuspendTemporary = async () => {
    const daysInput = window.prompt("何日間利用停止しますか？（日数を入力）", "7");
    if (!daysInput) return;
    const days = Number(daysInput);
    if (!Number.isFinite(days) || days <= 0) return;
    const reason = window.prompt("利用停止理由を入力してください", "") ?? "";
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("profiles").update({ suspended_until: until }).eq("id", userId);
    await recordSanction("suspend_temporary", reason, `${days}日間`, null);
    await load();
  };

  const handleSuspendPermanent = async () => {
    const confirmed = window.confirm("永久停止しますか？");
    if (!confirmed) return;
    const reason = window.prompt("永久停止理由を入力してください", "") ?? "";
    await supabase.from("profiles").update({ is_permanently_suspended: true }).eq("id", userId);
    await recordSanction("suspend_permanent", reason, null, null);
    await load();
  };

  const handleLift = async () => {
    await supabase
      .from("profiles")
      .update({ is_permanently_suspended: false, suspended_until: null })
      .eq("id", userId);
    await recordSanction("lift", "利用停止の解除", null, null);
    await load();
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "アカウントを完全に削除しますか？この操作は取り消せません。投稿等の関連データも失われます。",
    );
    if (!confirmed) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`/api/admin/users/${userId}/delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(`削除に失敗しました：${body.error ?? res.statusText}`);
      return;
    }
    await logAdminAction({ action: "user_deleted", targetType: "profiles", targetId: userId });
    router.push("/admin/users");
  };

  if (loading) return <p className="p-8 text-center font-sans text-sm text-dojo-dark-brown">読み込み中…</p>;
  if (!profile) return <p className="p-8 text-center font-sans text-sm text-dojo-dark-brown">ユーザーが見つかりません。</p>;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <Link href="/admin/users" className="font-sans text-xs text-dojo-dark-brown underline">
        ← ユーザー一覧へ戻る
      </Link>
      <h1 className="font-brush text-2xl text-dojo-curtain-red">{profile.display_name}</h1>
      <p className="font-sans text-xs text-dojo-dark-brown">
        登録日時：{new Date(profile.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
      </p>
      <p className="font-sans text-xs text-dojo-dark-brown">
        現在の利用状態：
        {profile.is_permanently_suspended
          ? "永久停止"
          : profile.suspended_until && new Date(profile.suspended_until).getTime() > now
            ? `利用停止中（${new Date(profile.suspended_until).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}まで）`
            : "問題なし"}
      </p>

      <div className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left font-sans text-xs text-dojo-dark-brown">
        <p>投稿履歴：お題{postCount}件・回答{answerCount}件</p>
        <p className="mt-1">ライブ参加履歴：{participations.length}件</p>
        <ul className="mt-1 max-h-24 overflow-y-auto">
          {participations.map((p) => (
            <li key={p.id}>
              {new Date(p.joined_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}（{p.role === "player" ? "プレイヤー" : "観客"}）
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left font-sans text-xs text-dojo-dark-brown">
        <p className="font-bold text-dojo-ink">通報された履歴（{reported.length}件）</p>
        <ul className="mt-1 max-h-32 overflow-y-auto">
          {reported.map((r) => (
            <li key={r.id}>
              {new Date(r.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}：{r.reason}（{r.status}）
            </li>
          ))}
          {reported.length === 0 && <li>通報はありません。</li>}
        </ul>
      </div>

      <div className="rounded-xl border border-dojo-dark-brown/20 p-3 text-left font-sans text-xs text-dojo-dark-brown">
        <p className="font-bold text-dojo-ink">警告・対応履歴（{sanctions.length}件）</p>
        <ul className="mt-1 max-h-32 overflow-y-auto">
          {sanctions.map((s) => (
            <li key={s.id} className="border-b border-dojo-dark-brown/10 py-1 last:border-0">
              {new Date(s.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}：
              {SANCTION_TYPE_LABEL[s.type] ?? s.type} - {s.reason}
            </li>
          ))}
          {sanctions.length === 0 && <li>対応履歴はありません。</li>}
        </ul>
      </div>

      <div className="rounded-xl border border-dojo-dark-brown/20 p-3">
        <p className="font-sans text-xs font-bold text-dojo-ink">運営メモ</p>
        <textarea
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-xs"
        />
        <button
          type="button"
          onClick={handleSaveMemo}
          className="mt-1 rounded border border-dojo-dark-brown/30 px-2 py-1 font-sans text-[11px]"
        >
          保存
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleWarning}
          className="rounded-full border border-dojo-dark-brown/30 px-4 py-2 font-sans text-xs font-bold text-dojo-dark-brown"
        >
          警告を送る
        </button>
        <button
          type="button"
          onClick={handleSuspendTemporary}
          className="rounded-full border border-dojo-curtain-gold/60 px-4 py-2 font-sans text-xs font-bold text-dojo-dark-brown"
        >
          期限付きで利用停止する
        </button>
        <button
          type="button"
          onClick={handleSuspendPermanent}
          className="rounded-full border border-dojo-deep-crimson/60 px-4 py-2 font-sans text-xs font-bold text-dojo-deep-crimson"
        >
          永久停止する
        </button>
        {(profile.is_permanently_suspended || profile.suspended_until) && (
          <button
            type="button"
            onClick={handleLift}
            className="rounded-full bg-dojo-curtain-red px-4 py-2 font-sans text-xs font-bold text-dojo-washi-white"
          >
            停止を解除する
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-full border border-dojo-deep-crimson px-4 py-2 font-sans text-xs font-bold text-dojo-deep-crimson opacity-70"
        >
          アカウントを完全に削除する（最終手段）
        </button>
      </div>
    </div>
  );
}
