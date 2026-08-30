"use client";

import { TicketGlyph } from "./icons";
import styles from "./StadiumHome.module.css";
import type { LiveJoinStatus } from "./useLiveJoinFlow";

const LABEL: Record<LiveJoinStatus, string> = {
  idle: "参加する",
  checking: "入場手続き中…",
  detaching: "入場手続き中…",
  error: "参加する",
  joined: "再入場する",
  preparing: "ただいま準備中です",
};

// 「参加する」CTA。2026-08-29: 参加成功時にNextLiveTicketの半券を切り離す演出に
// 対応するため、単なる<Link>から状態付きの<button>に変更した（実際のページ遷移は
// アニメーション終了後、useLiveJoinFlow.handleAnimationEnd内でrouter.push("/live")する）。
// 既存のライブ参加動線（/liveへ遷移し、そこでプレイヤー/観客を選ぶ）自体は変更していない。
export default function JoinLiveButton({
  status,
  error,
  onClick,
}: {
  status: LiveJoinStatus;
  error: string | null;
  onClick: () => void;
}) {
  const busy = status === "checking" || status === "detaching";
  const disabled = busy || status === "preparing";
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-busy={busy}
        className={`${styles.pressable} ${styles.grainAccent} flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl px-5 font-sans text-xl font-bold text-[var(--paper)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--paper)] disabled:cursor-not-allowed disabled:opacity-70`}
      >
        <TicketGlyph />
        {LABEL[status]}
        {!disabled && <span aria-hidden>›</span>}
      </button>
      {error && (
        <p className="text-center font-sans text-xs font-bold text-[var(--accent)]">{error}</p>
      )}
    </div>
  );
}
