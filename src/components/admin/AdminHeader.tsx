"use client";

import Link from "next/link";

// どの画面を開いているか・管理画面トップへの戻り方を常に分かるようにする共通ヘッダー。
// 2026-10（実機不具合対応）：ルーターのback相当の処理や、ブラウザの履歴件数を見て
// 分岐する実装は、ブラウザの「戻る」操作そのものになってしまい、閲覧履歴の状態次第で
// アプリ外（例：司会コンソールを開く前に見ていたChromeの検索画面）へ戻ってしまう実害が
// 確認された。この戻るボタンはブラウザの戻る操作ではなく、指定された管理画面への
// 固定リンクであるべきなので、閲覧履歴に依存しないLinkへ変更する。
export default function AdminHeader({
  title,
  backHref = "/admin",
  backLabel = "管理画面トップへ戻る",
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Link href={backHref} className="w-fit select-none text-xs text-gray-500 underline hover:text-gray-700">
        ← {backLabel}
      </Link>
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
    </div>
  );
}
