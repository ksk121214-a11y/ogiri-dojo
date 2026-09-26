"use client";

import { useEffect, useRef, useState } from "react";

import { CheckGlyph, FlagGlyph } from "@/components/home/icons";
import { isGuestUser } from "@/lib/guestStatus";
import { supabase } from "@/lib/supabase";
import { createReportSubmitter, reportTargetAuthorId } from "@/lib/reportSubmit";
import { isUuid } from "@/lib/uuid";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

const REASON_OPTIONS = ["不適切な表現", "スパム", "なりすまし", "その他"] as const;

export type ReportTargetType = "sns_topic" | "sns_answer" | "sns_comment" | "live_result_comment";

// 通報ボタン。通報対象（種別とID）を特定できるものだけに設置し、確認（理由選択＋詳細入力）の
// 後にreportsテーブルへ実際に保存する。保存に成功した場合だけ「報告済み」表示にする。
// 対象を特定できない画面（演者プロフィール・ライブの結果画面など、DBが通報対象として
// 未対応のもの）には設置しない：画面上だけ「通報済み」になり運営へ届かない偽の確認を残さないため。
// 未ログイン・ゲスト（reports_insert_own RLSが拒否）にも表示しない。
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
  targetType: ReportTargetType;
  targetId: string;
  targetAuthorId?: string | null;
  snapshotBody?: string;
}) {
  const [reported, setReported] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 送信中ロックと、アンマウント後にstateを更新しないための印。
  const submitter = useRef(
    createReportSubmitter(async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("reports").insert(payload);
      return { error };
    }),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const profile = useProfileStore((s) => s.profile);

  // 認証確認中・未ログイン・ゲスト・ローカル仮ID（UUIDでない）には表示しない。
  if (authLoading || !authUser || isGuestUser(authUser, profile) || !isUuid(targetId)) return null;

  const handleReport = async () => {
    if (submitter.current.isSubmitting()) return;
    const currentUser = useAuthStore.getState().user;
    if (!currentUser || isGuestUser(currentUser, useProfileStore.getState().profile)) return;

    const reasonInput = window.prompt(
      `通報しますか？\n理由の番号を入力してください。\n${REASON_OPTIONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
      "1",
    );
    if (reasonInput === null) return; // キャンセル
    const idx = Number(reasonInput) - 1;
    const reason = REASON_OPTIONS[idx] ?? REASON_OPTIONS[REASON_OPTIONS.length - 1];
    const detail = window.prompt("詳細があれば入力してください（空欄可）", "") ?? "";

    setSubmitting(true);
    // 送信中の連打はsubmitterがbusyで弾く。成功・DBエラー・例外のいずれでもロックは解除される。
    const result = await submitter.current.submit({
      reporter_id: currentUser.id,
      target_type: targetType,
      target_id: targetId,
      target_author_id: reportTargetAuthorId(targetAuthorId),
      reason,
      detail: detail || null,
      snapshot_body: snapshotBody ?? "",
    });
    if (result === "busy") return;
    if (!mounted.current) return;
    setSubmitting(false);
    if (result === "duplicate") {
      window.alert("この内容はすでに通報済みです。");
      setReported(true);
      return;
    }
    if (result === "failed") {
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
        if (reported || submitting) return;
        void handleReport();
      }}
      title={reported ? "報告済みです" : submitting ? "送信中…" : "不適切な内容を報告する"}
      aria-label={reported ? "報告済みです" : submitting ? "送信中…" : "不適切な内容を報告する"}
      aria-busy={submitting}
      className={`flex shrink-0 items-center justify-center rounded-full transition ${submitting ? "animate-pulse opacity-60" : ""} ${
        reported
          ? "text-dojo-curtain-red"
          : "text-dojo-gray-purple hover:text-dojo-curtain-red"
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {reported ? (
        <CheckGlyph className="h-[75%] w-[75%]" />
      ) : (
        <FlagGlyph className="h-[75%] w-[75%]" />
      )}
    </button>
  );
}
