"use client";

import { useRouter } from "next/navigation";

// どの画面を開いているか・管理画面トップへの戻り方を常に分かるようにする共通ヘッダー。
// 2026-08-31：backHref固定のLinkだと「どこから来たか」に関わらず常に同じ場所
//（例：/admin/live-results一覧）へ飛んでしまい、実際にいた場所（例：/admin/schedule）
// に戻れなかったため、SnsBackButton.tsxと同じ考え方でブラウザ履歴を優先する。
// 直接URLアクセス等で戻り先が無い場合のみbackHrefへフォールバックする。
export default function AdminHeader({
  title,
  backHref = "/admin",
  backLabel = "管理画面トップへ戻る",
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
          } else {
            router.push(backHref);
          }
        }}
        className="w-fit select-none text-xs text-gray-500 underline hover:text-gray-700"
      >
        ← {backLabel}
      </button>
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
    </div>
  );
}
