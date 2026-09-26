"use client";

import StadiumPageShell from "@/components/home/StadiumPageShell";
import SnsBackButton from "@/components/sns/SnsBackButton";
import type { AuthorLookupStatus } from "@/lib/authorLookupStatus";

// 演者情報の取得が終わっていない／失敗した／存在しない場合の表示（found以外）。
export default function SnsAuthorLookupState({
  status,
  onRetry,
}: {
  status: Exclude<AuthorLookupStatus, "found">;
  onRetry: () => void;
}) {
  return (
    <StadiumPageShell contentTheme="kraft">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="font-sans text-sm text-[var(--ink)]/90">
          {status === "loading"
            ? "読み込み中…"
            : status === "error"
              ? "演者情報を取得できませんでした。通信状況を確認してもう一度お試しください。"
              : "演者が見つかりませんでした。"}
        </p>
        {status === "error" && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-[var(--ink)]/40 px-5 py-2 font-sans text-xs font-bold text-[var(--ink)] hover:bg-[var(--ink)]/5"
          >
            再試行
          </button>
        )}
        {status !== "loading" && <SnsBackButton />}
      </div>
    </StadiumPageShell>
  );
}
