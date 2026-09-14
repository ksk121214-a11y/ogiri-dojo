"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import { isGuestUser } from "@/lib/guestStatus";
import { computeDisplayedTickets } from "@/lib/ticketRecovery";
import { formatMinutesUntil } from "@/lib/ticketFormat";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";

const MAX_LENGTH = 60;

// お題投稿フォーム。投稿後は寄合帳トップ（新着順の先頭に表示される）に戻る。
// 2026-08-28: マイページ経由（「お題を投稿する」バナー）で来ることがほとんどのため、
// 見た目もマイページと同じ地下ライブハウス風（StadiumPageShell）に統一した。
// 2026-08-29: 投稿には寄合券を1枚消費するようにした。
// 2026-09-02: 寄合券をサーバー管理（profiles.tickets_count）に一本化し、投稿保存に
// 成功した場合だけ券が減るようにした（submit_sns_topic RPC内で原子的に処理）。
// 保存に失敗した場合は入力内容を残したままエラーを表示し、送信中は二重送信を防止する。
export default function SnsNewTopicPage() {
  const router = useRouter();
  const addTopic = useSnsStore((s) => s.addTopic);
  const profile = useProfileStore((s) => s.profile);
  const authUser = useAuthStore((s) => s.user);
  const signInWithX = useAuthStore((s) => s.signInWithX);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [xLoginError, setXLoginError] = useState<string | null>(null);

  const displayedTickets = profile
    ? computeDisplayedTickets(profile.ticketsCount, profile.ticketsNextRecoveryAt)
    : { count: 0, nextRecoveryAt: null };
  const ticketCount = displayedTickets.count;
  const nextTicketRecoveryAt = displayedTickets.nextRecoveryAt;

  const overLimit = body.length > MAX_LENGTH;
  const noTicket = ticketCount <= 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || overLimit || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await addTopic(trimmed);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    // 静的サイト公開(GitHub Pages)では新規投稿のIDに対応する詳細ページが
    // 事前生成されておらず直接遷移すると404になるため、投稿後は寄合帳トップに戻す。
    router.push("/mypage");
  };

  // 2026-09-13（0070ゲスト参加レビュー対応）：ゲストはsubmit_sns_topic（DB）が
  // GUEST_NOT_ALLOWEDで拒否するため、フォームを見せずに案内へ差し替える
  // （「寄合券が0枚のため投稿できません」という誤解を招く表示を避ける）。
  if (isGuestUser(authUser, profile)) {
    return (
      <StadiumPageShell contentTheme="kraft">
        <SnsBackButton
          fallbackHref="/mypage"
          className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
        />
        <div className={`${stadiumStyles.grainPaper} flex flex-col items-center gap-3 p-6 text-center`}>
          <p className="font-sans text-sm text-[var(--ink)]/80">
            ゲスト参加中です。Xでログインするとお題を投稿できます。
          </p>
          <button
            type="button"
            onClick={async () => {
              setXLoginError(null);
              const result = await signInWithX({ isGuestSwitch: true });
              if (!result.ok && result.reason) setXLoginError(result.reason);
            }}
            className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} rounded-xl px-6 py-2.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90`}
          >
            Xでログイン
          </button>
          {xLoginError && <p className="font-sans text-xs text-[var(--accent)]">{xLoginError}</p>}
        </div>
      </StadiumPageShell>
    );
  }

  return (
    <StadiumPageShell contentTheme="kraft">
      <SnsBackButton
        fallbackHref="/mypage"
        className="w-fit font-sans text-xs font-bold text-[var(--ink)]/70 hover:text-[var(--ink)]"
      />

      <div className="text-center">
        <p className="font-sans text-xs font-bold tracking-widest text-[var(--accent)]">
          NEW TOPIC
        </p>
        <h1 className="mt-1 font-sans text-3xl font-black text-[var(--ink)]">
          お題を出す
        </h1>
        <p className="mt-2 font-sans text-xs text-[var(--ink)]/70">
          みんなに回答してもらうお題を投稿します
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`${stadiumStyles.grainPaper} flex flex-col gap-4 p-5 shadow-[0_10px_24px_rgba(23,21,19,0.22)] sm:p-6`}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="お題の文章を入力...（例：師匠に弟子入りしたら、まさかの修行内容だった。何をさせられた？）"
          rows={4}
          className={`w-full rounded-lg border bg-[var(--paper-muted)] p-3 font-sans text-base text-[var(--ink)] outline-none ${
            overLimit
              ? "border-[var(--accent)] focus:border-[var(--accent)]"
              : "border-[var(--ink)]/20 focus:border-[var(--accent)]"
          }`}
        />
        <div className="flex items-center justify-between">
          <span
            className={`font-sans text-xs ${overLimit ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"}`}
          >
            {body.length} / {MAX_LENGTH}
          </span>
        </div>
        {noTicket && (
          <p className="font-sans text-xs font-bold text-[var(--accent)]">
            寄合券が0枚のため投稿できません。
            {nextTicketRecoveryAt && `あと${formatMinutesUntil(nextTicketRecoveryAt)}分で1枚回復します。`}
          </p>
        )}
        {error && <p className="font-sans text-xs font-bold text-[var(--accent)]">{error}</p>}
        <button
          type="submit"
          disabled={!body.trim() || overLimit || noTicket || submitting}
          className={`${stadiumStyles.pressable} ${stadiumStyles.grainAccent} w-full px-6 py-3 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {submitting ? "投稿中…" : "投稿する（寄合券を1枚使う）"}
        </button>
      </form>
    </StadiumPageShell>
  );
}
