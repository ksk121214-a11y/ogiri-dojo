"use client";

import Link from "next/link";

// ライブ体験画面（フルスクリーン、AppHeaderなし）からホームへ戻るための最小限のリンク。
export default function BackToHomeLink() {
  return (
    <Link
      href="/"
      className="absolute left-4 top-4 z-10 rounded-full border border-white/25 px-4 py-2 font-sans text-xs text-white/80 transition hover:border-[#3b5bff] hover:text-[#7ab2ff] sm:left-6 sm:top-6"
    >
      ← ホームに戻る
    </Link>
  );
}
