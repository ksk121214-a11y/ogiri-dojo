"use client";

import { useState } from "react";

import { useProfileStore } from "@/store/useProfileStore";

// ログイン後、display_name_set=falseの間だけ表示する高座名(演者名)の初回設定モーダル。
// 後から自由に変更できる想定のため、閉じるボタンは置かず「決めるまで進めない」形にしている。
export default function DisplayNameSetupModal() {
  const profile = useProfileStore((s) => s.profile);
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!profile || profile.displayNameSet) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-dojo-curtain-gold/40 bg-dojo-tatami-cream p-6 shadow-xl"
      >
        <h2 className="font-brush text-lg text-dojo-dark-brown">高座名を決めましょう</h2>
        <p className="mt-2 font-sans text-xs text-dojo-dark-brown">
          道場で名乗る名前を決めてください。後からでも変更できます。
        </p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="例: 高座のあなた"
          autoFocus
          className="mt-4 w-full rounded-full border border-dojo-dark-brown/30 bg-dojo-washi-white px-4 py-2 font-sans text-sm text-dojo-ink outline-none focus:border-dojo-curtain-red"
        />
        {error && (
          <p className="mt-2 font-sans text-xs text-dojo-deep-crimson">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-4 w-full rounded-full bg-dojo-curtain-red px-4 py-2 font-sans text-sm font-bold text-dojo-washi-white transition disabled:opacity-50"
        >
          {submitting ? "設定中…" : "この名前にする"}
        </button>
      </form>
    </div>
  );
}
