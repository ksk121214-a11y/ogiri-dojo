"use client";

import { useEffect, useState } from "react";

import { isConfirmedMember, isGuestUser } from "@/lib/guestStatus";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

import styles from "@/components/home/StadiumHome.module.css";

interface TitleRow {
  slug: string;
  display_name: string;
  kind: "normal" | "limited";
  sort_order: number;
}

// マイページの演者名カードから開く称号選択モーダル。「称号なし」・通常称号（全員選択可）・
// 本人が所有している限定称号だけを選択肢として出す（未所有の限定称号は出さない）。
// supabase/migrations/0081のtitles/user_titles/set_equipped_titleを参照する。
// 呼び出し元が開いている間だけマウントする前提（MyProfileEditModalと同じ流儀）。
export default function TitleSelectModal({ onClose }: { onClose: () => void }) {
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const authUser = useAuthStore((s) => s.user);
  const authUserId = authUser?.id ?? null;
  const [openedForUserId] = useState(authUserId);
  useEffect(() => {
    if (authUserId !== openedForUserId) onClose();
  }, [authUserId, openedForUserId, onClose]);

  const isMember = isConfirmedMember({ authUser, profile, profileLoading });

  if (!isMember || !profile) {
    const isGuest = isGuestUser(authUser, profile);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
        <div
          onClick={(e) => e.stopPropagation()}
          className={`${styles.surfaceLight} flex w-full max-w-sm flex-col gap-5 rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
        >
          <h2 className="font-sans text-lg font-black">称号を選ぶ</h2>
          <p className="font-sans text-sm text-[var(--ink)]/70">
            {isGuest ? "ゲスト参加中です。Xでログインすると称号を選べます。" : "ログインすると称号を選べます。"}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={`${styles.pressable} rounded-xl px-5 py-2.5 font-sans text-sm font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/5`}
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <TitleSelectForm profile={profile} openedForUserId={openedForUserId} onClose={onClose} />;
}

function TitleSelectForm({
  profile,
  openedForUserId,
  onClose,
}: {
  profile: NonNullable<ReturnType<typeof useProfileStore.getState>["profile"]>;
  openedForUserId: string | null;
  onClose: () => void;
}) {
  const setEquippedTitle = useProfileStore((s) => s.setEquippedTitle);
  const [titles, setTitles] = useState<TitleRow[] | null>(null);
  const [ownedLimitedSlugs, setOwnedLimitedSlugs] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(profile.equippedTitleSlug);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("titles").select("slug, display_name, kind, sort_order").eq("is_active", true).order("sort_order"),
      supabase.from("user_titles").select("title_slug").eq("user_id", openedForUserId ?? ""),
    ]).then(([titlesRes, ownedRes]) => {
      if (cancelled) return;
      setTitles((titlesRes.data as TitleRow[] | null) ?? []);
      setOwnedLimitedSlugs((ownedRes.data ?? []).map((r) => r.title_slug as string));
    });
    return () => {
      cancelled = true;
    };
  }, [openedForUserId]);

  const selectableTitles = (titles ?? []).filter(
    (t) => t.kind === "normal" || ownedLimitedSlugs.includes(t.slug),
  );

  const handleSelect = async (slug: string | null) => {
    if (submitting || slug === selected) return;
    setSubmitting(true);
    setError(null);
    if (useAuthStore.getState().user?.id !== openedForUserId) {
      setSubmitting(false);
      setError("アカウントが切り替わったため保存できません");
      return;
    }
    const result = await setEquippedTitle(slug);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setSelected(slug);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.surfaceLight} flex max-h-[76vh] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
      >
        <h2 className="font-sans text-lg font-black">称号を選ぶ</h2>

        {titles === null ? (
          <p className="font-sans text-sm text-[var(--ink)]/60">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSelect(null)}
              aria-pressed={selected === null}
              className={`${styles.pressable} rounded-xl border px-4 py-2.5 text-left font-sans text-sm font-bold transition disabled:opacity-50 ${
                selected === null
                  ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                  : "border-[var(--ink)]/15 text-[var(--ink)] hover:border-[var(--ink)]/40"
              }`}
            >
              称号なし
            </button>
            {selectableTitles.map((t) => (
              <button
                key={t.slug}
                type="button"
                disabled={submitting}
                onClick={() => handleSelect(t.slug)}
                aria-pressed={selected === t.slug}
                className={`${styles.pressable} flex items-center justify-between rounded-xl border px-4 py-2.5 text-left font-sans text-sm font-bold transition disabled:opacity-50 ${
                  selected === t.slug
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--ink)]/15 text-[var(--ink)] hover:border-[var(--ink)]/40"
                }`}
              >
                <span>{t.display_name}</span>
                {t.kind === "limited" && (
                  <span className="ml-2 shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--paper)]">
                    限定
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {error && <p className="font-sans text-xs font-bold text-[var(--accent-on-light)]">{error}</p>}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`${styles.pressable} rounded-xl px-5 py-2.5 font-sans text-sm font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/5`}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
