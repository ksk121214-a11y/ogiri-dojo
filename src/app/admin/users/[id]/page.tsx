"use client";

import { useEffect, useState } from "react";

import { useParams, useRouter } from "next/navigation";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import AdminTemplateChips from "@/components/admin/AdminTemplateChips";
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

// よく使う警告理由・警告本文の定型文セット。クリックすると理由・本文の両方に
// セットされ、その後は自由に書き換えられる（定型文のまま送ることも、
// 対象に合わせて書き換えることもできる）。
const WARNING_TEMPLATES = [
  {
    label: "不適切な投稿",
    reason: "不適切な投稿内容",
    body: "投稿内容がガイドラインに違反しているため、警告いたします。今後同様の行為が確認された場合、利用停止となることがあります。",
  },
  {
    label: "誹謗中傷",
    reason: "他の利用者への誹謗中傷",
    body: "他の利用者に対する誹謗中傷が確認されたため、警告いたします。今後同様の行為が確認された場合、利用停止となることがあります。",
  },
  {
    label: "スパム行為",
    reason: "スパム行為（同一内容の連続投稿等）",
    body: "同一内容の連続投稿など、スパムと判断される行為が確認されたため、警告いたします。",
  },
  {
    label: "なりすまし",
    reason: "なりすまし行為",
    body: "他者になりすます行為が確認されたため、警告いたします。今後同様の行為が確認された場合、利用停止となることがあります。",
  },
] as const;

const SANCTION_TYPE_LABEL: Record<string, string> = {
  warning: "警告",
  suspend_temporary: "期限付き利用停止",
  suspend_permanent: "永久停止",
  lift: "停止解除",
  delete: "アカウント削除",
  kicked: "ライブからの退場",
};

// ユーザー詳細・対応画面（運営者専用管理画面）。
// 「問題なし→投稿を非表示→警告→期限付き利用停止→永久停止→（必要な場合のみ）完全削除」
// の順に進められるよう、強い操作ほど下・目立たない位置に置く。
// 2026-08-30（デザイン整理）：共通のAdmin*コンポーネントに置き換え、各操作の
// 成否を画面上部のAdminNoticeにまとめて表示するようにした。管理操作のロジック
// 自体（クエリ・更新内容・prompt/confirmでの入力）は変更していない。
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
  // 警告フォーム（定型文＋自由入力）。window.promptの連鎖では定型文を選べないため、
  // 「警告を送る」を押すとこのフォームを展開する形にした。
  const [warningFormOpen, setWarningFormOpen] = useState(false);
  const [warningTargetRef, setWarningTargetRef] = useState("");
  const [warningReason, setWarningReason] = useState("");
  const [warningBody, setWarningBody] = useState("");
  const [warningResponseNote, setWarningResponseNote] = useState("");
  // 事故防止：この画面の対応操作（警告〜削除）は同時に1つだけ実行できるようにする
  // （どの操作が進行中かをキーで持ち、実行中は該当ボタンを含め全て無効化する）。
  const [pendingAction, setPendingAction] = useState<
    "memo" | "warning" | "suspend_temporary" | "suspend_permanent" | "lift" | "delete" | null
  >(null);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

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
    if (pendingAction) return;
    setPendingAction("memo");
    try {
      const { error } = await supabase.from("profiles").update({ admin_memo: memoDraft }).eq("id", userId);
      if (error) {
        notifyError(error.message);
        return;
      }
      notifySuccess("運営メモを保存しました。");
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const handleWarning = async () => {
    if (pendingAction) return;
    const reason = warningReason.trim();
    if (!reason) {
      notifyError("警告理由を入力してください。");
      return;
    }
    const body = warningBody.trim();
    const responseNote = warningResponseNote.trim();
    setPendingAction("warning");
    try {
      await recordSanction("warning", reason, `${body}\n\n対応：${responseNote}`, warningTargetRef.trim() || null);
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "warning",
        title: "運営からの警告",
        body: body || reason,
      });
      notifySuccess("警告を送りました。");
      setWarningFormOpen(false);
      setWarningTargetRef("");
      setWarningReason("");
      setWarningBody("");
      setWarningResponseNote("");
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const handleSuspendTemporary = async () => {
    if (pendingAction) return;
    const daysInput = window.prompt("何日間利用停止しますか？（日数を入力）", "7");
    if (!daysInput) return;
    const days = Number(daysInput);
    if (!Number.isFinite(days) || days <= 0) return;
    const reason = window.prompt("利用停止理由を入力してください", "") ?? "";
    setPendingAction("suspend_temporary");
    try {
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("profiles").update({ suspended_until: until }).eq("id", userId);
      if (error) {
        notifyError(error.message);
        return;
      }
      await recordSanction("suspend_temporary", reason, `${days}日間`, null);
      notifySuccess(`${days}日間の利用停止にしました。`);
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const handleSuspendPermanent = async () => {
    if (pendingAction) return;
    const confirmed = window.confirm("永久停止しますか？");
    if (!confirmed) return;
    const reason = window.prompt("永久停止理由を入力してください", "") ?? "";
    setPendingAction("suspend_permanent");
    try {
      const { error } = await supabase.from("profiles").update({ is_permanently_suspended: true }).eq("id", userId);
      if (error) {
        notifyError(error.message);
        return;
      }
      await recordSanction("suspend_permanent", reason, null, null);
      notifySuccess("永久停止にしました。");
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const handleLift = async () => {
    if (pendingAction) return;
    setPendingAction("lift");
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_permanently_suspended: false, suspended_until: null })
        .eq("id", userId);
      if (error) {
        notifyError(error.message);
        return;
      }
      await recordSanction("lift", "利用停止の解除", null, null);
      notifySuccess("停止を解除しました。");
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    if (pendingAction) return;
    const confirmed = window.confirm(
      "アカウントを完全に削除しますか？この操作は取り消せません。投稿等の関連データも失われます。",
    );
    if (!confirmed) return;
    setPendingAction("delete");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        notifyError("ログイン状態を確認できませんでした。もう一度お試しください");
        return;
      }
      const res = await fetch(`/api/admin/users/${userId}/delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        notifyError(`削除に失敗しました：${body.error ?? res.statusText}`);
        return;
      }
      await logAdminAction({ action: "user_deleted", targetType: "profiles", targetId: userId });
      router.push("/admin/users");
    } finally {
      setPendingAction(null);
    }
  };

  if (loading) {
    return (
      <AdminShell>
        <p className="text-sm text-gray-500">読み込み中…</p>
      </AdminShell>
    );
  }
  if (!profile) {
    return (
      <AdminShell>
        <AdminHeader title="ユーザーが見つかりません" backHref="/admin/users" backLabel="ユーザー一覧へ戻る" />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <AdminHeader title={profile.display_name} backHref="/admin/users" backLabel="ユーザー一覧へ戻る" />
      <AdminNotice notice={notice} onClose={clear} />

      <AdminCard>
        <p className="text-xs text-gray-500">
          登録日時：{new Date(profile.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
        </p>
        <p className="mt-1 text-sm font-bold text-gray-900">
          現在の利用状態：
          {profile.is_permanently_suspended
            ? "永久停止"
            : profile.suspended_until && new Date(profile.suspended_until).getTime() > now
              ? `利用停止中（${new Date(profile.suspended_until).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}まで）`
              : "問題なし"}
        </p>
      </AdminCard>

      <AdminCard title="投稿・参加履歴">
        <p className="text-xs text-gray-600">投稿履歴：お題{postCount}件・回答{answerCount}件</p>
        <p className="mt-1 text-xs text-gray-600">ライブ参加履歴：{participations.length}件</p>
        <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-gray-600">
          {participations.map((p) => (
            <li key={p.id}>
              {new Date(p.joined_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}（{p.role === "player" ? "プレイヤー" : "観客"}）
            </li>
          ))}
        </ul>
      </AdminCard>

      <AdminCard title={`通報された履歴（${reported.length}件）`}>
        <ul className="max-h-32 overflow-y-auto text-xs text-gray-600">
          {reported.map((r) => (
            <li key={r.id} className="border-b border-gray-100 py-1 last:border-0">
              {new Date(r.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}：{r.reason}（{r.status}）
            </li>
          ))}
          {reported.length === 0 && <li>通報はありません。</li>}
        </ul>
      </AdminCard>

      <AdminCard title={`警告・対応履歴（${sanctions.length}件）`}>
        <p className="text-xs font-bold text-gray-700">
          ライブからの退場：{sanctions.filter((s) => s.type === "kicked").length}回
        </p>
        <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-gray-600">
          {sanctions.map((s) => (
            <li key={s.id} className="border-b border-gray-100 py-1 last:border-0">
              {new Date(s.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}：
              {SANCTION_TYPE_LABEL[s.type] ?? s.type} - {s.reason}
            </li>
          ))}
          {sanctions.length === 0 && <li>対応履歴はありません。</li>}
        </ul>
      </AdminCard>

      <AdminCard title="運営メモ">
        <textarea
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
        <AdminButton disabled={pendingAction !== null} onClick={handleSaveMemo} className="mt-1">
          {pendingAction === "memo" ? "保存中…" : "保存"}
        </AdminButton>
      </AdminCard>

      <AdminCard title="対応操作（下にいくほど強い対応です）">
        <div className="flex flex-col items-start gap-2">
          {!warningFormOpen ? (
            <AdminButton disabled={pendingAction !== null} onClick={() => setWarningFormOpen(true)}>
              警告を送る
            </AdminButton>
          ) : (
            <div className="w-full rounded border border-gray-200 p-3">
              <p className="text-xs font-bold text-gray-700">警告を送る</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                定型文をタップすると理由・本文にセットされます（送信前に自由に書き換えられます）。
              </p>
              <div className="mt-2">
                <AdminTemplateChips
                  templates={WARNING_TEMPLATES}
                  onSelect={(t) => {
                    setWarningReason(t.reason);
                    setWarningBody(t.body);
                  }}
                />
              </div>
              <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-gray-600">
                対象となった投稿や行為（省略可）
                <input
                  type="text"
                  value={warningTargetRef}
                  onChange={(e) => setWarningTargetRef(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-gray-600">
                警告理由
                <input
                  type="text"
                  value={warningReason}
                  onChange={(e) => setWarningReason(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-gray-600">
                警告本文（本人への通知に表示されます）
                <textarea
                  value={warningBody}
                  onChange={(e) => setWarningBody(e.target.value)}
                  rows={3}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="mt-2 flex flex-col gap-0.5 text-[11px] text-gray-600">
                今回行った対応（省略可）
                <input
                  type="text"
                  value={warningResponseNote}
                  onChange={(e) => setWarningResponseNote(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <AdminButton
                  variant="primary"
                  disabled={pendingAction !== null || !warningReason.trim()}
                  onClick={handleWarning}
                >
                  {pendingAction === "warning" ? "送信中…" : "この内容で送信する"}
                </AdminButton>
                <AdminButton
                  disabled={pendingAction !== null}
                  onClick={() => {
                    setWarningFormOpen(false);
                    setWarningTargetRef("");
                    setWarningReason("");
                    setWarningBody("");
                    setWarningResponseNote("");
                  }}
                >
                  キャンセル
                </AdminButton>
              </div>
            </div>
          )}
          <AdminButton disabled={pendingAction !== null} onClick={handleSuspendTemporary}>
            {pendingAction === "suspend_temporary" ? "処理中…" : "期限付きで利用停止する"}
          </AdminButton>
          <AdminButton variant="danger" disabled={pendingAction !== null} onClick={handleSuspendPermanent}>
            {pendingAction === "suspend_permanent" ? "処理中…" : "永久停止する"}
          </AdminButton>
          {(profile.is_permanently_suspended || profile.suspended_until) && (
            <AdminButton variant="primary" disabled={pendingAction !== null} onClick={handleLift}>
              {pendingAction === "lift" ? "処理中…" : "停止を解除する"}
            </AdminButton>
          )}
          <AdminButton variant="danger" disabled={pendingAction !== null} onClick={handleDelete}>
            {pendingAction === "delete" ? "削除中…" : "アカウントを完全に削除する（最終手段）"}
          </AdminButton>
        </div>
      </AdminCard>
    </AdminShell>
  );
}
