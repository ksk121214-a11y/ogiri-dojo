"use client";

import { useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

const REASON_OPTIONS = ["不適切な表現", "スパム", "なりすまし", "その他"] as const;

export type ReportTargetType = "sns_topic" | "sns_answer" | "sns_comment";

// 演者アイコンが表示される箇所（寄合帳の投稿・プロフィール、番付表、結果発表など）に共通設置する
// 通報ボタン。過度に卑猥・グロテスクな表現などの不適切な内容を、確認ダイアログを一度挟んでから
// 報告済み状態にする。
// 2026-08-30（運営者専用管理画面の追加・第3段階）：通報対象（target/targetId等）が
// 渡された場合は実際にreportsテーブルへ保存する（理由選択＋詳細入力を挟む）ようにした。
// これらのpropsが渡されない呼び出し元（まだ対応していない箇所・ダミー投稿等）では、
// 従来どおりwindow.confirmのみのダミー確認に留める（保存しない）。
export default function ReportButton({
  size = 22,
  className = "",
  targetType,
  targetId,
  targetAuthorId,
  snapshotBody,
}: {
  size?: number;
  className?: string;
  targetType?: ReportTargetType;
  targetId?: string;
  targetAuthorId?: string | null;
  snapshotBody?: string;
}) {
  const [reported, setReported] = useState(false);

  const handleReport = async () => {
    if (!targetType || !targetId) {
      // 通報対象が特定できない呼び出し元向けの、これまでどおりのダミー確認。
      const confirmed = window.confirm(
        "報告しますか？\n過度に卑猥な表現やグロテスクな表現など、不適切な内容として運営に報告します。",
      );
      if (confirmed) setReported(true);
      return;
    }

    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      window.alert("通報にはログインが必要です");
      return;
    }

    const reasonInput = window.prompt(
      `通報しますか？\n理由の番号を入力してください。\n${REASON_OPTIONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
      "1",
    );
    if (reasonInput === null) return; // キャンセル
    const idx = Number(reasonInput) - 1;
    const reason = REASON_OPTIONS[idx] ?? REASON_OPTIONS[REASON_OPTIONS.length - 1];
    const detail = window.prompt("詳細があれば入力してください（空欄可）", "") ?? "";

    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      target_type: targetType,
      target_id: targetId,
      target_author_id: targetAuthorId ?? null,
      reason,
      detail: detail || null,
      snapshot_body: snapshotBody ?? "",
    });
    if (error) {
      window.alert("通報の送信に失敗しました。もう一度お試しください");
      return;
    }
    setReported(true);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (reported) return;
        void handleReport();
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
