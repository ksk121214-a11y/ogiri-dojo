"use client";

import { useState } from "react";

import styles from "@/components/home/StadiumHome.module.css";
import { ACCOUNT_DELETION_MAIL_SUBJECT, contactMailtoWithSubjectAndBody } from "@/lib/legalInfo";
import { supabase } from "@/lib/supabase";

// アプリ内からアカウント削除を申請するモーダル。
// 2026-09-25：これまでの「メール本文に演者名とXの@IDを書くだけ」の依頼方法は、
// いずれも公開情報のため他人になりすませてしまい、ゲストにはXの@ID自体が無い。
// ここでは、現在ログイン中（Xログインの通常会員・匿名セッションが有効なゲストの
// いずれも）の認証済みユーザーIDにDB側で結び付いた申請番号を発行する
// （create_account_deletion_request、0077）。誤操作防止のため、確認画面を
// 経てからのみ申請できる。メールで問い合わせる場合も、パスワード等ではなく
// この申請番号だけを本文に記載すればよいようにする。
export default function AccountDeletionRequestModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"confirm" | "done">("confirm");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_account_deletion_request");
      if (rpcError || !data) {
        setError("申請の送信に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      setRequestNumber(data as string);
      setStep("done");
    } catch {
      setError("申請の送信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const mailBody = requestNumber
    ? `削除申請番号：${requestNumber}\n\n（この番号のまま送信してください。パスワード等は記載しないでください。）`
    : "";

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.surfaceLight} flex w-full max-w-sm flex-col gap-4 rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
      >
        {step === "confirm" ? (
          <>
            <h2 className="font-sans text-base font-black">アカウントの削除を申請する</h2>
            <p className="font-sans text-xs leading-relaxed text-[var(--ink)]/80">
              アカウントを削除すると、ログイン情報、プロフィール、ライブ参加履歴、得点・ポイント等の記録が
              削除され、投稿したお題・回答・ツッコミは一般公開画面に表示されなくなります。この操作は取り消せません。
              申請後、運営が内容を確認した上で削除処理を行います。
            </p>
            {error && <p className="font-sans text-xs font-bold text-[var(--accent-on-light)]">{error}</p>}
            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className={`${styles.pressable} rounded-xl border border-[var(--accent)] px-4 py-2.5 font-sans text-sm font-bold text-[var(--accent-on-light)] transition disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {submitting ? "送信中…" : "削除を申請する"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-[var(--ink)]/30 px-4 py-2 font-sans text-xs font-bold text-[var(--ink)]/80 transition hover:bg-[var(--ink)]/5"
              >
                キャンセル
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-sans text-base font-black">申請を受け付けました</h2>
            <p className="font-sans text-xs leading-relaxed text-[var(--ink)]/80">
              申請番号：<span className="font-bold">{requestNumber}</span>
              <br />
              運営が内容を確認の上、削除処理を行います。処理状況についてメールでもお問い合わせいただけます
              （その場合、下のボタンから申請番号入りのメールを開けます）。
            </p>
            <a
              href={contactMailtoWithSubjectAndBody(ACCOUNT_DELETION_MAIL_SUBJECT, mailBody)}
              className="text-center font-sans text-xs underline decoration-current/40 underline-offset-2"
            >
              申請番号を記載したメールを開く
            </a>
            <button
              type="button"
              onClick={onClose}
              className={`${styles.pressable} mt-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90`}
            >
              閉じる
            </button>
          </>
        )}
      </div>
    </div>
  );
}
