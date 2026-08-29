"use client";

import { useEffect, useState } from "react";

// 2026-08-29:「リロードしたら重い/時間がかかる」場合に、ユーザーが「固まった」と
// 誤解しないよう、一定時間を超えてもまだ準備が終わらない時にだけ控えめな
// 「読み込み中」表示を出す。通常時（すぐ終わる場合）は一度も画面に出ない
// ＝ちらつきを起こさないよう、閾値を超えるまでは何も描画しない設計にしている。
export default function SlowLoadingBanner({
  isLoading,
  thresholdMs = 3000,
  label = "読み込みに時間がかかっています…",
}: {
  isLoading: boolean;
  thresholdMs?: number;
  label?: string;
}) {
  // 「表示するかどうか」はisLoadingとtimerExpiredの組み合わせで決まる派生値にし、
  // isLoadingがfalseに戻った瞬間に自動的に非表示になるようにする（effect側で
  // 明示的にfalseへ戻す処理を書かずに済む）。
  const [timerExpired, setTimerExpired] = useState(false);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setTimerExpired(true), thresholdMs);
    return () => clearTimeout(timer);
  }, [isLoading, thresholdMs]);

  if (!isLoading || !timerExpired) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 bg-black/80 px-4 py-2 font-sans text-xs font-bold text-white"
    >
      <span
        className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
        aria-hidden
      />
      {label}
    </div>
  );
}
