"use client";

import { useEffect, useState } from "react";

import { BellGlyph } from "@/components/home/icons";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

// アプリ内通知ベル（運営者専用管理画面の追加・第3段階）。運営からの警告等を
// notificationsテーブルから取得して表示する。プッシュ通知ではなく、
// ヘッダーの小さいベルアイコン＋未読バッジ＋クリックで一覧、という最小構成。
// 未ログイン時・自分宛の通知が無い時は何も表示しない（既存ヘッダーの見た目を
// 崩さないため）。
export default function NotificationBell() {
  const authUser = useAuthStore((s) => s.user);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!authUser) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications((data ?? []) as NotificationRow[]);
  };

  useEffect(() => {
    // マウント時・ユーザー確定時に1回取得する（外部システム=Supabaseとの同期）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  if (!authUser) return null;

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleOpen = async () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
      await load();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label="お知らせを開く"
        className="relative flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted-on-dark)] transition hover:text-[var(--text-on-dark)]"
      >
        <BellGlyph />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--accent)] text-[8px] font-black leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-label="お知らせ"
            className="absolute top-full right-0 z-50 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-[var(--border-dark)] bg-[var(--paper,#1a1a1a)] p-2 text-left shadow-xl"
          >
            {notifications.length === 0 ? (
              <p className="p-2 font-sans text-xs text-[var(--muted-on-dark)]">お知らせはありません</p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="border-b border-[var(--border-dark)]/50 p-2 last:border-0">
                  <p className="font-sans text-xs font-bold text-[var(--text-on-dark)]">{n.title}</p>
                  <p className="mt-0.5 font-sans text-[11px] text-[var(--muted-on-dark)]">{n.body}</p>
                  <p className="mt-0.5 font-sans text-[10px] text-[var(--muted-on-dark)]">
                    {new Date(n.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
