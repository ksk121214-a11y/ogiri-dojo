"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { isPublicSupportPath } from "@/lib/publicSupportPaths";
import { useConsentGateStore } from "@/store/useConsentGateStore";

import { LegalLinksRow } from "@/components/legal/LegalLinks";

// Xログイン・ゲスト参加の直前に表示する明示同意モーダル。
// useConsentGateStore.requestXLogin/requestGuestStartが呼ばれ、まだ現在の
// バージョンへ同意していない端末の場合にだけ表示される（src/store/useConsentGateStore.ts参照）。
// アプリ全体で1箇所（ルートレイアウト）にマウントしておけば、どの画面の
// どのボタンから開始されても同じ確認を経由する。
export default function ConsentGateModal() {
  const pendingModal = useConsentGateStore((s) => s.pendingModal);
  const errorReason = useConsentGateStore((s) => s.errorReason);
  const confirm = useConsentGateStore((s) => s.confirm);
  const cancel = useConsentGateStore((s) => s.cancel);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();

  // 2026-10-12：公開サポートページ（/terms・/privacy・/contact・/account-deletion）の
  // 本文はモーダルで覆わない（保留中のpendingModalはそのまま残し、他の画面へ戻った時に
  // 再表示される）。
  if (!pendingModal || isPublicSupportPath(pathname)) return null;

  const actionLabel = pendingModal.kind === "guest" ? "ゲストとして参加を続ける" : "同意してXログインへ進む";

  const handleConfirm = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    // 2026-09-25（再監査対応）：confirm()はXログイン/ゲスト参加の実処理の
    // 成否を見て、失敗時はpendingModalを維持したままerrorReasonをセットする
    // （src/store/useConsentGateStore.ts参照）。ここではchecked状態を維持し、
    // 失敗直後にもう一度チェックを入れ直させない（再試行を1クリックで行える）。
    // 2026-09-25（再々監査対応）：confirm()自体は内部でtry/catchしているが、
    // 将来的にconfirm()が例外を投げるようになってもボタンが「処理中」のまま
    // 残らないよう、finallyで確実にsubmittingを解除する。
    try {
      await confirm();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setChecked(false);
    cancel();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4"
      onClick={handleCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-gate-title"
        className="flex max-h-[90dvh] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 shadow-2xl ring-1 ring-gray-300"
      >
        <h2 id="consent-gate-title" className="font-sans text-lg font-bold text-gray-900">利用規約・プライバシーポリシーへの同意</h2>

        {/* 2026-09-25（再監査対応）：モーダルを閉じずに規約本文を読めるよう、
            ここでのリンクだけ新しいタブで開く（通常画面のLegalLinksRowの
            挙動＝同じタブでの遷移は変更しない）。 */}
        <LegalLinksRow className="font-sans text-base font-bold text-blue-800" openInNewTab />

        <p className="font-sans text-sm leading-relaxed text-gray-700">
          投稿内容・演者名・得点・順位等を運営が公式SNSや動画配信サービスで紹介する場合がある点を含め、
          利用規約第8条に定める公式SNS等への掲載条件をご確認ください。
        </p>

        <label className="flex cursor-pointer items-start gap-3 font-sans text-base font-medium leading-snug text-gray-900">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          />
          利用規約に同意し、プライバシーポリシーを確認しました。
        </label>

        {errorReason && <p role="alert" className="font-sans text-sm font-bold text-red-700">{errorReason}</p>}

        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            disabled={!checked || submitting}
            onClick={handleConfirm}
            className="rounded-xl bg-gray-900 px-4 py-3 font-sans text-base font-bold text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
          >
            {submitting ? "処理中…" : actionLabel}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-gray-400 bg-white px-4 py-3 font-sans text-base font-bold text-gray-900 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
