"use client";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import { readOnlyNoticeText, type SnsAccess } from "@/lib/snsAccess";
import { useConsentGateStore } from "@/store/useConsentGateStore";

// 閲覧のみの利用者（未ログイン・ゲスト）に、操作欄の代わりに出す案内。
// 未ログインにはXログインの導線も付ける。認証確認中は何も出さない。
export default function SnsReadOnlyNotice({
  access,
  verb,
  card = true,
}: {
  access: SnsAccess;
  verb: string;
  card?: boolean;
}) {
  const requestXLogin = useConsentGateStore((s) => s.requestXLogin);
  const text = readOnlyNoticeText(access, verb);
  if (!text) return null;
  return (
    <div
      className={`${card ? `${stadiumStyles.surfaceLight} p-4` : ""} flex flex-col items-center gap-2 text-center`}
    >
      <p className="font-sans text-xs font-bold text-[var(--accent-on-light)]">{text}</p>
      {access === "anonymous" && (
        <button
          type="button"
          onClick={() => void requestXLogin()}
          className={`${stadiumStyles.pressable} ${stadiumStyles.surfaceAccent} rounded-xl px-5 py-2 font-sans text-xs font-bold text-[var(--paper)] transition hover:opacity-90`}
        >
          Xでログイン
        </button>
      )}
    </div>
  );
}
