import Link from "next/link";

// どの画面を開いているか・管理画面トップへの戻り方を常に分かるようにする共通ヘッダー。
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
      <Link href={backHref} className="text-xs text-gray-500 underline hover:text-gray-700">
        ← {backLabel}
      </Link>
      <h1 className="text-lg font-bold text-gray-900">{title}</h1>
    </div>
  );
}
