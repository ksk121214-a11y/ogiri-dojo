"use client";

import { useState } from "react";

import { APP_NAME } from "@/lib/appInfo";
import { isConfirmedMember } from "@/lib/guestStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { DISPLAY_NAME_MAX_LENGTH, useProfileStore } from "@/store/useProfileStore";

// ログイン後、display_name_set=falseの間だけ表示する演者名（表示名）の初回設定モーダル。
// 後から自由に変更できる想定のため、閉じるボタンは置かず「決めるまで進めない」形にしている。
export default function DisplayNameSetupModal() {
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const authUser = useAuthStore((s) => s.user);
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ゲストは名前を自己編集できない（DB側もprofiles_update_ownがRLSで拒否する）ため、
  // このモーダルは一切出さない。2026-09-13（再レビュー対応）：isConfirmedMember
  // （authUserとprofileのidが一致していることも含む）を使うことで、ログイン切り替え
  // 直後にprofileがまだ前の利用者のものである間もこのモーダルを出さないようにする。
  if (!isConfirmedMember({ authUser, profile, profileLoading }) || profile?.displayNameSet) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await updateDisplayName(name);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="display-name-setup-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-gray-900 shadow-2xl ring-1 ring-gray-300"
      >
        <h2 id="display-name-setup-title" className="font-sans text-xl font-bold text-gray-900">演者名を決めましょう</h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-gray-800">
          {APP_NAME}で名乗る名前を{DISPLAY_NAME_MAX_LENGTH}文字以内で決めてください。後からでも変更できます。
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: たろう"
          autoFocus
          className="mt-4 w-full rounded-lg border border-gray-400 bg-white px-4 py-2.5 font-sans text-base text-gray-900 placeholder:text-gray-500 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/40"
        />
        <span
          className={`mt-1 block text-right font-sans text-[11px] ${
            name.length > DISPLAY_NAME_MAX_LENGTH ? "font-bold text-red-700" : "text-gray-700"
          }`}
        >
          {name.length} / {DISPLAY_NAME_MAX_LENGTH}
        </span>
        {error && (
          <p role="alert" className="mt-2 font-sans text-sm font-bold text-red-700">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || !name.trim() || name.trim().length > DISPLAY_NAME_MAX_LENGTH}
          className="mt-4 w-full rounded-xl bg-gray-900 px-4 py-3 font-sans text-base font-bold text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          {submitting ? "設定中…" : "この名前にする"}
        </button>
      </form>
    </div>
  );
}
