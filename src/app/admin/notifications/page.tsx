"use client";

import { useEffect, useState } from "react";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminNotice, { useAdminNotice } from "@/components/admin/AdminNotice";
import AdminShell from "@/components/admin/AdminShell";
import AdminTemplateChips from "@/components/admin/AdminTemplateChips";
import { logAdminAction } from "@/lib/adminActionLog";
import { supabase } from "@/lib/supabase";

interface SentAnnouncement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

// よく使うお知らせの定型文。クリックするとタイトル・本文にセットされ、
// その後は自由に書き換えられる（日時など個別の内容はセット後に書き換える想定）。
const NOTIFICATION_TEMPLATES = [
  {
    label: "メンテナンスのお知らせ",
    title: "メンテナンスのお知らせ",
    body: "日時の間、メンテナンスのためライブに参加できません。ご不便をおかけしますが、よろしくお願いいたします。",
  },
  {
    label: "新機能のお知らせ",
    title: "新機能のお知らせ",
    body: "新しい機能を追加しました。詳しくはアプリ内をご確認ください。",
  },
  {
    label: "障害復旧のお知らせ",
    title: "障害復旧のお知らせ",
    body: "発生していた不具合は復旧いたしました。ご迷惑をおかけし申し訳ございませんでした。",
  },
  {
    label: "次回ライブのお知らせ",
    title: "次回ライブのお知らせ",
    body: "次回のライブ開催が決まりました。詳しくは「次回ライブ」ページをご確認ください。",
  },
] as const;

// お知らせ配信（運営者専用管理画面）。ユーザー管理の「警告を送る」は個別1人向け
// だが、それとは別に全ユーザーのヘッダーの通知ベル（NotificationBell.tsx）に
// 一斉配信できる場所が無かったため新設した。notificationsテーブルに
// type='announcement'で全ユーザーぶん一括insertする（RLSのnotifications_insert_host
// ポリシーで運営者のinsertは既に許可されている、DB変更なし）。
export default function AdminNotificationsPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [userCount, setUserCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentAnnouncement[]>([]);
  const [loadingSent, setLoadingSent] = useState(true);
  const { notice, notifySuccess, notifyError, clear } = useAdminNotice();

  const loadSent = async () => {
    setLoadingSent(true);
    // announcementは全ユーザーぶん行が増えるため、代表として同じ(title,body,created_at)の
    // 組み合わせを表示用に間引く（1配信＝多数行のうち先頭1件だけ見せる）。
    const { data } = await supabase
      .from("notifications")
      .select("id, title, body, created_at")
      .eq("type", "announcement")
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as SentAnnouncement[];
    const seen = new Set<string>();
    const deduped: SentAnnouncement[] = [];
    for (const row of rows) {
      const key = `${row.created_at}|${row.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    setSent(deduped.slice(0, 20));
    setLoadingSent(false);
  };

  useEffect(() => {
    const loadCount = async () => {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      setUserCount(count ?? 0);
    };
    loadCount();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSent();
  }, []);

  const handleSend = async () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      notifyError("タイトルと本文を入力してください。");
      return;
    }
    const confirmed = window.confirm(
      `全ユーザー（${userCount ?? "?"}人）のお知らせに配信しますか？この操作は取り消せません。`,
    );
    if (!confirmed) return;

    setSending(true);
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id");
    if (profilesError || !profiles) {
      setSending(false);
      notifyError(profilesError?.message ?? "ユーザー一覧の取得に失敗しました");
      return;
    }
    const rows = profiles.map((p) => ({
      user_id: p.id,
      type: "announcement",
      title: trimmedTitle,
      body: trimmedBody,
    }));
    const { error: insertError } = await supabase.from("notifications").insert(rows);
    setSending(false);
    if (insertError) {
      notifyError(insertError.message);
      return;
    }
    await logAdminAction({
      action: "announcement_broadcast",
      targetType: "notifications",
      detail: { title: trimmedTitle, body: trimmedBody, count: rows.length },
    });
    notifySuccess(`${rows.length}人に配信しました。`);
    setTitle("");
    setBody("");
    await loadSent();
  };

  return (
    <AdminShell>
      <AdminHeader title="お知らせ配信" />
      <p className="text-xs text-gray-500">
        ここで送ると、ホーム画面などヘッダーの通知ベルに全ユーザーへ一斉配信されます。
        1人だけへの警告は「ユーザー管理」の詳細ページから送ってください。
      </p>

      <AdminNotice notice={notice} onClose={clear} />

      <AdminCard title="新しいお知らせを作成">
        <div className="flex flex-col gap-2">
          <AdminTemplateChips
            templates={NOTIFICATION_TEMPLATES}
            onSelect={(t) => {
              setTitle(t.title);
              setBody(t.body);
            }}
          />
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-600">
            タイトル
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：メンテナンスのお知らせ"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-600">
            本文
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="例：8/31 24:00〜1:00の間、メンテナンスのためライブに参加できません。"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <AdminButton
            variant="primary"
            disabled={sending || !title.trim() || !body.trim()}
            onClick={handleSend}
            className="self-start"
          >
            {sending ? "送信中…" : `全員（${userCount ?? "…"}人）に送信する`}
          </AdminButton>
        </div>
      </AdminCard>

      <AdminCard title="配信履歴">
        {loadingSent ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : sent.length === 0 ? (
          <p className="text-sm text-gray-500">まだ配信したお知らせがありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sent.map((s) => (
              <li key={s.id} className="rounded border border-gray-200 p-2.5">
                <p className="text-xs text-gray-500">
                  {new Date(s.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </p>
                <p className="mt-0.5 text-sm font-bold text-gray-900">{s.title}</p>
                <p className="mt-0.5 text-xs text-gray-600">{s.body}</p>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </AdminShell>
  );
}
