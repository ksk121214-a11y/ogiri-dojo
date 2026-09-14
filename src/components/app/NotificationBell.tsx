"use client";

import { useEffect, useState } from "react";

import { BellGlyph } from "@/components/home/icons";
import { isGuestUser, isSameUser } from "@/lib/guestStatus";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

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
// 崩さないため）。data-sfx="home"により、StadiumSfxController.tsx経由で
// 下部ナビ等と同じhomeClick音が鳴る（付けなければ既定のpageTurn音になる）。
export default function NotificationBell() {
  const authUser = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  // 2026-09-13（0070ゲスト参加レビュー対応）：authUser.is_anonymousも併せて見る
  // 共通関数（src/lib/guestStatus.ts）を使う。匿名ユーザーはprofile取得を待たず
  // 即座にゲストと分かるため、Supabaseへの通知取得（load()）自体を実行しない
  // （不要なDB往復・通知データの取得を避ける）。
  const isGuest = isGuestUser(authUser, profile);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  // 2026-09-13（再レビュー対応）：直近に取得したnotificationsが「誰のものか」を
  // 保持する。会員A→ゲスト、会員A→会員Bの切り替え時に、取得中だった別ユーザーの
  // 通知データが遅れて届いても採用しない（前の利用者の通知が一瞬でも残らない
  // ようにする）。
  const [notificationsOwnerId, setNotificationsOwnerId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!authUser || isGuest) return;
    const requestedUserId = authUser.id;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", requestedUserId)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(20);
    // 取得中に別の利用者（別会員・ゲスト）へ切り替わっていたら、
    // 遅れて届いたこの結果を採用しない。
    if (!isSameUser(requestedUserId, useAuthStore.getState().user?.id)) return;
    setNotifications((data ?? []) as NotificationRow[]);
    setNotificationsOwnerId(requestedUserId);
  };

  useEffect(() => {
    if (!authUser || isGuest) {
      // ゲスト・未ログインになった時点で、以前の利用者の通知データを
      // 即座に消す（load()の完了を待たない）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotifications([]);
      setNotificationsOwnerId(null);
      return;
    }
    // マウント時・ユーザー確定時に1回取得する（外部システム=Supabaseとの同期）。
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, isGuest]);

  // 表示直前にも、取得済みnotificationsが今の認証ユーザー本人のものであることを
  // 再確認する（notificationsOwnerIdとauthUser.idの食い違いが万一残っていても、
  // 画面には出さない最後の砦）。
  const visibleNotifications = isSameUser(notificationsOwnerId, authUser?.id) ? notifications : [];

  // 2026-09-13（0070ゲスト参加レビュー対応）：ゲストは通知（ポイント獲得・運営ベスト等の
  // 会員専用イベント）を受け取らないため、ベル自体を表示しない。
  if (!authUser || isGuest) return null;

  const unreadCount = visibleNotifications.filter((n) => !n.read_at).length;

  const handleOpen = async () => {
    setOpen((v) => !v);
    if (!open && unreadCount > 0) {
      const unreadIds = visibleNotifications.filter((n) => !n.read_at).map((n) => n.id);
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
        data-sfx="home"
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
          {/* 2026-08-30:「文字が薄い、タイトルは見えない」不具合対策。
              var(--paper)/var(--text-on-dark)はStadiumテーマでは両方とも同じ
              明るいクリーム色に定義されており、「暗い背景に明るい文字」という
              このドロップダウンの意図に反して「明るい背景に明るい文字」になって
              読めなくなっていた。テーマ変数に左右されない固定の配色に変更する。 */}
          <div
            role="dialog"
            aria-label="お知らせ"
            className="absolute top-full right-0 z-50 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-white/15 bg-[#1f1f1f] p-2 text-left shadow-xl"
          >
            {visibleNotifications.length === 0 ? (
              <p className="p-2 font-sans text-xs text-white/60">お知らせはありません</p>
            ) : (
              visibleNotifications.map((n) => (
                <div key={n.id} className="border-b border-white/10 p-2 last:border-0">
                  <p className="font-sans text-xs font-bold text-white">{n.title}</p>
                  <p className="mt-0.5 font-sans text-[11px] text-white/70">{n.body}</p>
                  <p className="mt-0.5 font-sans text-[10px] text-white/50">
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
