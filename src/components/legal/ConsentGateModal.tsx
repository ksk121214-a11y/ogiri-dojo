"use client";

import { useState } from "react";

import styles from "@/components/home/StadiumHome.module.css";
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

  if (!pendingModal) return null;

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
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={handleCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.grainPaper} flex w-full max-w-sm flex-col gap-4 rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
      >
        <h2 className="font-sans text-base font-black">利用規約・プライバシーポリシーへの同意</h2>

        {/* 2026-09-25（再監査対応）：モーダルを閉じずに規約本文を読めるよう、
            ここでのリンクだけ新しいタブで開く（通常画面のLegalLinksRowの
            挙動＝同じタブでの遷移は変更しない）。 */}
        <LegalLinksRow className="font-sans text-xs underline-offset-2" openInNewTab />

        <p className="font-sans text-[11px] leading-relaxed text-[var(--ink)]/70">
          投稿内容・高座名・得点・順位等を運営が爆笑スタジアム公式Xで紹介する場合がある点を含め、
          利用規約第8条に定める公式Xへの掲載条件をご確認ください。
        </p>

        <label className="flex cursor-pointer items-start gap-2 font-sans text-xs text-[var(--ink)]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          利用規約に同意し、プライバシーポリシーを確認しました。
        </label>

        {errorReason && <p className="font-sans text-xs font-bold text-[var(--accent)]">{errorReason}</p>}

        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            disabled={!checked || submitting}
            onClick={handleConfirm}
            className={`${styles.pressable} ${styles.grainAccent} rounded-xl px-4 py-2.5 font-sans text-sm font-bold text-[var(--paper)] transition disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {submitting ? "処理中…" : actionLabel}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-[var(--ink)]/30 px-4 py-2 font-sans text-xs font-bold text-[var(--ink)]/80 transition hover:bg-[var(--ink)]/5"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
