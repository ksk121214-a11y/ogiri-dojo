"use client";

import { useRouter } from "next/navigation";

// 寄合帳サブページ共通の「戻る」ボタン。ブラウザ履歴を使って実際に直前見ていたページへ戻る
// （例：寄合帳→フォロー一覧、の順で来ていれば寄合帳に戻る）。直接URLアクセス等で履歴が
// ない場合のみ、フォールバック先（既定は寄合帳トップ）へ遷移する。
export default function SnsBackButton({
  fallbackHref = "/sns",
  className = "w-fit font-sans text-xs font-bold text-dojo-dark-brown hover:underline",
}: {
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className}
    >
      ← 戻る
    </button>
  );
}
