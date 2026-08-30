"use client";

import { useCallback, useState } from "react";

export type AdminNoticeState = { type: "success" | "error"; message: string } | null;

// 保存成功・送信成功・保存失敗を画面上部で分かりやすく表示するための共通バナー。
// 各ページはuseAdminNotice()を1つ持ち、AdminHeaderのすぐ下にこのコンポーネントを置く。
export default function AdminNotice({
  notice,
  onClose,
}: {
  notice: AdminNoticeState;
  onClose: () => void;
}) {
  if (!notice) return null;
  const isError = notice.type === "error";
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
        isError ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800"
      }`}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-xs underline opacity-70 hover:opacity-100"
      >
        閉じる
      </button>
    </div>
  );
}

export function useAdminNotice() {
  const [notice, setNotice] = useState<AdminNoticeState>(null);
  const notifySuccess = useCallback((message: string) => setNotice({ type: "success", message }), []);
  const notifyError = useCallback((message: string) => setNotice({ type: "error", message }), []);
  const clear = useCallback(() => setNotice(null), []);
  return { notice, notifySuccess, notifyError, clear };
}
