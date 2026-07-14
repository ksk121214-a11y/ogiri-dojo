"use client";

import { useState } from "react";

// 演者アイコンが表示される箇所（寄合帳の投稿・プロフィール、番付表、結果発表など）に共通設置する
// 通報ボタン。過度に卑猥・グロテスクな表現などの不適切な内容を、確認ダイアログを一度挟んでから
// 報告済み状態にする（送信先の運営システムは未接続のダミー実装）。
export default function ReportButton({
  size = 22,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const [reported, setReported] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (reported) return;
        const confirmed = window.confirm(
          "報告しますか？\n過度に卑猥な表現やグロテスクな表現など、不適切な内容として運営に報告します。",
        );
        if (!confirmed) return;
        setReported(true);
      }}
      title={reported ? "報告済みです" : "不適切な内容を報告する"}
      aria-label={reported ? "報告済みです" : "不適切な内容を報告する"}
      className={`flex shrink-0 items-center justify-center rounded-full transition ${
        reported
          ? "text-dojo-curtain-red"
          : "text-dojo-gray-purple/70 hover:text-dojo-curtain-red"
      } ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}
    >
      {reported ? "✅" : "🚩"}
    </button>
  );
}
