"use client";

import { useEffect, useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import { isConfirmedMember, isGuestUser, isSameUser } from "@/lib/guestStatus";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

interface PointHistoryRow {
  id: string;
  points: number;
  label: string;
  created_at: string;
}

// ヘッダー（畳生成りテーマの/ranking・/gacha等）の「段位・名前・ポイント」バッジ、または
// ホーム/マイページ（地下ライブハウステーマ）の「ポイント残高」表示を押すと開く獲得履歴モーダル。
// 2026-08-28: ホーム下部のポイント残高（AccountSummary）から開けるようにしたのに合わせて、
// variant="stadium"のときだけ見た目を地下ライブハウステーマに合わせられるようにした
// （畳生成りテーマ側のAppHeaderからの利用は従来通りvariant="dojo"のまま）。
// 2026-08-31（段位・ポイント・実績の実データ化）：固定ダミー配列(POINT_HISTORY)ではなく、
// Supabaseのpoint_history（ライブ終了時にapply_live_rank_rewards()が1行ずつ記録する）を
// ログイン中の自分の分だけ取得して表示するようにした。ポイント残高もuseProfileStoreの実データ。
export default function PointHistoryModal({
  onClose,
  variant = "dojo",
}: {
  onClose: () => void;
  variant?: "dojo" | "stadium";
}) {
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const authUser = useAuthStore((s) => s.user);
  // 2026-09-13（0070ゲスト参加レビュー対応）：authUser.is_anonymousも併せて見る
  // 共通関数（src/lib/guestStatus.ts）を使う。ゲストはポイントを一切獲得しないため、
  // point_historyの取得自体を実行しない（不要なDB往復を避ける）。
  const isGuest = isGuestUser(authUser, profile);
  // 2026-09-13（再レビュー対応）：「本人確認できた状態」＝isConfirmedMember
  // （認証済み・匿名でない・profile取得済み・authUserとprofileのidが一致）の
  // 場合にのみ、点数・履歴の取得と表示を行う。会員A→ゲスト、会員A→会員Bの
  // 切り替え直後（profileがまだ古いA/nullの一瞬）にAの情報を出さないための核心。
  const isMember = isConfirmedMember({ authUser, profile, profileLoading });
  const points = isMember ? (profile?.pointsBalance ?? 0) : 0;
  const isStadium = variant === "stadium";

  const [history, setHistory] = useState<PointHistoryRow[]>([]);
  // 2026-09-13（再レビュー対応）：直近に取得したhistoryが「誰のものか」を保持する。
  // 取得完了時に今の認証ユーザーと一致する場合のみ、実際に画面へ反映する
  // （取得中に別ユーザー・ゲストへ切り替わっていたら、遅れて届いた結果を捨てる）。
  const [historyOwnerId, setHistoryOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isMember || !profile) {
      // ゲスト・未ログイン・本人確認できない状態（authUserとprofileのidが不一致・
      // profile取得中を含む）では取得自体を行わず、それ以前に表示していたかも
      // しれない履歴も即座に消す（前の利用者の履歴が残ったり一瞬表示されたり
      // しないようにする）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory([]);
      setHistoryOwnerId(null);
      setLoading(false);
      return;
    }
    const requestedUserId = profile.id;
    setHistory([]);
    setLoading(true);
    let cancelled = false;
    supabase
      .from("point_history")
      .select("id, points, label, created_at")
      .eq("user_id", requestedUserId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled) return;
        // 取得中に別の利用者（別会員・ゲスト）へ切り替わっていたら、
        // 遅れて届いたこの結果を採用しない。
        if (!isSameUser(requestedUserId, useAuthStore.getState().user?.id)) return;
        setHistory((data ?? []) as PointHistoryRow[]);
        setHistoryOwnerId(requestedUserId);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isMember, profile]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

  // 表示直前にも、取得済みhistoryが今の認証ユーザー本人のものであることを
  // 再確認する（historyOwnerIdとauthUser.idの食い違いが万一残っていても、
  // 画面には出さない最後の砦）。
  const visibleHistory = isMember && isSameUser(historyOwnerId, authUser?.id) ? history : [];

  // 2026-09-13（0070ゲスト参加レビュー対応）：ゲストはポイントを一切獲得しないため、
  // 残高0円・履歴無しを実データのように見せず、専用の案内に差し替える。
  const listBody = isGuest ? (
    <p className="p-2 text-center font-sans text-xs text-[var(--ink)]/60">
      ゲスト参加中です。ログインするとポイントが記録されます。
    </p>
  ) : !authUser ? (
    <p className="p-2 text-center font-sans text-xs text-[var(--ink)]/60">
      ログインするとライブで獲得したポイントの履歴がここに表示されます。
    </p>
  ) : !isMember || loading ? (
    <p className="p-2 text-center font-sans text-xs text-[var(--ink)]/60">読み込み中…</p>
  ) : visibleHistory.length === 0 ? (
    <p className="p-2 text-center font-sans text-xs text-[var(--ink)]/60">
      まだ獲得履歴がありません。ライブに参加してみましょう。
    </p>
  ) : null;

  if (isStadium) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`${stadiumStyles.grainPaper} flex w-full max-w-sm flex-col gap-4 rounded-3xl p-6 text-[var(--ink)] shadow-2xl`}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-sans text-base font-black text-[var(--ink)]">獲得履歴</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="rounded-full px-2 py-1 font-sans text-sm text-[var(--ink)]/70 hover:bg-[var(--ink)]/5"
            >
              ✕
            </button>
          </div>

          {isMember && (
            <div className={`${stadiumStyles.grainAccent} rounded-2xl p-4 text-center`}>
              <p className="font-sans text-[11px] text-[var(--paper)]/80">現在のポイント残高</p>
              <p className="mt-1 font-sans text-2xl font-black tabular-nums text-[var(--paper)]">
                {points.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-[var(--paper)]/80">pt</span>
              </p>
            </div>
          )}

          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {listBody}
            {visibleHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-[var(--ink)]/5 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-sans text-xs font-bold text-[var(--ink)]">
                    {entry.label}
                  </p>
                  <p className="font-sans text-[10px] text-[var(--ink)]/60">
                    {formatDate(entry.created_at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-sans text-sm font-bold tabular-nums ${
                    entry.points >= 0 ? "text-dojo-tatami-green" : "text-[var(--accent)]"
                  }`}
                >
                  {entry.points >= 0 ? "+" : ""}
                  {entry.points.toLocaleString()}pt
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-bold text-dojo-ink">獲得履歴</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full px-2 py-1 font-sans text-sm text-dojo-dark-brown hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        {/* 2026-09-13（再レビュー対応）：dojo版でも、stadium版と同様にゲスト・
            未ログイン・本人確認できない状態では現在ポイントを表示しない
            （以前はここだけ常時表示になっており、実データの無いユーザーにも
            0ptが実際の残高であるかのように見えてしまっていた）。 */}
        {isMember && (
          <div className="rounded-2xl bg-dojo-tatami-cream p-4 text-center">
            <p className="font-sans text-[11px] text-dojo-dark-brown/70">現在のポイント残高</p>
            <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-dojo-ink">
              {points.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-dojo-dark-brown/70">pt</span>
            </p>
          </div>
        )}

        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {listBody}
          {visibleHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-dojo-tatami-cream/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-xs font-bold text-dojo-ink">
                  {entry.label}
                </p>
                <p className="font-sans text-[10px] text-dojo-dark-brown/60">
                  {formatDate(entry.created_at)}
                </p>
              </div>
              <span
                className={`shrink-0 font-sans text-sm font-bold tabular-nums ${
                  entry.points >= 0 ? "text-dojo-tatami-green" : "text-dojo-deep-crimson"
                }`}
              >
                {entry.points >= 0 ? "+" : ""}
                {entry.points.toLocaleString()}pt
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
